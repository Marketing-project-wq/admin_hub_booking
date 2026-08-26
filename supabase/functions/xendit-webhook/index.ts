// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "xendit-webhook" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. WAJIB deploy manual ke Supabase setelah edit.
// supabase functions deploy xendit-webhook --no-verify-jwt
// ───────────────────────────────────────────────────────────────────────────
//
// Satu handler untuk SEMUA tipe booking + membership Xendit:
//   BK-  → arena_bookings
//   CL-  → arena_class_bookings
//   GM-  → gym_class_bookings
//   PKG- → arena_package_orders   (+ generate voucher)
//   CLC- → clinic_bookings        (+ claim slot)
//   MBR- → gym_membership_orders  (+ provision membership)
//
// Xendit Invoice webhook payload (flat):
//   { id, external_id, status, paid_amount, ... }
//   status: "PAID" | "SETTLED" | "EXPIRED"
//
// Env wajib di Supabase Edge Function secrets:
//   XENDIT_CALLBACK_TOKEN — dari Xendit dashboard → Webhooks → Callback Token
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY — otomatis tersedia di edge functions

import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-callback-token, Authorization, apikey",
}

const TABLE_MAP: Record<string, string> = {
  "BK-":  "arena_bookings",
  "CL-":  "arena_class_bookings",
  "GM-":  "gym_class_bookings",
  "PKG-": "arena_package_orders",
  "CLC-": "clinic_bookings",
  "MBR-": "gym_membership_orders",
}

const CODE_FIELD: Record<string, string> = {
  arena_bookings:        "booking_code",
  arena_class_bookings:  "booking_code",
  gym_class_bookings:    "booking_code",
  arena_package_orders:  "order_code",
  clinic_bookings:       "booking_code",
  gym_membership_orders: "order_code",
}

// Kolom ekstra yang HANYA ada di tabel tertentu — jangan select di tabel lain
// atau PostgREST error → update rollback → Xendit retry selamanya.
const EXTRA_SELECT: Record<string, string> = {
  arena_class_bookings:  ", group_id",
  clinic_bookings:       ", slot_id",
  gym_membership_orders: ", duration_months, email, full_name, plan_name, price",
}

function extractBookingCode(text: string): string | null {
  if (!text) return null
  const match = text.match(/((?:CLC|MBR|PKG|BK|CL|GM)-[\w-]+)/i)
  return match ? match[1].toUpperCase() : null
}

