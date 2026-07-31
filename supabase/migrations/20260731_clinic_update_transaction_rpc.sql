-- ─────────────────────────────────────────────────────────────────────────────
-- Edit transaksi klinik (setelah unlock) — RPC ATOMIK update_clinic_transaction.
-- Satu transaksi DB: validasi -> update clinic_transactions -> sinkron
-- clinic_visits.payment_amount/payment_method -> tulis audit diff -> RE-LOCK.
-- Tidak mungkin transaksi berubah tanpa audit, atau angka transaksi & visit
-- berbeda (all-or-nothing).
-- Pola dokumentasi repo: file ini snapshot skema; TIDAK auto-apply — jalankan
-- manual ke project cpvzwqptzcxnwzfzgrmt setelah review.
-- ─────────────────────────────────────────────────────────────────────────────
BEGIN;

CREATE OR REPLACE FUNCTION public.update_clinic_transaction(
  p_transaction_id uuid,
  p_service_price integer,
  p_discount integer,
  p_admin_fee integer,
  p_total_amount integer,
  p_payment_method character varying,
  p_payment_detail jsonb,
  p_notes text,
  p_cashier_name character varying,
  p_reason text,
  p_performed_by character varying,
  p_performed_by_role character varying DEFAULT NULL
) RETURNS clinic_transactions
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_old clinic_transactions;
  v_new clinic_transactions;
  v_changes jsonb := '[]'::jsonb;
  v_parts text[] := '{}';
BEGIN
  SELECT * INTO v_old FROM clinic_transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transaksi tidak ditemukan'; END IF;

  -- Alur unlock-dulu ditegakkan di DB, bukan cuma UI.
  IF v_old.is_locked THEN
    RAISE EXCEPTION 'Transaksi terkunci — buka kunci dulu sebelum edit';
  END IF;

  IF p_reason IS NULL OR trim(p_reason) = '' THEN
    RAISE EXCEPTION 'Alasan perubahan wajib diisi';
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
  -- Lebih ketat dari RPC create: persamaan total di-enforce (form menghitung
  -- total otomatis; ini pengaman ganda terhadap total ngawur).
  IF p_total_amount <> p_service_price - p_discount + p_admin_fee THEN
    RAISE EXCEPTION 'Total (%) tidak konsisten: % - % + % = %',
      p_total_amount, p_service_price, p_discount, p_admin_fee,
      p_service_price - p_discount + p_admin_fee;
  END IF;

  -- Diff field-per-field untuk audit (nilai lama -> baru).
  IF v_old.service_price IS DISTINCT FROM p_service_price THEN
    v_changes := v_changes || jsonb_build_object('field', 'service_price', 'from', v_old.service_price, 'to', p_service_price);
    v_parts := v_parts || format('service_price: %s -> %s', v_old.service_price, p_service_price);
  END IF;
  IF v_old.discount IS DISTINCT FROM p_discount THEN
    v_changes := v_changes || jsonb_build_object('field', 'discount', 'from', v_old.discount, 'to', p_discount);
    v_parts := v_parts || format('discount: %s -> %s', v_old.discount, p_discount);
  END IF;
  IF v_old.admin_fee IS DISTINCT FROM p_admin_fee THEN
    v_changes := v_changes || jsonb_build_object('field', 'admin_fee', 'from', v_old.admin_fee, 'to', p_admin_fee);
    v_parts := v_parts || format('admin_fee: %s -> %s', v_old.admin_fee, p_admin_fee);
  END IF;
  IF v_old.total_amount IS DISTINCT FROM p_total_amount THEN
    v_changes := v_changes || jsonb_build_object('field', 'total_amount', 'from', v_old.total_amount, 'to', p_total_amount);
    v_parts := v_parts || format('total_amount: %s -> %s', v_old.total_amount, p_total_amount);
  END IF;
  IF v_old.payment_method IS DISTINCT FROM p_payment_method THEN
    v_changes := v_changes || jsonb_build_object('field', 'payment_method', 'from', v_old.payment_method, 'to', p_payment_method);
    v_parts := v_parts || format('payment_method: %s -> %s', v_old.payment_method, p_payment_method);
  END IF;
  IF v_old.payment_detail IS DISTINCT FROM p_payment_detail THEN
    v_changes := v_changes || jsonb_build_object('field', 'payment_detail', 'from', v_old.payment_detail, 'to', p_payment_detail);
    -- array_append eksplisit: literal tanpa tipe pada text[] || 'x' dipilih Postgres
    -- sebagai array||array dan meledak 'malformed array literal'.
    v_parts := array_append(v_parts, 'payment_detail diubah');
  END IF;
  IF v_old.notes IS DISTINCT FROM p_notes THEN
    v_changes := v_changes || jsonb_build_object('field', 'notes', 'from', v_old.notes, 'to', p_notes);
    v_parts := v_parts || format('notes: %s -> %s', coalesce(v_old.notes, '-'), coalesce(p_notes, '-'));
  END IF;
  IF v_old.cashier_name IS DISTINCT FROM p_cashier_name THEN
    v_changes := v_changes || jsonb_build_object('field', 'cashier_name', 'from', v_old.cashier_name, 'to', p_cashier_name);
    v_parts := v_parts || format('cashier_name: %s -> %s', coalesce(v_old.cashier_name, '-'), coalesce(p_cashier_name, '-'));
  END IF;

  -- Tidak ada perubahan: jangan menulis apa pun (tanpa audit, tanpa re-lock).
  IF jsonb_array_length(v_changes) = 0 THEN
    RETURN v_old;
  END IF;

  UPDATE clinic_transactions SET
    service_price  = p_service_price,
    discount       = p_discount,
    admin_fee      = p_admin_fee,
    total_amount   = p_total_amount,
    payment_method = p_payment_method,
    payment_detail = p_payment_detail,
    notes          = p_notes,
    cashier_name   = p_cashier_name,
    -- Re-lock otomatis: pola "simpan = kunci" konsisten dgn screening/consent/assessment.
    is_locked = true, locked_at = now(), locked_by = p_performed_by,
    updated_at = now()
  WHERE id = p_transaction_id
  RETURNING * INTO v_new;

  -- Sinkron visit HANYA bila komponen yang memang ditulis close_clinic_bill berubah —
  -- mencegah dua sumber angka berbeda (clinic_transactions vs clinic_visits).
  IF v_old.visit_id IS NOT NULL
     AND (v_old.total_amount IS DISTINCT FROM p_total_amount
          OR v_old.payment_method IS DISTINCT FROM p_payment_method) THEN
    UPDATE clinic_visits
    SET payment_amount = p_total_amount,
        payment_method = p_payment_method,
        updated_at = now()
    WHERE id = v_old.visit_id;
  END IF;

  INSERT INTO clinic_audit_logs (action, record_type, record_id, performed_by, performed_by_role, reason, metadata)
  VALUES (
    'edit_transaction',
    'clinic_transactions',
    p_transaction_id,
    p_performed_by,
    p_performed_by_role,
    trim(p_reason) || ' | ' || array_to_string(v_parts, '; '),
    jsonb_build_object('changes', v_changes)
  );

  RETURN v_new;
END; $function$;

COMMIT;
