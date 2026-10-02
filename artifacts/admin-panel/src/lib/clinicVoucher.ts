import { supabase } from './supabase'

// Validasi voucher Clinic dari Kasir (Close Bill). Memakai RPC yang sama dengan checkout
// online booking.20fit.id/clinic (verify_clinic_voucher): voucher adminhub /clinic/vouchers
// (arena_vouchers location='CLINIC') + voucher lama di tabel `vouchers`.
// Diskon hanya dihitung dari item yang layanannya masuk scope voucher.
// Pemakaian (kuota) dicatat atomik saat Close Bill lewat close_clinic_bill_with_voucher.

export interface ClinicVoucherItem { service_id: string; price: number }

export interface ClinicVoucherCheck {
  valid: boolean
  message: string
  code: string
  discount: number
  eligibleServiceIds: string[]
}

// RPC mengembalikan pesan berbahasa Inggris (dipakai juga di halaman customer).
const toIndonesian = (msg: string): string => {
  const min = msg.match(/^Minimum purchase (Rp [\d.,]+)/)
  if (min) return `Minimal belanja ${min[1].replace(/,/g, '.')} untuk voucher ini`
  const map: Record<string, string> = {
    'Please enter a voucher code': 'Masukkan kode voucher',
    'Your cart is empty': 'Tidak ada layanan yang bisa didiskon',
    'Voucher not found': 'Kode voucher tidak ditemukan',
    'Voucher is not active': 'Voucher sedang nonaktif',
    'Voucher is not active yet': 'Voucher belum mulai berlaku',
    'Voucher has expired': 'Voucher sudah kedaluwarsa',
    'Voucher quota exhausted': 'Kuota voucher sudah habis',
    'This voucher is not valid for the selected service(s)': 'Voucher tidak berlaku untuk layanan di tagihan ini',
  }
  return map[msg] ?? msg
}

export const verifyClinicVoucher = async (code: string, items: ClinicVoucherItem[]): Promise<ClinicVoucherCheck> => {
  const normalized = code.toUpperCase().trim()
  const { data, error } = await supabase.rpc('verify_clinic_voucher', { p_code: normalized, p_items: items })
  if (error) {
    return { valid: false, message: `Gagal cek voucher: ${error.message}`, code: normalized, discount: 0, eligibleServiceIds: [] }
  }
  const d = (data ?? {}) as Record<string, unknown>
  const valid = d.valid === true
  return {
    valid,
    message: toIndonesian(typeof d.message === 'string' ? d.message : ''),
    code: typeof d.code === 'string' ? d.code : normalized,
    discount: valid ? Number(d.discount_amount) || 0 : 0,
    eligibleServiceIds: Array.isArray(d.eligible_service_ids) ? (d.eligible_service_ids as string[]) : [],
  }
}
