-- ───────────────────────────────────────────────────────────────────────────
-- Recovery Center vouchers — snapshot untuk git. Apply ke Supabase
-- (project cpvzwqptzcxnwzfzgrmt) via MCP apply_migration (recovery_vouchers)
-- atau SQL editor. Aman di-re-apply (IF NOT EXISTS + drop/create policy).
-- ───────────────────────────────────────────────────────────────────────────
--
-- Sistem voucher diskon untuk Recovery Center (booking.20fit.id/recoverycenter).
-- Admin kelola via unit Recovery Center → menu Voucher (artifacts/admin-panel).
--
-- KONTRAK dengan customer app (repo terpisah — booking.20fit.id/recoverycenter):
--   Saat checkout, customer app memvalidasi kode voucher terhadap recovery_vouchers
--   (is_active, valid_from/until, quota vs used_count, min_spend), hitung diskon,
--   lalu saat membuat baris clinic_bookings (channel='recovery_center') mengisi:
--     • price_before_disc = harga sebelum diskon
--     • discount          = nominal potongan (rupiah)
--     • price             = harga akhir dibayar (price_before_disc - discount)
--     • voucher_code      = kode voucher yang dipakai
--   dan menaikkan recovery_vouchers.used_count (mis. via RPC increment).
--   Admin hanya MENAMPILKAN voucher_code + discount di halaman Booking.

create table if not exists public.recovery_vouchers (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  description   text,
  discount_type text not null default 'percentage' check (discount_type in ('percentage','fixed')),
  discount_value integer not null default 0,   -- percentage: 1-100 ; fixed: rupiah
  max_discount  integer,                        -- cap rupiah utk tipe percentage (opsional; null = tanpa cap)
  min_spend     integer not null default 0,     -- minimal belanja rupiah agar voucher berlaku
  quota         integer,                         -- total pemakaian; null = tak terbatas
  used_count    integer not null default 0,
  valid_from    date,
  valid_until   date,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- RLS: postur permisif, konsisten dengan master data admin unit lain (anon admin CRUD;
-- customer app anon baca untuk validasi). Pengetatan ke auth asli = scope terpisah.
alter table public.recovery_vouchers enable row level security;
drop policy if exists rv_select on public.recovery_vouchers;
drop policy if exists rv_insert on public.recovery_vouchers;
drop policy if exists rv_update on public.recovery_vouchers;
drop policy if exists rv_delete on public.recovery_vouchers;
create policy rv_select on public.recovery_vouchers for select to public using (true);
create policy rv_insert on public.recovery_vouchers for insert to public with check (true);
create policy rv_update on public.recovery_vouchers for update to public using (true) with check (true);
create policy rv_delete on public.recovery_vouchers for delete to public using (true);

-- Kolom voucher pada booking. clinic_bookings dipakai ulang oleh Recovery Center;
-- kolom ini additive & nullable/berdefault → TIDAK memengaruhi alur Clinic yang ada.
alter table public.clinic_bookings add column if not exists voucher_code       text;
alter table public.clinic_bookings add column if not exists discount           integer not null default 0;
alter table public.clinic_bookings add column if not exists price_before_disc  integer;

-- Helper opsional buat customer app: naikkan used_count secara atomik saat voucher dipakai.
create or replace function public.increment_recovery_voucher_usage(p_code text)
returns void
language sql
as $$
  update public.recovery_vouchers
     set used_count = used_count + 1, updated_at = now()
   where code = p_code;
$$;
