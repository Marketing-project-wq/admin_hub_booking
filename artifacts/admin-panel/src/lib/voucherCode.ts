import { supabase } from './supabase'

// Generator kode voucher unik — dipakai tombol "Generate Kode" di halaman voucher
// (Arena, Clinic). Format: PREFIX + acak, mis. CLN7KQ2MX / LMJHR4Q7X5L1 (tanpa tanda
// "-", sama seperti kode yang selama ini dibuat manual).
//
// Karakter tanpa yang mudah tertukar saat diketik/dibacakan customer
// (tidak ada 0/O, 1/I/L).
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

const randomPart = (length: number) => {
  const buf = new Uint32Array(length)
  crypto.getRandomValues(buf)
  return Array.from(buf, n => CODE_CHARS[n % CODE_CHARS.length]).join('')
}

export const sanitizeVoucherCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9-]/g, '')

// Prefix terakhir yang dipakai admin, diingat per unit (localStorage; aman bila diblokir).
const prefixKey = (unit: string) => `voucher_code_prefix_${unit}`
export const getSavedVoucherPrefix = (unit: string, fallback = '') => {
  try {
    const saved = localStorage.getItem(prefixKey(unit))
    return saved !== null ? saved : fallback
  } catch { return fallback }
}
export const saveVoucherPrefix = (unit: string, prefix: string) => {
  try { localStorage.setItem(prefixKey(unit), prefix) } catch { /* ignore */ }
}

// Kode dipakai checkout lintas unit: arena_vouchers.code UNIQUE untuk semua unit
// (Arena/Recovery/Gym/Clinic), plus tabel voucher lama `vouchers` yang masih dibaca
// checkout Clinic. Kode dianggap terpakai bila ada di salah satunya.
export const isVoucherCodeTaken = async (code: string, excludeId?: string | null): Promise<boolean> => {
  const c = code.trim().toUpperCase()
  if (!c) return false
  let q = supabase.from('arena_vouchers').select('id').eq('code', c).limit(1)
  if (excludeId) q = q.neq('id', excludeId)
  const [current, legacy] = await Promise.all([
    q,
    supabase.from('vouchers').select('id').eq('code', c).limit(1),
  ])
  if (current.error) throw new Error(current.error.message)
  return (current.data?.length ?? 0) > 0 || (legacy.data?.length ?? 0) > 0
}

// Prefix kosong → 8 karakter acak; dengan prefix → prefix + 6 karakter acak.
export const generateUniqueVoucherCode = async (prefix = ''): Promise<string> => {
  const p = sanitizeVoucherCode(prefix).replace(/-+$/, '')
  const length = p ? 6 : 8
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = `${p}${randomPart(length)}`
    if (!(await isVoucherCodeTaken(code))) return code
  }
  throw new Error('Gagal membuat kode unik, coba klik Generate lagi')
}
