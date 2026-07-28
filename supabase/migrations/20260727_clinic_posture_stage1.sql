-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Skema/Storage ini SUDAH live di Supabase (project
-- cpvzwqptzcxnwzfzgrmt) — diterapkan via MCP apply_migration (clinic_posture_stage1).
-- File ini DOKUMENTASI kondisi live; jangan re-apply buta.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Fitur "Scan Postur" (EMR) — INFRA STAGE 1 (tanpa UI). Foto postur pasien
-- (depan/belakang) di-upload per visit; MediaPipe PoseLandmarker (browser) men-
-- deteksi titik tubuh; sudut kemiringan dihitung & disimpan untuk dibandingkan
-- antar waktu.

-- ── Storage bucket clinic-posture ───────────────────────────────────────────
-- PRIVATE, limit 5MB, mime gambar (pola transfer-photos/item-photos).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-posture', 'clinic-posture', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic'])
on conflict (id) do nothing;

-- Policy storage.objects utk bucket clinic-posture.
-- App klinik BELUM punya Auth asli → memakai ANON key; jadi policy mengizinkan
-- anon (+authenticated). CRUD penuh DALAM bucket ini saja, konsisten dgn tabel
-- klinik lain yang meng-grant anon penuh. Sengaja TIDAK dibuat lebih ketat
-- (pengetatan = scope terpisah saat Auth asli dipasang).
drop policy if exists "clinic_posture_read"   on storage.objects;
drop policy if exists "clinic_posture_insert" on storage.objects;
drop policy if exists "clinic_posture_update" on storage.objects;
drop policy if exists "clinic_posture_delete" on storage.objects;
create policy "clinic_posture_read"   on storage.objects for select to anon, authenticated using (bucket_id = 'clinic-posture');
create policy "clinic_posture_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'clinic-posture');
create policy "clinic_posture_update" on storage.objects for update to anon, authenticated using (bucket_id = 'clinic-posture') with check (bucket_id = 'clinic-posture');
create policy "clinic_posture_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'clinic-posture');

-- ── Tabel clinic_posture_scans ──────────────────────────────────────────────
-- Satu baris = satu foto postur (view) per visit. RLS OFF + grant anon penuh
-- (pola clinic_assessments/clinic_visits). clinic_visits & clinic_patients
-- SUDAH ADA sebelumnya (FK).
create table if not exists public.clinic_posture_scans (
  id          uuid primary key default gen_random_uuid(),
  visit_id    uuid not null references public.clinic_visits(id)   on delete cascade,
  patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  view        text not null check (view in ('depan','belakang')),
  image_path  text not null,                 -- path objek di bucket clinic-posture
  landmarks   jsonb,                          -- koordinat titik dari MediaPipe PoseLandmarker
  angles      jsonb,                          -- hasil hitung: shoulder_tilt_deg, hip_tilt_deg, lateral_deviation_deg
  created_at  timestamptz not null default now()
);
create index if not exists clinic_posture_scans_visit_idx   on public.clinic_posture_scans(visit_id);
create index if not exists clinic_posture_scans_patient_idx on public.clinic_posture_scans(patient_id);

grant select, insert, update, delete on public.clinic_posture_scans to anon, authenticated, service_role;
