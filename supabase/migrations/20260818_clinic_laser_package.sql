-- Clinic: paket Laser 4x (4 kali visit) + kolom requires_referral
-- clinic_packages SUDAH ADA (di-seed langsung di Supabase). Migration ini
-- mendokumentasikan seed paket Laser sebagai bagian dari repo agar reproducible.

-- Pastikan kolom requires_referral ada (dipakai halaman master Package).
ALTER TABLE clinic_packages
  ADD COLUMN IF NOT EXISTS requires_referral boolean DEFAULT false;

-- Seed paket Laser 4x — 4x = 4 kali visit. Idempotent by (category, sessions).
INSERT INTO clinic_packages
  (name, category, sessions, price_per_session, package_price, retail_price, discount_percent, requires_referral, is_active)
SELECT 'Laser Package 4x', 'Laser', 4, 1250000, 5000000, 5000000, 0, false, true
WHERE NOT EXISTS (
  SELECT 1 FROM clinic_packages WHERE category = 'Laser' AND sessions = 4
);
