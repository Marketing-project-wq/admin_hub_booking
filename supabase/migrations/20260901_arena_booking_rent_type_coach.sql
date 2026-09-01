-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Kolom ini di-apply ke Supabase (project cpvzwqptzcxnwzfzgrmt)
-- via MCP apply_migration (arena_booking_rent_type_coach). File = dokumentasi live.
-- Aman di-re-apply (IF NOT EXISTS).
-- ───────────────────────────────────────────────────────────────────────────
--
-- Manual Slot Booking (arena) kini punya pilihan: sewa VENUE SAJA atau DENGAN COACH.
--   rent_type  : 'venue_only' | 'with_coach' (NULL utk baris lama / non-manual).
--   coach_name : nama coach (denormalisasi, pola sama arena_class_schedules.instructor)
--                — hanya terisi saat rent_type = 'with_coach'.
-- Additive & nullable → tidak mengubah alur/harga yang ada; harga tetap diatur manual
-- di form (kolom price). Grant tabel-level meng-cover kolom baru (anon insert tetap jalan).

alter table public.arena_bookings
  add column if not exists rent_type  text,
  add column if not exists coach_name text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'arena_bookings_rent_type_check'
  ) then
    alter table public.arena_bookings
      add constraint arena_bookings_rent_type_check
      check (rent_type is null or rent_type in ('venue_only', 'with_coach'));
  end if;
end $$;
