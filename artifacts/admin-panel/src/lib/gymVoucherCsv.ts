// Impor CSV voucher gym (bulk-create) — dipakai halaman pages/gym/GymVouchers.tsx.
//
// Tujuan: membuat banyak voucher gym sekaligus TANPA membuat jalur simpan baru. Payload yang
// dihasilkan di sini IDENTIK dengan handleSave di GymVouchers (arena_vouchers, location='GYM'):
// field, default, dan aturan validasi dibuat mirror. Kode unik & cek-duplikat tetap pakai
// helper yang sama (voucherCode.ts: generateUniqueVoucherCode / isVoucherCodeTaken).
//
// Scope = admin UI saja. Tidak menyentuh checkout, charge, atau skema DB.

export type GymScope = 'gym_all' | 'gym_membership' | 'gym_day_pass'

// Mirror konstanta di GymVouchers.tsx (sengaja diduplikasi agar file ini mandiri; nilainya
// identik — valid_until "tanpa batas" = FAR_FUTURE, acuan hari ini di WIB).
export const FAR_FUTURE = '2099-12-31'
export const todayWIB = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })

const GYM_SCOPES: GymScope[] = ['gym_all', 'gym_membership', 'gym_day_pass']

// Header template (11 kolom). Urutan ini dipakai untuk unduh template; saat impor, urutan
// kolom bebas & nama kolom case-insensitive (dipetakan via header baris pertama).
export const GYM_CSV_HEADERS = [
  'code', 'description', 'discount_type', 'discount_value', 'max_discount_amount',
  'min_booking_amount', 'quota', 'valid_from', 'valid_until', 'scope', 'is_active',
] as const

// Baris panduan (diawali '#') — diabaikan parser, hanya untuk membantu admin mengisi.
const TEMPLATE_COMMENT_LINES: string[] = [
  '# TEMPLATE IMPOR VOUCHER GYM — baris diawali # diabaikan sistem (panduan saja). Mulai isi dari baris data di bawah header.',
  '# WAJIB diisi : discount_type, discount_value',
  '# OPSIONAL    : code (kosong = dibuat otomatis), description, max_discount_amount (hanya untuk percentage), min_booking_amount (kosong = 0), quota (kosong = tanpa batas), valid_from (kosong = hari ini), valid_until (kosong = tanpa batas), scope (kosong = gym_membership), is_active (kosong = TRUE)',
  '# discount_type : percentage ATAU fixed   |   scope : gym_membership / gym_day_pass / gym_all   |   tanggal : YYYY-MM-DD   |   is_active : TRUE / FALSE',
]

// Contoh baris data template (tepat seperti template owner).
const TEMPLATE_SAMPLE_ROWS: string[][] = [
  ['MEMBER10', 'Diskon member 10 persen', 'percentage', '10', '100000', '0', '100', '2026-10-07', '2026-11-30', 'gym_membership', 'TRUE'],
  ['MEMBERNEWYEAR', 'Promo tahun baru', 'percentage', '15', '150000', '500000', '50', '2026-12-01', '2026-12-31', 'gym_membership', 'TRUE'],
  ['MEMBER50K', 'Potongan 50 ribu', 'fixed', '50000', '', '0', '', '2026-10-07', '', 'gym_membership', 'TRUE'],
]

// ── CSV serialize/parse ─────────────────────────────────────────────────────

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export const buildGymVoucherTemplateCsv = (): string => {
  const lines = [
    ...TEMPLATE_COMMENT_LINES,
    GYM_CSV_HEADERS.join(','),
    ...TEMPLATE_SAMPLE_ROWS.map(r => r.map(csvCell).join(',')),
  ]
  return lines.join('\r\n') + '\r\n'
}

