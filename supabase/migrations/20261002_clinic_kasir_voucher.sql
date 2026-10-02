-- Migration: Voucher Clinic di Kasir (Close Bill)
-- Date: 2026-10-02
--
-- Kasir bisa memasukkan kode voucher Clinic (arena_vouchers location='CLINIC', atau voucher
-- lama di tabel `vouchers`) saat Close Bill. Validasi + kuota memakai RPC yang sama dengan
-- checkout online (verify_clinic_voucher / redeem_clinic_voucher — migration
-- 20261002100000_clinic_vouchers.sql di repo ARENA-BOOKING).
--
--   * clinic_transactions.voucher_code / voucher_discount — dicatat per transaksi; sumber daftar
--     "Pemakaian" (sumber Kasir) di adminhub /clinic/vouchers. Kolom `discount` tetap total
--     diskon (manual + voucher booking + voucher kasir), jadi laporan lama tidak berubah.
--   * close_clinic_bill_with_voucher — redeem voucher + close_clinic_bill dalam SATU transaksi
--     DB: bila close bill gagal, pemakaian voucher ikut batal (kuota tidak bocor); bila
--     voucher sudah tidak valid / nilainya berubah, bill tidak ditutup.
--   * Trigger AFTER DELETE: cancel_clinic_payment (Batal Bayar) menghapus transaksi → kuota
--     voucher dikembalikan (used_count - 1).
--
-- Applied to production 2026-10-02 via Supabase MCP (this file is the version-controlled
-- mirror). Idempotent.

BEGIN;

ALTER TABLE public.clinic_transactions
  ADD COLUMN IF NOT EXISTS voucher_code text,
  ADD COLUMN IF NOT EXISTS voucher_discount integer;

CREATE INDEX IF NOT EXISTS clinic_transactions_voucher_code_idx
  ON public.clinic_transactions (voucher_code)
  WHERE voucher_code IS NOT NULL;

-- p_voucher_items = item yang ditagih ke voucher: [{ "service_id": "<uuid>", "price": 650000 }]
-- p_voucher_discount = nilai voucher yang ditampilkan ke kasir; harus sama dengan hasil redeem.
CREATE OR REPLACE FUNCTION public.close_clinic_bill_with_voucher(
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
  p_voucher_code text,
  p_voucher_items jsonb,
  p_voucher_discount integer,
  p_locked_by character varying DEFAULT NULL,
  p_use_package_ids uuid[] DEFAULT '{}'::uuid[],
  p_admin_fee integer DEFAULT 0,
  p_purchase_packages jsonb DEFAULT NULL
)
RETURNS public.clinic_transactions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r     jsonb;
  v_trx public.clinic_transactions;
BEGIN
  r := public.redeem_clinic_voucher(p_voucher_code, p_voucher_items);
  IF NOT coalesce((r->>'valid')::boolean, false) THEN
    RAISE EXCEPTION 'Voucher % tidak bisa dipakai: %', upper(btrim(coalesce(p_voucher_code, ''))), r->>'message';
  END IF;
  IF (r->>'discount_amount')::int IS DISTINCT FROM p_voucher_discount THEN
    RAISE EXCEPTION 'Nilai voucher berubah (sekarang Rp %) — terapkan ulang voucher', r->>'discount_amount';
  END IF;

  v_trx := public.close_clinic_bill(
    p_visit_id          => p_visit_id,
    p_patient_id        => p_patient_id,
    p_service_id        => p_service_id,
    p_service_name      => p_service_name,
    p_service_price     => p_service_price,
    p_discount          => p_discount,
    p_total_amount      => p_total_amount,
    p_payment_method    => p_payment_method,
    p_payment_detail    => p_payment_detail,
    p_notes             => p_notes,
    p_cashier_name      => p_cashier_name,
    p_locked_by         => p_locked_by,
    p_use_package_ids   => p_use_package_ids,
    p_admin_fee         => p_admin_fee,
    p_purchase_packages => p_purchase_packages
  );

  UPDATE public.clinic_transactions
  SET voucher_code = r->>'code', voucher_discount = p_voucher_discount
  WHERE id = v_trx.id
  RETURNING * INTO v_trx;

  RETURN v_trx;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_clinic_bill_with_voucher(
  uuid, uuid, uuid, character varying, integer, integer, integer, character varying, jsonb, text,
  character varying, text, jsonb, integer, character varying, uuid[], integer, jsonb
) TO anon, authenticated;

-- Batal Bayar menghapus transaksi → kembalikan 1 kuota voucher yang dipakainya.
CREATE OR REPLACE FUNCTION public.clinic_trx_release_voucher()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.voucher_code IS NOT NULL THEN
    UPDATE public.arena_vouchers
    SET used_count = greatest(coalesce(used_count, 0) - 1, 0), updated_at = now()
    WHERE upper(code) = upper(OLD.voucher_code) AND location = 'CLINIC';
    IF NOT FOUND THEN
      UPDATE public.vouchers
      SET used_count = greatest(coalesce(used_count, 0) - 1, 0), updated_at = now()
      WHERE upper(code) = upper(OLD.voucher_code)
        AND (applicable_units IS NULL OR 'clinic' = ANY (applicable_units));
    END IF;
  END IF;
  RETURN OLD;
END;
$$;

CREATE OR REPLACE TRIGGER trg_clinic_trx_release_voucher
  AFTER DELETE ON public.clinic_transactions
  FOR EACH ROW EXECUTE FUNCTION public.clinic_trx_release_voucher();

COMMIT;
