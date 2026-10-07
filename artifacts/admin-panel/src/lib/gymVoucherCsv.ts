// Impor CSV voucher gym (bulk-create) — dipakai halaman pages/gym/GymVouchers.tsx.
//
// Alur baru: CSV hanya berisi KODE (+ deskripsi opsional). Setelan diskon/produk/masa
// berlaku/kuota dipilih SEKALI di langkah "Setelan" setelah upload, lalu diterapkan ke semua
// kode valid. Payload akhir dibangun di komponen (arena_vouchers, location='GYM') dengan field
// & cara simpan IDENTIK handleSave. File ini hanya mengurus: template, parse CSV (auto-deteksi
// pemisah , atau ;), dan validasi KODE per-baris.
//
// Scope = admin UI saja. Tidak menyentuh checkout, charge, atau skema DB.

// Template kode-saja (tanpa baris panduan '#'): header + 3 contoh.
const TEMPLATE_SAMPLE_ROWS: string[][] = [
  ['MOB20FIT', 'Afiliasi KOL - Moza'],
  ['HAN20FIT', 'Afiliasi KOL - Hana'],
  ['SHER20FIT', 'Afiliasi KOL - Sherly'],
]

const csvCell = (v: string) => (/[",;\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

export const buildGymVoucherTemplateCsv = (): string => {
  const lines = ['code,description', ...TEMPLATE_SAMPLE_ROWS.map(r => r.map(csvCell).join(','))]
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

// Auto-deteksi pemisah dari baris header (non-#, non-kosong) pertama: bandingkan jumlah ';'
// vs ',' → pakai yang lebih banyak. Excel locale ID menyimpan CSV dengan ';'. Default ','.
export const detectDelimiter = (text: string): ',' | ';' => {
  const stripped = text.replace(/^﻿/, '')
  for (const raw of stripped.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const commas = (line.match(/,/g) || []).length
    const semis = (line.match(/;/g) || []).length
    return semis > commas ? ';' : ','
  }
  return ','
}

// Parser CSV minimal dengan pemisah bisa dipilih: dukung field berkutip (""), pemisah & newline
// di dalam kutip, escape "", CRLF/LF dan BOM. Mengembalikan matriks string. Baris kosong dibuang.
export const parseCsv = (input: string, delimiter: ',' | ';' = ','): string[][] => {
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
    if (c === delimiter) { pushField(); i++; continue }
    if (c === '\r') { if (text[i + 1] === '\n') i++; pushRow(); i++; continue }
    if (c === '\n') { pushRow(); i++; continue }
    field += c; i++
  }
  if (field !== '' || row.length > 0) pushRow()
  return rows.filter(r => r.some(cell => cell.trim() !== ''))
}

// ── Validasi KODE per-baris ──────────────────────────────────────────────────

export interface ParsedCodeRow {
  rowNum: number            // nomor baris data (1-based, tak termasuk header/komentar)
  code: string              // kode mentah (akan di-uppercase saat valid)
  description: string | null
  valid: boolean
  errors: string[]
}

// `existingCodes` = Set kode (UPPERCASE) yang sudah ada di DB (arena_vouchers + legacy vouchers),
// diambil caller (cermin isVoucherCodeTaken, sekali di awal untuk preview).
export const prepareGymVoucherCodes = (
  csvText: string,
  existingCodes: Set<string>,
): { headerError?: string; rows: ParsedCodeRow[] } => {
  const delimiter = detectDelimiter(csvText)
  // Buang baris panduan (diawali '#'); parseCsv sudah membuang baris kosong.
  const matrix = parseCsv(csvText, delimiter).filter(r => !(r.length > 0 && r[0].trim().startsWith('#')))
  if (matrix.length === 0) return { headerError: 'File kosong (tidak ada header/baris data)', rows: [] }

  const header = matrix[0].map(h => h.trim().toLowerCase())
  const codeIdx = header.indexOf('code')
  const descIdx = header.indexOf('description')
  if (codeIdx < 0) return { headerError: 'Kolom wajib tidak ada di header: code', rows: [] }

  const seenInFile = new Set<string>()
  const rows: ParsedCodeRow[] = []
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r]
    const rawCode = (codeIdx < cells.length ? cells[codeIdx] : '').trim()
    const rawDesc = descIdx >= 0 && descIdx < cells.length ? (cells[descIdx] ?? '').trim() : ''
    const errors: string[] = []
    const code = rawCode.toUpperCase()
    if (rawCode === '') {
      errors.push('Kode wajib diisi')
    } else if (!/^[A-Z0-9-]{3,32}$/.test(code)) {
      errors.push('Kode hanya huruf, angka, dan "-" (3–32 karakter)')
    } else {
      if (seenInFile.has(code)) errors.push('Kode duplikat di dalam file')
      if (existingCodes.has(code)) errors.push('Kode sudah dipakai (ada di database)')
    }
    if (rawCode !== '' && /^[A-Z0-9-]{3,32}$/.test(code)) seenInFile.add(code)
    rows.push({ rowNum: r, code: rawCode === '' ? '' : code, description: rawDesc || null, valid: errors.length === 0, errors })
  }
  return { rows }
}
