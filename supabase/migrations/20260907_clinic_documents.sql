-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Skema/Storage ini SUDAH live di Supabase (project
-- cpvzwqptzcxnwzfzgrmt) — diterapkan via MCP apply_migration (clinic_documents).
-- File ini DOKUMENTASI kondisi live; jangan re-apply buta.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Fitur "Document" (klinik). Upload dokumen pasien (PDF / gambar / dokumen
-- kantor) per pasien, opsional ditautkan ke satu kunjungan (visit). Dipakai di:
--   • Panel Dokter (EMR) → tab "Document" (per visit + per pasien)
--   • Menu "Dokumen" (admin/kasir/registrasi) → cari pasien lalu upload/kelola
-- Kategori 'postur' = foto postur yang di-upload admin/kasir (front/back),
-- tetap tampil di tab Document dokter — analisis postur ber-AI dokter (tabel
-- clinic_posture_scans) TIDAK diubah oleh fitur ini.

-- ── Storage bucket clinic-documents ──────────────────────────────────────────
-- PRIVATE, limit 20MB, mime gambar + pdf + dokumen kantor umum
-- (pola bucket clinic-posture). Signed URL dipakai untuk baca (bucket privat).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clinic-documents', 'clinic-documents', false, 20971520,
        array[
          'image/jpeg','image/png','image/webp','image/heic','image/heif','image/gif',
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'text/plain'
        ])
on conflict (id) do nothing;

-- Policy storage.objects utk bucket clinic-documents.
-- App klinik BELUM punya Auth asli → memakai ANON key; jadi policy mengizinkan
-- anon (+authenticated). CRUD penuh DALAM bucket ini saja, konsisten dgn bucket
-- clinic-posture & tabel klinik lain yang meng-grant anon penuh.
drop policy if exists "clinic_documents_read"   on storage.objects;
drop policy if exists "clinic_documents_insert" on storage.objects;
drop policy if exists "clinic_documents_update" on storage.objects;
drop policy if exists "clinic_documents_delete" on storage.objects;
create policy "clinic_documents_read"   on storage.objects for select to anon, authenticated using (bucket_id = 'clinic-documents');
create policy "clinic_documents_insert" on storage.objects for insert to anon, authenticated with check (bucket_id = 'clinic-documents');
create policy "clinic_documents_update" on storage.objects for update to anon, authenticated using (bucket_id = 'clinic-documents') with check (bucket_id = 'clinic-documents');
create policy "clinic_documents_delete" on storage.objects for delete to anon, authenticated using (bucket_id = 'clinic-documents');

-- ── Tabel clinic_documents ───────────────────────────────────────────────────
-- Satu baris = satu file dokumen milik pasien. patient_id WAJIB; visit_id opsional
-- (di-set saat upload dari modal kunjungan dokter, null saat upload dari menu
-- Dokumen). RLS OFF + grant anon penuh (pola clinic_posture_scans/clinic_visits).
create table if not exists public.clinic_documents (
  id          uuid primary key default gen_random_uuid(),
  patient_id  uuid not null references public.clinic_patients(id) on delete cascade,
  visit_id    uuid          references public.clinic_visits(id)   on delete set null,
  category    text not null default 'umum',   -- umum|lab|radiologi|rujukan|resep|identitas|postur
  title       text,                            -- label/keterangan opsional
  file_path   text not null,                   -- path objek di bucket clinic-documents
  file_name   text not null,                   -- nama file asli
  file_type   text,                            -- mime type
  file_size   bigint,                          -- ukuran byte
  uploaded_by text,                            -- nama staf pengunggah
  created_at  timestamptz not null default now()
);
create index if not exists clinic_documents_patient_idx on public.clinic_documents(patient_id);
create index if not exists clinic_documents_visit_idx   on public.clinic_documents(visit_id);

grant select, insert, update, delete on public.clinic_documents to anon, authenticated, service_role;
