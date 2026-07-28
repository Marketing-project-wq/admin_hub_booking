-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Kolom ini SUDAH live di Supabase (project
-- cpvzwqptzcxnwzfzgrmt) — ditambahkan langsung di DB (di luar sesi migration).
-- File ini DOKUMENTASI kondisi live; aman di-re-apply (IF NOT EXISTS).
-- Diverifikasi dari information_schema: annotations jsonb NULL, tanpa default.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Fitur "Anotasi Scan Postur" (Stage 4a titik + catatan, Stage 4b garis antar
-- titik) — dokter menandai foto postur dengan titik/garis custom + catatan,
-- terpisah dari 33 landmark & 3 sudut MediaPipe yang otomatis (read-only).
--
-- Struktur isi annotations (dikelola client, PostureScanPanel.tsx):
--   {
--     general_note: string,                 -- catatan umum per scan
--     points: [{ id, x, y, note }],         -- x/y ternormalisasi 0..1 (konsisten landmarks)
--     lines:  [{ id, point_a_id, point_b_id, angle_deg, note }]
--             -- garis HANYA antar 2 titik custom (endpoint by id, tanpa garis lepas);
--             -- angle_deg = sudut vs horizontal, rumus sama 3 garis MediaPipe
--   }
-- Baris lama NULL → client mem-parse ke default kosong (parseAnnotations).
-- Grants tabel-level (bukan per-kolom) → kolom baru otomatis ter-cover, tanpa
-- GRANT tambahan.

alter table public.clinic_posture_scans
  add column if not exists annotations jsonb;
