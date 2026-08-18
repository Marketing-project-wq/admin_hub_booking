-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Policy ini SUDAH live di Supabase (project cpvzwqptzcxnwzfzgrmt)
-- — diterapkan via MCP apply_migration (arena_packages_rls_write_policies).
-- File ini DOKUMENTASI kondisi live; jangan re-apply buta.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Fix bug: "Tambah Paket" / edit / nonaktifkan paket di Admin Hub → Arena → Packages
-- gagal dengan:
--     new row violates row-level security policy for table "arena_packages"
--
-- Sebab: tabel arena_packages RLS ON, tapi HANYA punya policy SELECT
-- ("public read packages"). Tidak ada policy INSERT/UPDATE/DELETE → semua tulis
-- oleh admin panel & checkout (keduanya pakai ANON key) ditolak RLS. Grant tabel
-- untuk anon/authenticated SUDAH lengkap (INSERT/UPDATE/DELETE/SELECT), jadi yang
-- kurang murni policy RLS-nya — bukan privilege.
--
-- Perbaikan: tambah policy tulis permissive untuk role public (mencakup anon),
-- PERSIS pola tabel arena master sejenis yang sudah jalan — arena_vouchers,
-- arena_class_types, arena_voucher_schedules, arena_addons. Posture keamanan
-- sengaja disamakan dengan tabel-tabel itu (app belum punya Auth asli → memakai
-- anon key; policy mengizinkan anon penuh). Pengetatan = scope terpisah saat
-- Auth asli dipasang.

drop policy if exists "anon_insert_packages" on public.arena_packages;
drop policy if exists "anon_update_packages" on public.arena_packages;
drop policy if exists "anon_delete_packages" on public.arena_packages;

create policy "anon_insert_packages" on public.arena_packages
  for insert to public with check (true);
create policy "anon_update_packages" on public.arena_packages
  for update to public using (true);
create policy "anon_delete_packages" on public.arena_packages
  for delete to public using (true);
