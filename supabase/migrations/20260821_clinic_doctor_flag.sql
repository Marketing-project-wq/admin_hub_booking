-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Perubahan ini di-apply langsung ke Supabase (project
-- cpvzwqptzcxnwzfzgrmt); file ini DOKUMENTASI kondisi live. Idempotent.
-- ───────────────────────────────────────────────────────────────────────────
--
-- BUG: dr. Adrian hilang dari dropdown "Dokter" pada assignment booking.
--
-- Penyebab: sejak 20260819_clinic_adrian_super_admin.sql, role dr. Adrian
-- dinaikkan menjadi 'super_admin' dengan unit NULL. Fungsi dropdown
-- list_clinic_staff_options() memfilter `unit = 'clinic' AND role IN
-- ('dokter','therapist')`, sehingga Adrian (role super_admin, unit NULL)
-- tidak lagi muncul sebagai pilihan dokter.
--
-- Akar masalah desain: "apakah seseorang seorang dokter" ter-ikat pada role
-- akses (role = 'dokter'). Padahal dokter bisa juga punya role akses lain
-- (mis. super_admin). Kolom baru `is_doctor` memisahkan atribut klinis
-- "dokter" dari role akses, jadi menaikkan role dokter tidak lagi
-- menyembunyikannya dari dropdown assignment.
--
-- Catatan: ada super_admin lain (admin@20fit.id, "Super Admin") yang BUKAN
-- dokter — karena itu kita TIDAK bisa sekadar memasukkan semua super_admin.
-- Diskriminatornya adalah flag is_doctor yang eksplisit.

-- 1) Kolom atribut klinis, lepas dari role akses.
ALTER TABLE public.admin_users
  ADD COLUMN IF NOT EXISTS is_doctor boolean NOT NULL DEFAULT false;

-- 2) Backfill: semua yang role-nya 'dokter' adalah dokter, plus dr. Adrian
--    yang sekarang super_admin tapi tetap seorang dokter.
UPDATE public.admin_users
   SET is_doctor = true
 WHERE role = 'dokter'
    OR lower(email) = lower('dr.adrian@20fit.id');

-- 3) Dropdown assignment: sertakan dokter berdasarkan is_doctor (bukan hanya
--    role akses), dan laporkan role 'dokter' agar filter klien
--    (o.role === 'dokter') tetap bekerja tanpa perubahan front-end.
--    Terapis tetap diidentifikasi lewat role = 'therapist' pada unit clinic.
CREATE OR REPLACE FUNCTION public.list_clinic_staff_options()
RETURNS TABLE (id uuid, full_name character varying, role character varying)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id,
         full_name,
         (CASE WHEN is_doctor THEN 'dokter' ELSE role END)::character varying AS role
  FROM admin_users
  WHERE is_active = true
    AND (
      is_doctor
      OR (unit = 'clinic' AND role IN ('dokter', 'therapist'))
    )
  ORDER BY (CASE WHEN is_doctor THEN 'dokter' ELSE role END), full_name;
$$;
