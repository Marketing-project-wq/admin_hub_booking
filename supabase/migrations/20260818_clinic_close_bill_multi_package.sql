-- Clinic Close Bill: dukung pembelian BEBERAPA paket sekaligus dalam satu bill.
--
-- Sebelumnya close_clinic_bill hanya menerima satu paket (p_purchase_package_*).
-- Kasir sering perlu menjual 2 paket sekaligus ke satu pasien (mis. Laser + Medic).
-- Migration ini menambahkan parameter opsional p_purchase_packages (jsonb array):
--   [{ "id": <package_id uuid>, "sessions": <int>, "notes": <text|null> }, ...]
--
-- Backward-compatible: parameter single lama (p_purchase_package, ...) tetap ada.
-- Prioritas: jika p_purchase_packages diisi → pakai array; kalau tidak → fallback
-- ke param single lama. Kolom transaksi single (package_id, patient_package_id)
-- diisi dari paket PERTAMA agar receipt/laporan lama tetap menampilkan sesuatu.

CREATE OR REPLACE FUNCTION public.close_clinic_bill(
  p_visit_id uuid,
  p_patient_id uuid,
  p_service_id uuid,
  p_service_name character varying,
  p_service_price integer,
  p_discount integer,
  p_total_amount integer,
  p_payment_method character varying,
  p_payment_detail jsonb,
  p_notes text,
  p_cashier_name character varying,
  p_locked_by character varying DEFAULT NULL::character varying,
  p_use_package_ids uuid[] DEFAULT '{}'::uuid[],
  p_purchase_package boolean DEFAULT false,
  p_purchase_package_id uuid DEFAULT NULL::uuid,
  p_purchase_package_sessions integer DEFAULT NULL::integer,
  p_purchase_package_notes text DEFAULT NULL::text,
  p_admin_fee integer DEFAULT 0,
  p_purchase_packages jsonb DEFAULT NULL::jsonb
)
RETURNS clinic_transactions
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_visit clinic_visits;
  v_trx clinic_transactions;
  v_new_patient_package_id uuid;
  v_first_patient_package_id uuid;
  v_first_package_id uuid;
  v_is_purchase boolean := false;
  v_pkg jsonb;
  v_pkg_id uuid;
  v_rows integer;
BEGIN
  SELECT * INTO v_visit FROM clinic_visits WHERE id = p_visit_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Visit tidak ditemukan'; END IF;
  IF v_visit.payment_status = 'paid'
     OR EXISTS (SELECT 1 FROM clinic_transactions WHERE visit_id = p_visit_id) THEN
    RAISE EXCEPTION 'Visit ini sudah di-close sebelumnya';
  END IF;

  IF p_payment_method IS NULL OR trim(p_payment_method) = '' THEN
    RAISE EXCEPTION 'Metode pembayaran wajib diisi';
  END IF;

  IF p_discount > p_service_price THEN
    RAISE EXCEPTION 'Diskon (%) tidak boleh melebihi harga layanan (%)', p_discount, p_service_price;
  END IF;

  IF p_admin_fee < 0 THEN
    RAISE EXCEPTION 'Biaya admin (%) tidak boleh negatif', p_admin_fee;
  END IF;

  -- Pembelian paket. Prioritas: array p_purchase_packages (multi). Fallback ke
  -- param single lama bila array tidak diisi. Kolom transaksi single (package_id,
  -- patient_package_id) diisi dari paket PERTAMA agar receipt lama tetap tampil.
  IF p_purchase_packages IS NOT NULL AND jsonb_array_length(p_purchase_packages) > 0 THEN
    FOR v_pkg IN SELECT jsonb_array_elements(p_purchase_packages) LOOP
      IF (v_pkg->>'id') IS NULL OR (v_pkg->>'sessions') IS NULL THEN
        RAISE EXCEPTION 'Data paket baru tidak lengkap';
      END IF;
      INSERT INTO clinic_patient_packages (
        patient_id, package_id, total_sessions, used_sessions, is_active, notes, purchased_at
      ) VALUES (
        p_patient_id, (v_pkg->>'id')::uuid, (v_pkg->>'sessions')::integer, 0, true,
        NULLIF(v_pkg->>'notes', ''), now()
      ) RETURNING id INTO v_new_patient_package_id;
      IF v_first_patient_package_id IS NULL THEN
        v_first_patient_package_id := v_new_patient_package_id;
        v_first_package_id := (v_pkg->>'id')::uuid;
      END IF;
    END LOOP;
    v_is_purchase := true;
  ELSIF p_purchase_package THEN
    IF p_purchase_package_id IS NULL OR p_purchase_package_sessions IS NULL THEN
      RAISE EXCEPTION 'Data paket baru tidak lengkap';
    END IF;
    INSERT INTO clinic_patient_packages (
      patient_id, package_id, total_sessions, used_sessions, is_active, notes, purchased_at
    ) VALUES (
      p_patient_id, p_purchase_package_id, p_purchase_package_sessions, 0, true, p_purchase_package_notes, now()
    ) RETURNING id INTO v_first_patient_package_id;
    v_first_package_id := p_purchase_package_id;
    v_is_purchase := true;
  END IF;

  INSERT INTO clinic_transactions (
    visit_id, patient_id, service_id, service_name, service_price, discount, admin_fee,
    total_amount, payment_method, payment_detail, payment_status, notes, cashier_name,
    is_locked, locked_at, locked_by,
    patient_package_id, is_package_purchase, package_id, used_package_ids
  ) VALUES (
    p_visit_id, p_patient_id, p_service_id, p_service_name, p_service_price, p_discount, p_admin_fee,
    p_total_amount, p_payment_method, p_payment_detail, 'paid', p_notes, p_cashier_name,
    true, now(), COALESCE(p_locked_by, p_cashier_name),
    v_first_patient_package_id, v_is_purchase, v_first_package_id,
    CASE WHEN cardinality(p_use_package_ids) > 0 THEN p_use_package_ids ELSE NULL END
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

GRANT EXECUTE ON FUNCTION public.close_clinic_bill(
  uuid, uuid, uuid, character varying, integer, integer, integer, character varying,
  jsonb, text, character varying, character varying, uuid[], boolean, uuid, integer,
  text, integer, jsonb
) TO anon, authenticated, service_role;
