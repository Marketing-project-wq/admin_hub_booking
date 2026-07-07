-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Repo ini TIDAK auto-apply migrations — jalankan SQL ini
-- MANUAL di Supabase (project cpvzwqptzcxnwzfzgrmt) via SQL Editor atau
-- Supabase MCP apply_migration SEBELUM deploy edge function `arena-api`.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Tabel penyimpanan API key untuk Arena Open API (member system eksternal).
-- API key TIDAK PERNAH disimpan plaintext — hanya SHA-256 hash (key_hash) yang
-- dipakai untuk validasi, plus key_prefix untuk display di Admin Hub.

CREATE TABLE arena_api_keys (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  key_hash    TEXT NOT NULL UNIQUE,
  key_prefix  TEXT NOT NULL,
  is_active   BOOLEAN DEFAULT true,
  last_used   TIMESTAMPTZ,
  created_by  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);
