// Normalisasi nomor telepon Indonesia ke format lokal berawalan '0'.
//
// ⚠️ ALGORITMA INI HARUS PERSIS SAMA dengan implementasi normalizePhone di repo
// ARENA-BOOKING (situs booking) — dipakai untuk pencocokan pasien lintas sistem.
// Jangan diubah sepihak di salah satu repo.
//
// Langkah (sesuai spesifikasi bersama):
// 1. Buang semua karakter selain digit; tanda '+' hanya dipertahankan di depan.
// 2. Diawali '+62'  -> ganti jadi '0'.
// 3. Diawali '62' (tanpa '+') dan total 10-13 digit (indikasi kode negara) -> '0'.
// 4. Sudah diawali '0' -> biarkan.
// Hasil akhir: format lokal diawali '0'.
export function normalizePhone(input: string): string {
  if (!input) return ''
  const trimmed = input.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (hasPlus && digits.startsWith('62')) return '0' + digits.slice(2)
  if (digits.startsWith('62') && digits.length >= 10 && digits.length <= 13) return '0' + digits.slice(2)
  return digits
}