function wibToday(): string {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function addMonths(startISO: string, months: number): string {
  const [y, m, d] = startISO.split("-").map(Number)
  const base = new Date(Date.UTC(y, m - 1, d))
  const target = new Date(Date.UTC(y, m - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(d, lastDay))
  return (target < base ? base : target).toISOString().slice(0, 10)
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  // Verifikasi callback token Xendit
  const callbackToken = req.headers.get("x-callback-token")
  const XENDIT_CALLBACK_TOKEN = Deno.env.get("XENDIT_CALLBACK_TOKEN")
  if (!XENDIT_CALLBACK_TOKEN || callbackToken !== XENDIT_CALLBACK_TOKEN) {
    console.error("Invalid callback token")
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  let body: Record<string, unknown> = {}
  try {
    const raw = await req.text()
    console.log("=== XENDIT WEBHOOK RECEIVED ===", raw.slice(0, 500))
    body = JSON.parse(raw)
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  // Xendit Invoice webhook: flat payload { id, external_id, status, ... }
  const xenditStatus = String(body?.status || "").toUpperCase()
  const externalId   = String(body?.external_id || body?.externalId || "")
  const paymentId    = String(body?.id || "")

  let newStatus: "confirmed" | "cancelled" | null = null
  if (xenditStatus === "PAID" || xenditStatus === "SETTLED") {
    newStatus = "confirmed"
  } else if (xenditStatus === "EXPIRED") {
    newStatus = "cancelled"
  }

  if (!newStatus) {
    console.log("Skipping Xendit status:", xenditStatus)
    return new Response(JSON.stringify({ ok: true, skipped: true, xenditStatus }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  // external_id selalu = booking_code karena kita yang set saat create-xendit-payment
  const bookingCode = extractBookingCode(externalId) || extractBookingCode(String(body?.description || ""))
  if (!bookingCode) {
    console.error("No booking code in external_id:", externalId)
    return new Response(JSON.stringify({ ok: false, reason: "no_booking_code", external_id: externalId }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  const prefix = bookingCode.startsWith("CLC-") ? "CLC-"
               : bookingCode.startsWith("MBR-") ? "MBR-"
               : bookingCode.startsWith("PKG-") ? "PKG-"
               : bookingCode.startsWith("BK-")  ? "BK-"
               : bookingCode.startsWith("CL-")  ? "CL-"
               : bookingCode.startsWith("GM-")  ? "GM-"
               : null

  const tableName = prefix ? TABLE_MAP[prefix] : null
  const codeField = tableName ? CODE_FIELD[tableName] : null

  if (!tableName || !codeField) {
    console.error("Unknown booking code prefix:", bookingCode)
    return new Response(JSON.stringify({ ok: false, reason: "unknown_prefix", bookingCode }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // Guard: clinic booking yang dibayar voucher (price=0) tidak boleh ditimpa gateway
  if (tableName === "clinic_bookings" && newStatus === "confirmed") {
    const { data: existing } = await supabase
      .from("clinic_bookings")
      .select("payment_method, price")
      .eq(codeField, bookingCode)
      .maybeSingle()
    const ex = existing as { payment_method: string | null; price: number | null } | null
    if (ex && (ex.payment_method === "voucher" || (ex.price ?? 0) === 0)) {
      console.warn("Skip: voucher/zero-price clinic booking:", bookingCode)
      return new Response(JSON.stringify({ ok: true, skipped: "voucher_or_zero_price", bookingCode }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }
  }

  const updatePayload: Record<string, unknown> = {
    status: newStatus,
    updated_at: new Date().toISOString(),
  }
  if (newStatus === "confirmed") {
    updatePayload.payment_method = "xendit"
    updatePayload.paid_at = new Date().toISOString()
    if (paymentId) updatePayload.payment_ref = paymentId
  }

  const selectFields = `id, ${codeField}, status, paid_at${EXTRA_SELECT[tableName] ?? ""}`
  const { data: updated, error: updErr } = await supabase
    .from(tableName)
    .update(updatePayload)
    .eq(codeField, bookingCode)
    .select(selectFields)

  if (updErr) {
    console.error("Update error:", updErr)
    return new Response(JSON.stringify({ error: updErr.message }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  console.log(`Updated ${tableName} for ${bookingCode}:`, updated?.length ?? 0, "rows")

  if (!updated || updated.length === 0 || newStatus !== "confirmed") {
    return new Response(JSON.stringify({ ok: true, bookingCode, tableName, newStatus, rows: updated?.length ?? 0 }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  // ── Post-confirm side-effects ─────────────────────────────────────────────

  // GROUP BOOKING: konfirmasi semua member group (arena_class_bookings)
  let groupRowsUpdated = 0
  if (tableName === "arena_class_bookings") {
    const groupId = (updated[0] as any)?.group_id
    if (groupId) {
      const { data: groupUpdated, error: groupErr } = await supabase
        .from("arena_class_bookings")
        .update({ status: "confirmed", payment_method: "xendit", paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("group_id", groupId)
        .eq("status", "pending_payment")
        .neq("booking_code", bookingCode)
        .select("booking_code, full_name")
      if (groupErr) console.error("Group update error:", groupErr)
      else groupRowsUpdated = groupUpdated?.length || 0
    }
  }

  // META CAPI Purchase event (arena_class_bookings)
  if (tableName === "arena_class_bookings") {
    try {
      const { data: bookingDetail } = await supabase
        .from("arena_class_bookings")
        .select("id, booking_code, full_name, email, phone, price, discount, arena_class_schedules(schedule_date, start_time, arena_class_types(name))")
        .eq("booking_code", bookingCode)
        .single()
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-meta-capi`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({
          event_name: "Purchase",
          email: bookingDetail?.email,
          phone: bookingDetail?.phone,
          value: (bookingDetail?.price ?? 0) - (bookingDetail?.discount || 0),
          currency: "IDR",
          content_name: (bookingDetail?.arena_class_schedules as any)?.arena_class_types?.name,
          booking_code: bookingCode,
        }),
      })
    } catch (e) { console.error("CAPI error (non-blocking):", e) }
  }

  // EMAIL konfirmasi (BK- dan CL-)
  if (tableName === "arena_class_bookings" || tableName === "arena_bookings") {
    try {
      await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: JSON.stringify({ event: "payment.received", data: { description: `Booking 20FIT - ${bookingCode}` } }),
      })
    } catch (e) { console.error("Email error (non-blocking):", e) }
  }

  // CLINIC SLOT CLAIM
  if (tableName === "clinic_bookings") {
    const { id: bookingId, slot_id: slotId } = updated[0] as { id?: string; slot_id?: string }
    if (slotId && bookingId) {
      const { error: slotErr } = await supabase.rpc("claim_clinic_slot", {
        p_slot_id: slotId,
        p_claimed_by_type: "booking",
        p_claimed_by_id: bookingId,
      })
      if (slotErr) console.error("Slot claim error (non-blocking):", slotErr)
    }
  }

  // PACKAGE VOUCHER
  if (tableName === "arena_package_orders") {
    const orderId = updated[0].id
    try {
      const { data: existing } = await supabase
        .from("arena_package_vouchers").select("id, voucher_code").eq("order_id", orderId).limit(1)
      if (!existing || existing.length === 0) {
        const { data: orderData } = await supabase.from("arena_package_orders").select("sessions").eq("id", orderId).single()
        const { data: voucherCode } = await supabase.rpc("generate_package_voucher_code")
        if (voucherCode) {
          await supabase.from("arena_package_vouchers").insert({
            voucher_code: voucherCode,
            order_id: orderId,
            total_sessions: orderData?.sessions ?? 5,
            used_sessions: 0,
            is_active: true,
          })
        }
      }
    } catch (e) { console.error("Voucher generation error (non-blocking):", e) }
  }

  // MEMBERSHIP PROVISION
  if (tableName === "gym_membership_orders") {
    const order = updated[0] as any
    try {
      const startDate = wibToday()
      const endDate = addMonths(startDate, order.duration_months ?? 1)
      const { error: memErr } = await supabase.from("gym_memberships").insert({
        order_id: order.id,
        email: order.email,
        full_name: order.full_name,
        plan_name: order.plan_name,
        start_date: startDate,
        end_date: endDate,
        is_active: true,
      })
      if (memErr) console.error("Membership insert error:", memErr)
    } catch (e) { console.error("Membership provision error (non-blocking):", e) }
  }

  return new Response(JSON.stringify({ ok: true, bookingCode, tableName, newStatus, rows: updated.length, groupRowsUpdated }), {
    status: 200, headers: { ...CORS, "Content-Type": "application/json" },
  })
})
