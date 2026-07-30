-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Fungsi ini SUDAH live di Supabase (project
-- cpvzwqptzcxnwzfzgrmt). File ini DOKUMENTASI kondisi live.
-- ───────────────────────────────────────────────────────────────────────────
--
-- admin_users punya RLS aktif TANPA policy UPDATE, jadi update langsung dari
-- client anon (updateClinicUserPermissions / toggleClinicUserActive) hanya
-- mengenai 0 baris — tidak error, tapi tidak tersimpan (mis. checklist
-- permissions dokter kembali kosong saat modal dibuka lagi). RPC SECURITY
-- DEFINER berikut menjalankan update dengan bypass RLS, mengikuti pola RPC yang
-- sudah ada (create_admin_user / reset_admin_password / list_clinic_users).

CREATE OR REPLACE FUNCTION public.update_admin_user_permissions(p_id uuid, p_permissions jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.admin_users SET permissions = p_permissions WHERE id = p_id;
$$;

CREATE OR REPLACE FUNCTION public.set_admin_user_active(p_id uuid, p_active boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.admin_users SET is_active = p_active WHERE id = p_id;
$$;
