-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Fungsi ini SUDAH live di Supabase (project
-- cpvzwqptzcxnwzfzgrmt). File ini DOKUMENTASI kondisi live.
-- ───────────────────────────────────────────────────────────────────────────
--
-- List clinic admin_users untuk halaman /clinic/users.
--
-- admin_users punya policy RLS SELECT yang di-hardcode `false` (baris tidak
-- pernah bocor ke client anon), jadi halaman "Kelola Users Clinic" selalu
-- kosong ("Belum ada user clinic") padahal user clinic sudah ada — termasuk
-- yang ditambahkan langsung dari backend. Fungsi SECURITY DEFINER ini
-- mengembalikan HANYA kolom aman (tanpa password_hash), mengikuti pola RPC
-- yang sudah ada (create_admin_user / reset_admin_password / validate_admin_login).

CREATE OR REPLACE FUNCTION public.list_clinic_users()
RETURNS TABLE (
  id uuid,
  email text,
  full_name text,
  role text,
  unit text,
  permissions jsonb,
  is_active boolean,
  last_login_at timestamptz,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, email, full_name, role, unit, permissions, is_active, last_login_at, created_at
  FROM public.admin_users
  WHERE unit = 'clinic'
  ORDER BY full_name;
$$;
