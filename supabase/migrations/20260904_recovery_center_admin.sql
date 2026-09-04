-- ───────────────────────────────────────────────────────────────────────────
-- Recovery Center admin hub — snapshot untuk git. Di-apply ke Supabase
-- (project cpvzwqptzcxnwzfzgrmt) via MCP apply_migration (recovery_center_admin).
-- Aman di-re-apply (idempotent: NOT EXISTS + tidak reset password bila user ada).
-- ───────────────────────────────────────────────────────────────────────────
--
-- KONTEKS DATA (tidak ada tabel baru):
--   Recovery Center memakai ulang infrastruktur Clinic.
--     • Layanan  : public.clinic_services  WHERE service_group = 'Recovery Center'
--                  (category='recovery'; kode RC-SM30/RC-SM60/RC-SM90/RC-PUMP30/RC-TAPE/…)
--     • Booking  : public.clinic_bookings  WHERE channel = 'recovery_center'
--                  (booking_code prefix CLC- → sudah dirutekan xendit-webhook/
--                   create-xendit-payment ke clinic_bookings, jadi pembayaran &
--                   konfirmasi otomatis SUDAH jalan tanpa perubahan edge function).
--   Dashboard admin (artifacts/recovery-admin) hanya MEMBACA/UPDATE subset itu
--   via anon client (pola sama arena/gym/clinic). clinic_bookings sudah punya
--   policy INSERT/UPDATE publik, jadi confirm/cancel dari dashboard jalan.
--
-- Migrasi ini menambah nilai 'recovery' ke check-constraint unit + 1 akun admin
-- unit 'recovery' agar ada login khusus (super_admin juga tetap bisa akses
-- /recovery via validate_admin_login).

-- Izinkan unit = 'recovery' pada admin_users (semula hanya arena/gym/clinic).
alter table public.admin_users drop constraint if exists admin_users_unit_check;
alter table public.admin_users add constraint admin_users_unit_check
  check (unit is null or unit = any (array['arena'::text, 'gym'::text, 'clinic'::text, 'recovery'::text]));

do $$
begin
  if not exists (select 1 from public.admin_users where lower(email) = 'recovery@20fit.id') then
    insert into public.admin_users (email, full_name, role, unit, password_hash, is_active, permissions)
    values (
      'recovery@20fit.id',
      'Recovery Center Admin',
      'admin',
      'recovery',
      extensions.crypt('Recovery@2026', extensions.gen_salt('bf')),
      true,
      '{}'::jsonb
    );
  else
    -- Pastikan unit & status benar bila akun sudah ada; JANGAN reset password.
    update public.admin_users
       set unit = 'recovery', role = 'admin', is_active = true
     where lower(email) = 'recovery@20fit.id';
  end if;
end $$;
