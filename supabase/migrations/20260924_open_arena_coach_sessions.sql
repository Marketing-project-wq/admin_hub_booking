-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Di-apply ke Supabase (project cpvzwqptzcxnwzfzgrmt) via MCP
-- apply_migration (open_arena_coach_sessions). File = dokumentasi kondisi live.
-- Aman di-re-apply (IF NOT EXISTS / DROP-IF-EXISTS).
-- ───────────────────────────────────────────────────────────────────────────
--
-- FASE 2 (redeem sesi coaching — dijadwalkan staf).
-- Paket "Open Arena with Coach / Head Coach" dijual di Fase 1 sebagai 1 baris
-- arena_bookings (rent_type open_arena_coach/head_coach, sessions_total, valid_until).
-- Tabel ini mencatat TIAP sesi yang dijadwalkan/dipakai dari paket itu, sehingga
-- saldo (terpakai vs total) & masa berlaku bisa dilacak dan di-enforce.
--
--   open_arena_coach_sessions
--     booking_id   -> arena_bookings(id) paket induk (ON DELETE CASCADE)
--     session_date/time, coach_id + coach_name (denormalisasi, pola arena_class_schedules.instructor)
--     status: scheduled | completed | cancelled | no_show
--
-- RLS: SELECT publik; tulis publik permisif — konsisten dgn postur admin unit lain
--   (anon client + policy permisif, lihat gym_admin_write_policies). Integritas
--   (tak boleh over-pakai / lewat masa berlaku / paket belum lunas) DIJAGA trigger
--   di bawah, jadi tak bergantung pada role penulis. Pengetatan ke auth asli = scope terpisah.

create table if not exists public.open_arena_coach_sessions (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null references public.arena_bookings(id) on delete cascade,
  session_date date not null,
  session_time time,
  coach_id     uuid,          -- referensi longgar ke arena_coaches(id); tak di-FK agar hapus coach tak mengunci
  coach_name   text,          -- snapshot nama coach untuk tampilan
  status       text not null default 'scheduled'
                 check (status in ('scheduled', 'completed', 'cancelled', 'no_show')),
  notes        text,
  created_by   text,          -- email staf yang menjadwalkan (opsional)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_oacs_booking on public.open_arena_coach_sessions(booking_id);

-- RLS: baca publik + tulis publik permisif (lihat catatan di atas).
alter table public.open_arena_coach_sessions enable row level security;
drop policy if exists "read coach sessions"   on public.open_arena_coach_sessions;
drop policy if exists "insert coach sessions" on public.open_arena_coach_sessions;
drop policy if exists "update coach sessions" on public.open_arena_coach_sessions;
drop policy if exists "delete coach sessions" on public.open_arena_coach_sessions;
create policy "read coach sessions"   on public.open_arena_coach_sessions for select using (true);
create policy "insert coach sessions" on public.open_arena_coach_sessions for insert to public with check (true);
create policy "update coach sessions" on public.open_arena_coach_sessions for update to public using (true) with check (true);
create policy "delete coach sessions" on public.open_arena_coach_sessions for delete to public using (true);

-- Enforcement: sebuah sesi hanya boleh dibuat/diaktifkan bila paket induk berupa
-- paket coaching yang SUDAH lunas (confirmed), belum melewati masa berlaku, dan
-- jumlah sesi non-cancel tidak melebihi total. Baris cancelled tidak dihitung.
create or replace function public.enforce_coach_session() returns trigger as $$
declare
  b   record;
  used int;
begin
  select id, status, sessions_total, valid_until, coach_tier
    into b
    from public.arena_bookings
    where id = NEW.booking_id;

  if b.id is null then
    raise exception 'COACH_SESSION_NO_BOOKING: parent booking % not found', NEW.booking_id
      using errcode = 'check_violation';
  end if;

  if b.sessions_total is null or b.coach_tier is null then
    raise exception 'COACH_SESSION_NOT_PACKAGE: booking % is not a coaching package', NEW.booking_id
      using errcode = 'check_violation';
  end if;

  -- Baris yang menghitung kuota (non-cancelled) wajib memenuhi syarat paket.
  if NEW.status <> 'cancelled' then
    if b.status <> 'confirmed' then
      raise exception 'COACH_SESSION_UNPAID: parent booking % not confirmed (status=%)', NEW.booking_id, b.status
        using errcode = 'check_violation';
    end if;

    if b.valid_until is not null and NEW.session_date > b.valid_until then
      raise exception 'COACH_SESSION_EXPIRED: session date % is after package validity %', NEW.session_date, b.valid_until
        using errcode = 'check_violation';
    end if;

    select count(*) into used
      from public.open_arena_coach_sessions
      where booking_id = NEW.booking_id
        and status <> 'cancelled'
        and id <> NEW.id;

    if used + 1 > b.sessions_total then
      raise exception 'COACH_SESSION_FULL: all % session(s) of booking % already used', b.sessions_total, NEW.booking_id
        using errcode = 'check_violation';
    end if;
  end if;

  NEW.updated_at := now();
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_coach_session on public.open_arena_coach_sessions;
create trigger trg_enforce_coach_session
  before insert or update on public.open_arena_coach_sessions
  for each row execute function public.enforce_coach_session();
