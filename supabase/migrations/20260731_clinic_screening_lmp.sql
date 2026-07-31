-- Riwayat Menstruasi di form Screening (Triase):
-- kolom mandiri HPHT (Hari Pertama Haid Terakhir) di clinic_screenings —
-- mengikuti pola kolom non-checkbox yang sudah ada (blood_type,
-- physical_activity_level). Chip status siklus (Siklus teratur/tidak
-- teratur/Menopause) TIDAK butuh migration: masuk ke array health_female
-- (jsonb) yang sudah ada.
--
-- Additive & aman: ADD COLUMN nullable tanpa default, tidak menyentuh
-- data/fungsi lain. Aman di-deploy sebelum kode frontend (kolom baru
-- diabaikan kode lama).

BEGIN;

ALTER TABLE public.clinic_screenings
  ADD COLUMN IF NOT EXISTS last_menstrual_period date;

COMMENT ON COLUMN public.clinic_screenings.last_menstrual_period IS
  'HPHT - Hari Pertama Haid Terakhir (diisi di screening D.6 Khusus Perempuan; nullable, hanya relevan utk pasien perempuan)';

COMMIT;
