-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Policy ini di-apply ke Supabase (project cpvzwqptzcxnwzfzgrmt)
-- via MCP apply_migration (gym_admin_write_policies). File = dokumentasi kondisi live.
-- Aman di-re-apply (drop-if-exists lalu create).
-- ───────────────────────────────────────────────────────────────────────────
--
-- Dashboard admin Gym (artifacts/gym-admin) menulis master data via anon client
-- (@workspace/admin-shared → VITE_SUPABASE_ANON_KEY), pola SAMA dengan arena-admin.
-- Tabel master gym semula HANYA punya policy SELECT publik, sehingga admin tidak
-- bisa insert/update/delete (RLS: "new row violates row-level security policy").
--
-- Tambah policy tulis publik meniru arena_class_types / arena_class_schedules
-- (INSERT with check true, UPDATE using/with check true, DELETE using true) untuk
-- 4 tabel master gym. Konsisten dengan postur keamanan admin unit lain yang sudah
-- ada (anon + policy permisif); pengetatan ke auth asli = scope terpisah.
--
-- TIDAK menyentuh gym_class_bookings & gym_membership_orders — keduanya SUDAH punya
-- policy INSERT/UPDATE publik (assign status confirm/cancel + booking dari app jalan).
-- gym_memberships dibiarkan read-only (dashboard tidak menulis ke sana).

do $$
declare t text;
begin
  foreach t in array array['gym_class_types','gym_class_schedules','gym_coaches','gym_membership_plans']
  loop
    execute format('drop policy if exists %I on public.%I', 'anon_insert_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'anon_update_'||t, t);
    execute format('drop policy if exists %I on public.%I', 'anon_delete_'||t, t);
    execute format('create policy %I on public.%I for insert to public with check (true)', 'anon_insert_'||t, t);
    execute format('create policy %I on public.%I for update to public using (true) with check (true)', 'anon_update_'||t, t);
    execute format('create policy %I on public.%I for delete to public using (true)', 'anon_delete_'||t, t);
  end loop;
end $$;
