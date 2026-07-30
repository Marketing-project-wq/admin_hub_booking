-- ─────────────────────────────────────────────────────────────────────────────
-- Assignment staff (dokter & terapis) pada booking dan visit klinik.
-- Pola dokumentasi repo: file ini snapshot skema; TIDAK auto-apply — jalankan
-- manual ke project cpvzwqptzcxnwzfzgrmt setelah review (SQL Editor / MCP).
-- ─────────────────────────────────────────────────────────────────────────────

-- FK ke admin_users mengikuti preseden clinic_assessments.staff_id.
-- Nullable: assignment opsional saat booking dibuat, bisa diisi belakangan.
-- ON DELETE default (RESTRICT): staf yang pernah di-assign tidak bisa dihapus
-- diam-diam dari admin_users.
ALTER TABLE clinic_bookings
  ADD COLUMN IF NOT EXISTS assigned_doctor_id    uuid REFERENCES admin_users(id),
  ADD COLUMN IF NOT EXISTS assigned_therapist_id uuid REFERENCES admin_users(id);

ALTER TABLE clinic_visits
  ADD COLUMN IF NOT EXISTS assigned_doctor_id    uuid REFERENCES admin_users(id),
  ADD COLUMN IF NOT EXISTS assigned_therapist_id uuid REFERENCES admin_users(id);

-- Dropdown staf: klien memakai anon key, dan RLS admin_users tidak memberi
-- SELECT ke anon (diverifikasi 2026-07-30: anon melihat 0 baris). Daftar staf
-- karenanya diambil lewat fungsi SECURITY DEFINER yang hanya mengekspos kolom
-- aman — bukan dengan membuka RLS admin_users (tabel berisi kredensial).
CREATE OR REPLACE FUNCTION public.list_clinic_staff_options()
RETURNS TABLE (id uuid, full_name character varying, role character varying)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT id, full_name, role
  FROM admin_users
  WHERE unit = 'clinic' AND is_active = true AND role IN ('dokter', 'therapist')
  ORDER BY role, full_name;
$$;
