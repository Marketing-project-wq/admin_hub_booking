-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Skema ini SUDAH live di Supabase (project
-- cpvzwqptzcxnwzfzgrmt). File ini DOKUMENTASI kondisi live; jangan re-apply buta.
-- Struktur/index/RLS diambil PERSIS via information_schema / pg_indexes /
-- pg_policies / pg_get_constraintdef, bukan rekonstruksi dari ingatan.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Tabel referensi ICD-10 untuk ICD-10 picker di form Diagnosis EMR. Dicari
-- pakai trigram (pg_trgm) via kolom code & display.
--
-- ── SUMBER DATA ─────────────────────────────────────────────────────────────
-- SATUSEHAT, Kementerian Kesehatan RI (Kemenkes) — ICD-10 versi 2010.
--   (kolom `version` = 'ICD10_2010'.)
-- Data (18.543 baris, ~1.28 MB) DI-IMPORT TERPISAH via CSV — BUKAN bagian
-- migration ini, supaya file migration tidak bengkak. CSV TIDAK di-commit ke
-- repo (lihat .gitignore: artifacts/admin-panel/scripts/*.csv). Untuk reproduce:
-- ambil dataset ICD-10 2010 dari SATUSEHAT/Kemenkes, lalu import ke tabel ini
-- (kolom: code, display, version) — mis. lewat CSV import di Supabase.
-- Migration ini HANYA membuat struktur tabel + index + RLS, TANPA isi data.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS public.clinic_icd10 (
  code    text NOT NULL,
  display text NOT NULL,
  version text NOT NULL DEFAULT 'ICD10_2010',
  PRIMARY KEY (code)
);

-- Trigram GIN untuk pencarian substring cepat di code & display.
CREATE INDEX IF NOT EXISTS clinic_icd10_code_trgm_idx    ON public.clinic_icd10 USING gin (code    gin_trgm_ops);
CREATE INDEX IF NOT EXISTS clinic_icd10_display_trgm_idx ON public.clinic_icd10 USING gin (display gin_trgm_ops);

-- RLS aktif; hanya baca-publik (data referensi non-sensitif).
ALTER TABLE public.clinic_icd10 ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public read icd10" ON public.clinic_icd10;
CREATE POLICY "Public read icd10" ON public.clinic_icd10 FOR SELECT USING (true);
