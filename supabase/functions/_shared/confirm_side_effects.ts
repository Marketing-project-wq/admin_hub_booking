// confirm_side_effects.ts — efek samping SETELAH transaksi confirmed. Dipakai bareng
// xendit-check-payment, confirm-free-payment, dan start-split-payment. Idempoten +
// SELALU cek `error` (supabase-js return {error}, bukan throw).
import type { SupabaseClient } from "jsr:@supabase/supabase-js@2";

function wibToday(): Date { return new Date(Date.now() + 7 * 60 * 60 * 1000); }

export async function issuePackageVoucher(
  admin: SupabaseClient, orderId: string, sessions: number | null | undefined, tag = "issuePackageVoucher",
): Promise<void> {
  const { data: existing, error: exErr } = await admin
    .from("arena_package_vouchers").select("id").eq("order_id", orderId).limit(1);
  if (exErr) { console.error(`[${tag}] cek voucher gagal:`, exErr.message); return; }
  if (existing && existing.length > 0) return;
  const { data: vcode, error: genErr } = await admin.rpc("generate_package_voucher_code");
  if (genErr || !vcode) { console.error(`[${tag}] generate kode voucher gagal:`, genErr?.message ?? "kode kosong"); return; }
  const { error: insErr } = await admin.from("arena_package_vouchers").insert({
    voucher_code: vcode, order_id: orderId, total_sessions: Number(sessions ?? 5), used_sessions: 0, is_active: true,
  });
  if (insErr) console.error(`[${tag}] insert voucher paket gagal:`, insErr.message);
}

// Voucher paket COACH (CPKG-). Bentuk kode & kolomnya MIRROR PERSIS dari blok
// coach di `xendit-webhook` yang sudah live — jangan diubah, kalau tidak dua
// jalur yang sama (webhook vs polling vs Rp 0) akan menerbitkan voucher yang
// berbeda bentuk untuk pembelian yang sama.
//
// Idempoten lewat cek `order_id` lebih dulu: polling app, webhook Xendit, dan
// jalur Rp 0 semuanya bisa menyentuh order yang sama.
export async function issueCoachPackageVoucher(
  admin: SupabaseClient, orderId: string, tag = "issueCoachPackageVoucher",
): Promise<void> {
  const { data: existing, error: exErr } = await admin
    .from("coach_package_vouchers").select("id").eq("order_id", orderId).limit(1);
  if (exErr) { console.error(`[${tag}] cek voucher gagal:`, exErr.message); return; }
  if (existing && existing.length > 0) return;
  const { data: order } = await admin.from("coach_package_orders")
    .select("coach_id, tier, sessions, validity_months").eq("id", orderId).maybeSingle();
  const voucherCode = "CV-" + Date.now().toString(36).toUpperCase() + "-" +
    Math.random().toString(36).slice(2, 6).toUpperCase();
  const { error } = await admin.from("coach_package_vouchers").insert({
    voucher_code: voucherCode, order_id: orderId, coach_id: order?.coach_id, tier: order?.tier,
    total_sessions: order?.sessions ?? 0, used_sessions: 0, validity_months: order?.validity_months ?? null,
    first_used_at: null, is_active: true,
  });
  if (error) console.error(`[${tag}]`, error.message);
}

export async function claimClinicSlot(
  admin: SupabaseClient, slotId: string, bookingId: string, tag = "claimClinicSlot",
): Promise<void> {
  const { error } = await admin.rpc("claim_clinic_slot", {
    p_slot_id: slotId, p_claimed_by_type: "booking", p_claimed_by_id: bookingId,
  });
  if (error) console.error(`[${tag}] klaim slot gagal:`, error.message);
}

export async function provisionMembership(
  admin: SupabaseClient,
  order: { id: string; order_code?: string | null; plan_id: string; full_name?: string | null; email?: string | null; phone?: string | null; duration_months?: number | null; },
  tag = "provisionMembership",
): Promise<boolean> {
  const { data: existing, error: exErr } = await admin
    .from("gym_memberships").select("id").eq("order_id", order.id).limit(1);
  if (exErr) { console.error(`[${tag}] cek membership gagal:`, exErr.message); return false; }
  if (existing && existing.length > 0) return true;
  const months = Number(order.duration_months ?? 1);
  const wib = wibToday();
  const startDate = wib.toISOString().slice(0, 10);
  const endDate = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() + months, wib.getUTCDate())).toISOString().slice(0, 10);
  const { data, error } = await admin.from("gym_memberships").insert({
    order_id: order.id, plan_id: order.plan_id, full_name: order.full_name, email: order.email, phone: order.phone,
    duration_months: months, start_date: startDate, end_date: endDate, is_active: true,
    source: "membership_purchase", source_ref: order.order_code ?? null,
  }).select("id").maybeSingle();
  if (error || !data) { console.error(`[${tag}] MEMBERSHIP GAGAL DIBUAT untuk order ${order.order_code ?? order.id}:`, error?.message ?? "insert tidak mengembalikan baris"); return false; }
  return true;
}

// Voucher paket PT (PTP-) — sisi pemakaian sesi milik coach/admin. Idempoten lewat
// cek `order_id` (kolom itu juga UNIQUE di pt_package_vouchers): polling app,
// webhook Xendit, dan split poin semuanya bisa menyentuh order yang sama.
// expires_at = hari ini (WIB) + validity_months bulan, sama cara hitung membership.
export async function issuePtPackageVoucher(
  admin: SupabaseClient, orderId: string, tag = "issuePtPackageVoucher",
): Promise<void> {
  const { data: existing, error: exErr } = await admin
    .from("pt_package_vouchers").select("id").eq("order_id", orderId).limit(1);
  if (exErr) { console.error(`[${tag}] cek voucher PT gagal:`, exErr.message); return; }
  if (existing && existing.length > 0) return;
  const { data: order, error: ordErr } = await admin.from("pt_package_orders")
    .select("sessions, coach_name, validity_months").eq("id", orderId).maybeSingle();
  if (ordErr || !order) { console.error(`[${tag}] order PT ${orderId} tak terbaca:`, ordErr?.message ?? "tidak ditemukan"); return; }
  const months = Number(order.validity_months ?? 0);
  const wib = wibToday();
  const expiresAt = new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth() + months, wib.getUTCDate())).toISOString().slice(0, 10);
  const voucherCode = "PTV-" + Date.now().toString(36).toUpperCase() + "-" +
    Math.random().toString(36).slice(2, 6).toUpperCase();
  const { error } = await admin.from("pt_package_vouchers").insert({
    order_id: orderId, voucher_code: voucherCode, coach_name: order.coach_name,
    total_sessions: order.sessions ?? 0, used_sessions: 0, expires_at: expiresAt, is_active: true,
  });
  if (error) console.error(`[${tag}] insert voucher PT gagal untuk order ${orderId}:`, error.message);
}
