-- ═══════════════════════════════════════════════════════════════════════════════
-- DRAFT — BELUM DI-APPLY. Review dulu, apply manual, lalu rename hapus suffix _DRAFT.
--
-- Tujuan: voucher arena_vouchers bisa dipakai untuk DISKON PEMBELIAN PAKET
-- (PackageCheckoutPage), bukan hanya booking kelas (BookingPage).
--
-- Desain (Opsi A yang disetujui):
--   1. Kolom applies_to di arena_vouchers — scope voucher.
--      Default 'class_booking' → SEMUA voucher lama berperilaku persis seperti
--      sekarang, tidak ada perubahan perilaku sampai staff memilih scope lain.
--   2. Tabel join arena_voucher_packages — restriksi voucher ke paket tertentu.
--      Semantik meniru arena_voucher_schedules: 0 baris = berlaku SEMUA paket.
--   3. Kolom jejak diskon di arena_package_orders — diisi checkout saat voucher
--      dipakai; additive, aman untuk data lama (default 0 / NULL).
--
-- Urutan deploy aman:
--   apply migration ini → update BookingPage (ARENA-BOOKING: tolak voucher
--   ber-scope 'package_purchase' untuk booking kelas) → implement voucher di
--   PackageCheckoutPage → update UI admin ArenaVouchers.tsx (bisa kapan saja
--   setelah migration).
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Scope voucher: 'class_booking' (default, perilaku lama) / 'package_purchase' / 'both'
ALTER TABLE arena_vouchers
  ADD COLUMN IF NOT EXISTS applies_to text NOT NULL DEFAULT 'class_booking'
  CHECK (applies_to IN ('class_booking', 'package_purchase', 'both'));

-- 2. Restriksi voucher ke paket tertentu (0 baris = semua paket, pola arena_voucher_schedules)
CREATE TABLE IF NOT EXISTS arena_voucher_packages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id uuid NOT NULL REFERENCES arena_vouchers(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES arena_packages(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE (voucher_id, package_id)
);

-- Lookup utama sisi customer: "voucher X boleh untuk paket apa saja?"
CREATE INDEX IF NOT EXISTS idx_arena_voucher_packages_voucher_id
  ON arena_voucher_packages (voucher_id);

-- 3. Jejak diskon di order paket — diisi PackageCheckoutPage saat voucher dipakai
ALTER TABLE arena_package_orders
  ADD COLUMN IF NOT EXISTS voucher_code text,
  ADD COLUMN IF NOT EXISTS discount_amount integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN arena_vouchers.applies_to IS
  'Scope voucher: class_booking (booking kelas, default/perilaku lama), package_purchase (pembelian paket), both';
COMMENT ON TABLE arena_voucher_packages IS
  'Restriksi voucher ke paket tertentu; 0 baris untuk sebuah voucher = berlaku semua paket (pola arena_voucher_schedules)';
COMMENT ON COLUMN arena_package_orders.voucher_code IS
  'Kode voucher yang dipakai saat checkout paket (NULL = tanpa voucher)';
COMMENT ON COLUMN arena_package_orders.discount_amount IS
  'Nominal diskon (Rp) dari voucher; kolom price tetap snapshot harga paket — nominal dibayar = price - discount_amount';
