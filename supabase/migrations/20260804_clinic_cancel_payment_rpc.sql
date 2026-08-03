-- ─────────────────────────────────────────────────────────────────────────────
-- Fitur "Batalkan Pembayaran" (reset total setelah Close Bill — beda dari Edit
-- Transaksi yang hanya koreksi angka/metode):
--
-- (1) Kolom baru clinic_transactions.used_package_ids: merekam paket pasien
--     yang sesinya DIPOTONG oleh transaksi tsb. Selama ini p_use_package_ids
--     menaikkan used_sessions tanpa jejak di baris transaksi, sehingga
--     pembatalan tidak bisa mengembalikan sesi secara andal. Transaksi LAMA
--     (kolom NULL) memang tidak bisa direstore — di produksi belum pernah ada
--     sesi terpotong, jadi tidak ada kasus historis.
-- (2) close_clinic_bill: CREATE OR REPLACE (signature 18 param TIDAK berubah),
--     body identik versi guard-fix + menulis used_package_ids.
-- (3) RPC baru cancel_clinic_payment: hapus transaksi + reset visit ke unpaid
--     (status klinis TIDAK diubah — visit muncul lagi di pending Close Bill),
--     hapus paket "hantu" hasil pembelian transaksi ini (guard: hanya bila
--     belum terpakai), kembalikan sesi paket dari rekaman used_package_ids,
--     audit log lengkap. Atomik; alasan & unlock wajib (pola edit_transaction).
--
-- Pola dokumentasi repo: file ini snapshot skema; TIDAK auto-apply.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

-- (1) Rekam paket yang dipotong per transaksi
ALTER TABLE public.clinic_transactions
  ADD COLUMN IF NOT EXISTS used_package_ids uuid[];

COMMENT ON COLUMN public.clinic_transactions.used_package_ids IS
  'ID clinic_patient_packages yang sesinya dipotong (+1 used_sessions) oleh transaksi ini; NULL = tidak memotong sesi ATAU transaksi sebelum kolom ini ada. Dipakai cancel_clinic_payment utk mengembalikan sesi.';

-- (2) close_clinic_bill — body verbatim guard-fix + tulis used_package_ids
CREATE OR REPLACE FUNCTION public.close_clinic_bill(p_visit_id uuid, p_patient_id uuid, p_service_id uuid, p_service_name character varying, p_service_price integer, p_discount integer, p_total_amount integer, p_payment_method character varying, p_payment_detail jsonb, p_notes text, p_cashier_name character varying, p_locked_by character varying DEFAULT NULL::character varying, p_use_package_ids uuid[] DEFAULT '{}'::uuid[], p_purchase_package boolean DEFAULT false, p_purchase_package_id uuid DEFAULT NULL::uuid, p_purchase_package_sessions integer DEFAULT NULL::integer, p_purchase_package_notes text DEFAULT NULL::text, p_admin_fee integer DEFAULT 0)
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
  -- Guard anti dobel-close: HANYA indikator billing (bukan status klinis).
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
    visit_id, patient_id, service_id, service_name, service_price, discount, admin_fee,
    total_amount, payment_method, payment_detail, payment_status, notes, cashier_name,
    is_locked, locked_at, locked_by,
    patient_package_id, is_package_purchase, package_id, used_package_ids
  ) VALUES (
    p_visit_id, p_patient_id, p_service_id, p_service_name, p_service_price, p_discount, p_admin_fee,
    p_total_amount, p_payment_method, p_payment_detail, 'paid', p_notes, p_cashier_name,
    true, now(), COALESCE(p_locked_by, p_cashier_name),
    v_new_patient_package_id, p_purchase_package, p_purchase_package_id,
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

-- (3) RPC pembatalan pembayaran
CREATE OR REPLACE FUNCTION public.cancel_clinic_payment(
  p_transaction_id uuid,
  p_reason text,
  p_performed_by text,
  p_performed_by_role text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_trx clinic_transactions;
  v_pkg clinic_patient_packages;
  v_pkg_id uuid;
BEGIN
  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi';
  END IF;

  SELECT * INTO v_trx FROM clinic_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaksi tidak ditemukan'; END IF;

  -- Konsisten alur edit: transaksi terkunci harus di-unlock dulu.
  IF v_trx.is_locked THEN
    RAISE EXCEPTION 'Transaksi masih terkunci — buka kunci terlebih dahulu';
  END IF;

  -- Paket yang DIBELI lewat transaksi ini: boleh ikut dihapus HANYA bila belum
  -- ada sesi terpakai — kalau sudah dipakai visit lain, hapus otomatis akan
  -- merusak data; harus dibereskan manual dulu.
  IF v_trx.is_package_purchase AND v_trx.patient_package_id IS NOT NULL THEN
    SELECT * INTO v_pkg FROM clinic_patient_packages
    WHERE id = v_trx.patient_package_id FOR UPDATE;
    IF FOUND AND v_pkg.used_sessions > 0 THEN
      RAISE EXCEPTION 'Paket dari transaksi ini sudah terpakai % sesi — batalkan tidak bisa otomatis, bereskan pemakaian paket dulu', v_pkg.used_sessions;
    END IF;
  END IF;

  -- Kembalikan sesi paket yang dipotong transaksi ini (dari rekaman
  -- used_package_ids; transaksi lama tanpa rekaman = tidak ada yang direstore).
  IF v_trx.used_package_ids IS NOT NULL THEN
    FOREACH v_pkg_id IN ARRAY v_trx.used_package_ids LOOP
      UPDATE clinic_patient_packages
      SET used_sessions = greatest(used_sessions - 1, 0),
          is_active = true,
          updated_at = now()
      WHERE id = v_pkg_id;
    END LOOP;
  END IF;

  -- Hapus transaksi DULU (kolom patient_package_id me-referensi paket),
  -- baru paket hasil pembeliannya.
  DELETE FROM clinic_transactions WHERE id = p_transaction_id;

  IF v_trx.is_package_purchase AND v_trx.patient_package_id IS NOT NULL THEN
    DELETE FROM clinic_patient_packages WHERE id = v_trx.patient_package_id;
  END IF;

  -- Reset billing visit; status KLINIS tidak diubah — visit kembali memenuhi
  -- filter pending Kasir (unpaid + in_progress/completed) utk Close Bill ulang.
  IF v_trx.visit_id IS NOT NULL THEN
    UPDATE clinic_visits
    SET payment_status = 'unpaid', payment_method = NULL, payment_amount = NULL,
        updated_at = now()
    WHERE id = v_trx.visit_id;
  END IF;

  INSERT INTO clinic_audit_logs (action, record_type, record_id, performed_by, performed_by_role, reason, metadata)
  VALUES (
    'cancel_payment',
    'clinic_transactions',
    p_transaction_id,
    p_performed_by,
    p_performed_by_role,
    trim(p_reason),
    jsonb_build_object(
      'transaction_code', v_trx.transaction_code,
      'visit_id', v_trx.visit_id,
      'service_name', v_trx.service_name,
      'service_price', v_trx.service_price,
      'discount', v_trx.discount,
      'admin_fee', v_trx.admin_fee,
      'total_amount', v_trx.total_amount,
      'payment_method', v_trx.payment_method,
      'deleted_patient_package_id',
        CASE WHEN v_trx.is_package_purchase THEN v_trx.patient_package_id ELSE NULL END,
      'restored_package_ids', to_jsonb(v_trx.used_package_ids)
    )
  );
END; $function$;

COMMIT;