export const downloadGymVoucherTemplate = () => {
  const blob = new Blob(['﻿' + buildGymVoucherTemplateCsv()], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'template-voucher-gym.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// Parser CSV minimal: dukung field berkutip (""), koma & newline di dalam kutip, escape "" ,
// serta CRLF/LF dan BOM. Mengembalikan matriks string (baris × sel). Baris kosong dibuang.
export const parseCsv = (input: string): string[][] => {
  const text = input.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = () => { row.push(field); field = '' }
  const pushRow = () => { pushField(); rows.push(row); row = [] }
  while (i < text.length) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { inQuotes = true; i++; continue }
    if (c === ',') { pushField(); i++; continue }
    if (c === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue }
    if (c === '\n') { pushRow(); i++; continue }
    field += c; i++
  }
  // Baris terakhir (tanpa newline penutup).
  if (field !== '' || row.length > 0) pushRow()
  // Buang baris yang sepenuhnya kosong.
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

// ── Validasi + mapping per baris (mirror handleSave + initialForm) ───────────

// Field hasil siap-pakai; `code` null = perlu auto-generate saat impor.
export interface PreparedVoucher {
  code: string | null
  description: string | null
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  min_booking_amount: number
  max_discount_amount: number | null
  quota: number | null
  valid_from: string
  valid_until: string
  is_active: boolean
  applies_to: GymScope
}

export interface ParsedVoucherRow {
  rowNum: number            // nomor baris data (1-based, tak termasuk header)
  rawCode: string           // kode mentah seperti di file ('' = auto)
  autoCode: boolean
  valid: boolean
  errors: string[]
  prepared?: PreparedVoucher
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const isValidDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime())

const parseBool = (raw: string, dflt: boolean): boolean | null => {
  const v = raw.trim().toLowerCase()
  if (v === '') return dflt
  if (['true', '1', 'ya', 'yes', 'y', 'aktif'].includes(v)) return true
  if (['false', '0', 'tidak', 'no', 'n', 'nonaktif'].includes(v)) return false
  return null // nilai tak dikenal → error
}

// `existingCodes` = Set kode (UPPERCASE) yang sudah ada di DB (arena_vouchers + legacy vouchers).
// `seenInFile` = Set kode (UPPERCASE) yang sudah muncul di baris sebelumnya (deteksi dup antar baris).
const validateRow = (
  get: (col: string) => string,
  existingCodes: Set<string>,
  seenInFile: Set<string>,
): { valid: boolean; errors: string[]; prepared?: PreparedVoucher; rawCode: string; autoCode: boolean } => {
  const errors: string[] = []

  // code
  const rawCode = get('code').trim()
  const autoCode = rawCode === ''
  let code: string | null = null
  if (!autoCode) {
    code = rawCode.toUpperCase()
    if (!/^[A-Z0-9-]{3,32}$/.test(code)) {
      errors.push('Kode hanya huruf, angka, dan "-" (3–32 karakter)')
    } else {
      if (seenInFile.has(code)) errors.push('Kode duplikat di dalam file')
      if (existingCodes.has(code)) errors.push('Kode sudah dipakai (ada di database)')
    }
  }

  // discount_type (wajib)
  const dtRaw = get('discount_type').trim().toLowerCase()
  const discount_type = (dtRaw === 'percentage' || dtRaw === 'fixed') ? dtRaw : null
  if (!discount_type) errors.push('discount_type wajib "percentage" atau "fixed"')

  // discount_value (>0; persen ≤100)
  const dvRaw = get('discount_value').trim()
  const discount_value = Number(dvRaw)
  if (dvRaw === '' || Number.isNaN(discount_value) || discount_value <= 0) {
    errors.push('discount_value harus angka > 0')
  } else if (discount_type === 'percentage' && discount_value > 100) {
    errors.push('Diskon persen maksimal 100')
  }

  // max_discount_amount (hanya untuk percentage; fixed → null)
  const maxRaw = get('max_discount_amount').trim()
  let max_discount_amount: number | null = null
  if (maxRaw !== '') {
    const m = Number(maxRaw)
    if (Number.isNaN(m) || m < 0) errors.push('max_discount_amount harus angka ≥ 0')
    else if (discount_type === 'percentage') max_discount_amount = m || null
    // fixed → diabaikan (null), sama seperti handleSave
  }

  // min_booking_amount (default 0)
  const minRaw = get('min_booking_amount').trim()
  let min_booking_amount = 0
  if (minRaw !== '') {
    const mb = Number(minRaw)
    if (Number.isNaN(mb) || mb < 0) errors.push('min_booking_amount harus angka ≥ 0')
    else min_booking_amount = mb
  }

  // quota (kosong → null; isi → integer ≥1)
  const quotaRaw = get('quota').trim()
  let quota: number | null = null
  if (quotaRaw !== '') {
    const q = Number(quotaRaw)
    if (!Number.isInteger(q) || q < 1) errors.push('quota harus bilangan bulat ≥ 1 (kosongkan untuk tanpa batas)')
    else quota = q
  }

  // valid_from (kosong → hari ini WIB)
  const vfRaw = get('valid_from').trim()
  const valid_from = vfRaw === '' ? todayWIB() : vfRaw
  if (vfRaw !== '' && !isValidDate(vfRaw)) errors.push('valid_from harus format YYYY-MM-DD')

  // valid_until (kosong → FAR_FUTURE; harus ≥ valid_from)
  const vuRaw = get('valid_until').trim()
  const valid_until = vuRaw === '' ? FAR_FUTURE : vuRaw
  if (vuRaw !== '' && !isValidDate(vuRaw)) errors.push('valid_until harus format YYYY-MM-DD')
  if (isValidDate(valid_from) && isValidDate(valid_until) && valid_until < valid_from) {
    errors.push('valid_until harus setelah valid_from')
  }

  // scope (kosong/invalid → default gym_membership; terima ketiganya)
  const scopeRaw = get('scope').trim().toLowerCase()
  const applies_to: GymScope = (GYM_SCOPES as string[]).includes(scopeRaw) ? (scopeRaw as GymScope) : 'gym_membership'

  // is_active (true/1/ya; kosong → true)
  const isActive = parseBool(get('is_active'), true)
  if (isActive === null) errors.push('is_active harus true/false (atau 1/0, ya/tidak)')

  if (errors.length > 0 || !discount_type || isActive === null) {
    return { valid: false, errors, rawCode, autoCode }
  }

  const prepared: PreparedVoucher = {
    code,
    description: get('description').trim() || null,
    discount_type,
    discount_value,
    min_booking_amount,
    max_discount_amount: discount_type === 'percentage' ? max_discount_amount : null,
    quota,
    valid_from,
    valid_until,
    is_active: isActive,
    applies_to,
  }
  return { valid: true, errors, prepared, rawCode, autoCode }
}

// Validasi seluruh file → daftar baris (preview). `existingCodes` = kode UPPERCASE yang sudah
// ada di DB (dari caller). Mengembalikan error header bila kolom wajib tak ada.
export const prepareGymVoucherRows = (
  csvText: string,
  existingCodes: Set<string>,
): { headerError?: string; rows: ParsedVoucherRow[] } => {
  // Buang baris panduan (diawali '#'); parseCsv sudah membuang baris kosong.
  const matrix = parseCsv(csvText).filter(r => !(r.length > 0 && r[0].trim().startsWith('#')))
  if (matrix.length === 0) return { headerError: 'File kosong (tidak ada header/baris data)', rows: [] }

  const header = matrix[0].map(h => h.trim().toLowerCase())
  const required = ['code', 'discount_type', 'discount_value', 'scope']
  const missing = required.filter(c => !header.includes(c))
  if (missing.length > 0) {
    return { headerError: `Kolom wajib tidak ada di header: ${missing.join(', ')}`, rows: [] }
  }

  const colIndex = (name: string) => header.indexOf(name)
  const seenInFile = new Set<string>()
  const rows: ParsedVoucherRow[] = []

  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]
    const get = (col: string) => {
      const idx = colIndex(col)
      return idx >= 0 && idx < cells.length ? (cells[idx] ?? '') : ''
    }
    const res = validateRow(get, existingCodes, seenInFile)
    // Daftarkan kode (yang di-provide) ke seenInFile setelah cek, agar baris pertama yang pakai
    // kode itu dianggap OK dan baris berikutnya yang menduplikasi yang ditandai error.
    if (!res.autoCode) {
      const up = res.rawCode.toUpperCase()
      if (/^[A-Z0-9-]{3,32}$/.test(up)) seenInFile.add(up)
    }
    rows.push({ rowNum: r, rawCode: res.rawCode, autoCode: res.autoCode, valid: res.valid, errors: res.errors, prepared: res.prepared })
  }
  return { rows }
}
