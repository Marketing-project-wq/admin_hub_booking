-- ───────────────────────────────────────────────────────────────────────────
-- Snapshot untuk git. Skema ini SUDAH live di Supabase (project
-- cpvzwqptzcxnwzfzgrmt) — diterapkan via MCP apply_migration. File ini
-- DOKUMENTASI kondisi live; jangan re-apply buta (CREATE OR REPLACE FUNCTION
-- akan menimpa definisi live). Definisi diambil PERSIS via pg_get_functiondef /
-- pg_get_constraintdef, bukan rekonstruksi dari ingatan.
-- ───────────────────────────────────────────────────────────────────────────
--
-- Close Bill kasir ATOMIK + sistem klaim slot (menggantikan increment
-- booked_count non-atomik lama). Tabel clinic_slots / clinic_visits /
-- clinic_transactions / clinic_patient_packages SUDAH ADA sebelum kerjaan ini
-- (tidak dibuat di sini — lihat kolom yang direferensi fungsi di bawah).

-- ── Tabel klaim slot ────────────────────────────────────────────────────────
-- Satu kursi fisik = satu baris klaim (slot_id, type, id). RLS TIDAK diaktifkan
-- (relrowsecurity=false di live) — akses HANYA lewat fungsi SECURITY DEFINER
-- claim/release di bawah.
CREATE TABLE IF NOT EXISTS clinic_slot_claims (
  slot_id          uuid        NOT NULL REFERENCES clinic_slots(id) ON DELETE CASCADE,
  claimed_by_type  varchar     NOT NULL,           -- 'visit' | 'booking'
  claimed_by_id    uuid        NOT NULL,
  created_at       timestamptz DEFAULT now(),
  PRIMARY KEY (slot_id, claimed_by_type, claimed_by_id)
);

-- ── claim_clinic_slot ───────────────────────────────────────────────────────
-- Idempoten per (slot,type,id); cek kapasitas (booked_count < quota); rollback
-- klaim kalau slot penuh. (verbatim pg_get_functiondef)
CREATE OR REPLACE FUNCTION public.claim_clinic_slot(p_slot_id uuid, p_claimed_by_type character varying, p_claimed_by_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_rows integer;
BEGIN
  INSERT INTO clinic_slot_claims (slot_id, claimed_by_type, claimed_by_id)
  VALUES (p_slot_id, p_claimed_by_type, p_claimed_by_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;

  UPDATE clinic_slots SET booked_count = booked_count + 1
  WHERE id = p_slot_id AND booked_count < quota;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    DELETE FROM clinic_slot_claims WHERE slot_id=p_slot_id AND claimed_by_type=p_claimed_by_type AND claimed_by_id=p_claimed_by_id;
    RAISE EXCEPTION 'Slot penuh';
  END IF;
  RETURN true;
END; $function$;

-- ── release_clinic_slot ─────────────────────────────────────────────────────
-- Lepas klaim + turunkan booked_count (floor 0). (verbatim pg_get_functiondef)
CREATE OR REPLACE FUNCTION public.release_clinic_slot(p_slot_id uuid, p_claimed_by_type character varying, p_claimed_by_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE v_rows integer;
BEGIN
  DELETE FROM clinic_slot_claims
  WHERE slot_id=p_slot_id AND claimed_by_type=p_claimed_by_type AND claimed_by_id=p_claimed_by_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN false; END IF;
  UPDATE clinic_slots SET booked_count = GREATEST(booked_count - 1, 0) WHERE id = p_slot_id;
  RETURN true;
END; $function$;

-- ── close_clinic_bill ───────────────────────────────────────────────────────
-- Settlement kasir ATOMIK dalam satu transaksi DB: insert clinic_transactions
-- (locked), tandai visit paid+completed, potong sesi paket, beli paket baru
-- (opsional). Menolak re-close visit yang sudah paid/completed. Guard
-- discount <= service_price. (verbatim pg_get_functiondef)
CREATE OR REPLACE FUNCTION public.close_clinic_bill(p_visit_id uuid, p_patient_id uuid, p_service_id uuid, p_service_name character varying, p_service_price integer, p_discount integer, p_total_amount integer, p_payment_method character varying, p_payment_detail jsonb, p_notes text, p_cashier_name character varying, p_locked_by character varying DEFAULT NULL::character varying, p_use_package_ids uuid[] DEFAULT '{}'::uuid[], p_purchase_package boolean DEFAULT false, p_purchase_package_id uuid DEFAULT NULL::uuid, p_purchase_package_sessions integer DEFAULT NULL::integer, p_purchase_package_notes text DEFAULT NULL::text)
 RETURNS clinic_transactions
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_visit clinic_visits;
  v_trx clinic_transactions;
  v_new_patient_package_id uuid;
  v_pkg_id uuid;
  v_rows integer;
BEGIN
  SELECT * INTO v_visit FROM clinic_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit tidak ditemukan'; END IF;
  IF v_visit.payment_status = 'paid' OR v_visit.status = 'completed' THEN
    RAISE EXCEPTION 'Visit ini sudah di-close sebelumnya';
  END IF;

  IF p_payment_method IS NULL OR trim(p_payment_method) = '' THEN
    RAISE EXCEPTION 'Metode pembayaran wajib diisi';
  END IF;

  IF p_discount > p_service_price THEN
    RAISE EXCEPTION 'Diskon (%) tidak boleh melebihi harga layanan (%)', p_discount, p_service_price;
  END IF;

  IF p_purchase_package THEN
    IF p_purchase_package_id IS NULL OR p_purchase_package_sessions IS NULL THEN
      RAISE EXCEPTION 'Data paket baru tidak lengkap';
    END IF;
    INSERT INTO clinic_patient_packages (
      patient_id, package_id, total_sessions, used_sessions, is_active, notes, purchased_at
    ) VALUES (
      p_patient_id, p_purchase_package_id, p_purchase_package_sessions, 0, true, p_purchase_package_notes, now()
    ) RETURNING id INTO v_new_patient_package_id;
  END IF;

  INSERT INTO clinic_transactions (
    visit_id, patient_id, service_id, service_name, service_price, discount,
    total_amount, payment_method, payment_detail, payment_status, notes, cashier_name,
    is_locked, locked_at, locked_by,
    patient_package_id, is_package_purchase, package_id
  ) VALUES (
    p_visit_id, p_patient_id, p_service_id, p_service_name, p_service_price, p_discount,
    p_total_amount, p_payment_method, p_payment_detail, 'paid', p_notes, p_cashier_name,
    true, now(), COALESCE(p_locked_by, p_cashier_name),
    v_new_patient_package_id, p_purchase_package, p_purchase_package_id
  ) RETURNING * INTO v_trx;

  UPDATE clinic_visits
  SET payment_method = p_payment_method, payment_amount = p_total_amount,
      payment_status = 'paid', status = 'completed', updated_at = now()
  WHERE id = p_visit_id;

  FOREACH v_pkg_id IN ARRAY p_use_package_ids LOOP
    UPDATE clinic_patient_packages
    SET used_sessions = used_sessions + 1,
        is_active = (used_sessions + 1 < total_sessions),
        updated_at = now()
    WHERE id = v_pkg_id AND used_sessions < total_sessions;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION 'Sesi paket % sudah habis atau tidak ditemukan', v_pkg_id;
    END IF;
  END LOOP;

  RETURN v_trx;
END; $function$;
