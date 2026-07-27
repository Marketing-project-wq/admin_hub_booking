-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Skema ini SUDAH live di Supabase (project
-- cpvzwqptzcxnwzfzgrmt). File ini DOKUMENTASI kondisi live; jangan re-apply buta.
-- ───────────────────────────────────────────────────────────────────────────
--
-- clinic_assessments: kolom subjective / objective / diagnosis diubah text -> jsonb
-- untuk menampung form Assessment EMR terstruktur.
--
-- DIVERIFIKASI dari information_schema.columns (kondisi live sekarang):
--   subjective jsonb  NULL  default NULL
--   objective  jsonb  NULL  default NULL
--   diagnosis  jsonb  NULL  default NULL
--   vital_signs jsonb NULL  default '{}'::jsonb   <- SUDAH jsonb sebelumnya,
--                                                    BUKAN bagian perubahan ini.
-- Trigger di clinic_assessments: TIDAK ADA (pg_trigger non-internal = 0 baris).
--
-- CATATAN klausa USING (penting untuk reproduce yang jujur):
-- Klausa USING transformasi TIDAK tersimpan di katalog Postgres, jadi tidak bisa
-- diambil ulang dari DB. Klausa di bawah MEREPRODUKSI bentuk legacy yang TERLIHAT
-- di row aktual saat verifikasi (bukan tebakan dari ingatan):
--   subjective(text) -> {"chief_complaint": <text>, "legacy_migrated": true}
--   objective (text) -> {"legacy_text":    <text>, "legacy_migrated": true}
--   diagnosis        -> tidak ada data lama (semua NULL); cukup konversi null-safe.

ALTER TABLE public.clinic_assessments
  ALTER COLUMN subjective TYPE jsonb USING
    CASE WHEN subjective IS NULL OR subjective = '' THEN NULL
         ELSE jsonb_build_object('chief_complaint', subjective, 'legacy_migrated', true) END;

ALTER TABLE public.clinic_assessments
  ALTER COLUMN objective TYPE jsonb USING
    CASE WHEN objective IS NULL OR objective = '' THEN NULL
         ELSE jsonb_build_object('legacy_text', objective, 'legacy_migrated', true) END;

-- diagnosis semua NULL saat migrasi -> null-safe; ELSE tak pernah tereksekusi.
ALTER TABLE public.clinic_assessments
  ALTER COLUMN diagnosis TYPE jsonb USING nullif(diagnosis, '')::jsonb;
