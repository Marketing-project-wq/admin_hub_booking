// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "mayar-webhook-arena" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy mayar-webhook-arena,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

// supabase/functions/mayar-webhook-arena/index.ts
// v9 — tambah group booking support: semua member group di-confirm sekaligus
import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, X-Mayar-Token, Authorization, x-callback-token",
}

const TABLE_MAP: Record<string, string> = {
  "BK-":  "arena_bookings",
  "CL-":  "arena_class_bookings",
  "GM-":  "gym_class_bookings",
  "PKG-": "arena_package_orders",
  "CLC-": "clinic_bookings",
}

const CODE_FIELD: Record<string, string> = {
  "arena_bookings":       "booking_code",
  "arena_class_bookings": "booking_code",
  "gym_class_bookings":   "booking_code",
  "arena_package_orders": "order_code",
  "clinic_bookings":      "booking_code",
}

function extractBookingCode(text: string): string | null {
  if (!text) return null
  const match = text.match(/((?:CLC|BK|CL|GM|PKG)-[\w-]+)/i)
  return match ? match[1].toUpperCase() : null
}

async function fetchMayarPaymentDetail(paymentId: string, apiKey: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://api.mayar.id/hl/v1/payment/${paymentId}`, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    })
    if (!res.ok) {
      console.error(`Mayar API error ${res.status} for payment ${paymentId}`)
      return null
    }
    const json = await res.json()
    return json?.data || null
  } catch (err) {
    console.error("Failed to fetch Mayar payment detail:", err)
    return null
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }

  try {
    const rawBody = await req.text()
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(rawBody) } catch { body = {} }

    console.log("=== MAYAR WEBHOOK v9 RECEIVED ===")
    console.log("Raw body:", rawBody)

    const event = String((body as any)?.event || (body as any)?.eventType || (body as any)?.type || "")
    const data  = (body as any)?.data || body

    console.log("Event:", event)
    console.log("Data keys:", Object.keys(data || {}))

    const evLower = event.toLowerCase()
    const txStatus = String(data?.transactionStatus || data?.status || "").toLowerCase()

    let newStatus: string | null = null
    if (
      evLower.includes("received") || evLower.includes("success") ||
      evLower.includes("paid") || evLower === "payment.completed" ||
      txStatus === "paid" || txStatus === "success" ||
      txStatus === "settlement" || txStatus === "capture"
    ) {
      newStatus = "confirmed"
    } else if (
      evLower.includes("failed") || evLower.includes("expired") ||
      evLower.includes("cancel") || txStatus === "failed" ||
      txStatus === "expired" || txStatus === "cancelled"
    ) {
      newStatus = "cancelled"
    }

    if (!newStatus) {
      console.log("⏭️ Skipping event:", event, "txStatus:", txStatus)
      return new Response(JSON.stringify({ ok: true, skipped: true, event, txStatus }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Step 1: Coba extract booking code dari webhook payload langsung
    const possibleSources = [
      data?.referenceId,
      data?.reference_id,
      data?.description,
      data?.productDescription,
      data?.productName,
      data?.product_name,
      data?.notes,
      data?.note,
      data?.externalId,
      data?.external_id,
      data?.title,
      data?.redirectUrl,
      data?.redirect_url,
    ].filter(Boolean).join(" | ")

    console.log("Step 1 - Search text:", possibleSources)
    let bookingCode = extractBookingCode(possibleSources)

    // Step 2: Kalau tidak ketemu, fetch detail dari Mayar API
    if (!bookingCode) {
      const paymentId = String(data?.id || data?.transactionId || data?.transaction_id || "")
      console.log("Step 2 - Fetching Mayar detail for paymentId:", paymentId)

      if (paymentId) {
        const MAYAR_API_KEY = Deno.env.get("MAYAR_API_KEY")
        if (MAYAR_API_KEY) {
          const detail = await fetchMayarPaymentDetail(paymentId, MAYAR_API_KEY)
          console.log("Mayar detail:", JSON.stringify(detail))

          if (detail) {
            const detailSources = [
              (detail as any)?.referenceId,
              (detail as any)?.description,
              (detail as any)?.redirectUrl,
              (detail as any)?.productName,
              (detail as any)?.externalId,
              (detail as any)?.name,
            ].filter(Boolean).join(" | ")

            console.log("Step 2 - Detail search text:", detailSources)
            bookingCode = extractBookingCode(detailSources)
          }
        } else {
          console.error("MAYAR_API_KEY not set, cannot fetch detail")
        }
      }
    }

    if (!bookingCode) {
      console.error("❌ No booking code found after all attempts")
      return new Response(JSON.stringify({
        ok: false, reason: "no_booking_code", searched: possibleSources,
      }), { status: 200, headers: { ...CORS, "Content-Type": "application/json" } })
    }

    console.log("✅ Booking code found:", bookingCode)

    // Determine table
    const tableKey = bookingCode.startsWith("CLC-") ? "CLC-"
                   : bookingCode.startsWith("PKG-") ? "PKG-"
                   : bookingCode.startsWith("BK-")  ? "BK-"
                   : bookingCode.startsWith("CL-")  ? "CL-"
                   : bookingCode.startsWith("GM-")  ? "GM-"
                   : null

    const tableName = tableKey ? TABLE_MAP[tableKey] : null
    const codeField = tableName ? CODE_FIELD[tableName] : null

    if (!tableName || !codeField) {
      console.error("❌ Unknown prefix:", bookingCode.substring(0, 4))
      return new Response(JSON.stringify({ ok: false, reason: "unknown_prefix" }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    console.log(`Table: ${tableName} | Field: ${codeField} | Status: ${newStatus}`)

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Update booking status
    const updatePayload: Record<string, unknown> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    }
    if (newStatus === "confirmed") {
      updatePayload.payment_method = "mayar"
      updatePayload.paid_at = new Date().toISOString()
      const ref = data?.id || data?.transactionId || data?.transaction_id || null
      if (ref) updatePayload.payment_ref = String(ref)
    }

    const selectFields = tableName === "clinic_bookings"
      ? `id, ${codeField}, status, paid_at, slot_id, group_id`
      : `id, ${codeField}, status, paid_at, group_id`

    const { data: updated, error: updErr } = await supabase
      .from(tableName)
      .update(updatePayload)
      .eq(codeField, bookingCode)
      .select(selectFields)

    if (updErr) {
      console.error("❌ Update error:", updErr)
      return new Response(JSON.stringify({ error: updErr.message }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    if (!updated || updated.length === 0) {
      console.warn("⚠️ No rows updated for", bookingCode)
    } else {
      console.log("✅ Updated:", updated)
    }

    // ─── GROUP BOOKING: update semua member group yang masih pending ──────────
    let groupRowsUpdated = 0
    if (
      newStatus === "confirmed" &&
      updated?.length > 0 &&
      tableName === "arena_class_bookings"
    ) {
      const groupId = (updated[0] as any)?.group_id

      if (groupId) {
        console.log("👥 Group booking detected, updating group members:", groupId)

        const { data: groupUpdated, error: groupErr } = await supabase
          .from("arena_class_bookings")
          .update({
            status: "confirmed",
            payment_method: "mayar",
            paid_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("group_id", groupId)
          .eq("status", "pending_payment")
          .neq("booking_code", bookingCode)
          .select("booking_code, full_name")

        if (groupErr) {
          console.error("❌ Group update error:", groupErr)
        } else {
          groupRowsUpdated = groupUpdated?.length || 0
          console.log(`✅ Group members updated (${groupRowsUpdated}):`, groupUpdated)
        }
      }
    }

    // ─── Meta CAPI: kirim event Purchase (arena_class_bookings confirmed) ─────
    if (
      newStatus === "confirmed" &&
      updated?.length > 0 &&
      tableName === "arena_class_bookings"
    ) {
      console.log("📊 Sending Meta CAPI Purchase event for:", bookingCode)

      // Ambil detail lengkap booking untuk payload CAPI
      const { data: bookingDetail } = await supabase
        .from("arena_class_bookings")
        .select(`
          id, booking_code, full_name, email, phone, price, discount,
          arena_class_schedules (
            schedule_date, start_time,
            arena_class_types (name)
          )
        `)
        .eq("booking_code", bookingCode)
        .single()

      // Non-blocking: kegagalan CAPI tidak mengganggu response webhook
      try {
        await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-meta-capi`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              event_name: "Purchase",
              email: bookingDetail?.email,
              phone: bookingDetail?.phone,
              value: (bookingDetail?.price ?? 0) - (bookingDetail?.discount || 0),
              currency: "IDR",
              content_name: (bookingDetail?.arena_class_schedules as any)?.arena_class_types?.name,
              booking_code: bookingCode,
            }),
          }
        )
        console.log("📊 Meta CAPI Purchase event sent for:", bookingCode)
      } catch (capiErr) {
        console.error("📊 CAPI call failed (non-blocking):", capiErr)
      }
    }

    // ─── Kirim email konfirmasi (CL- dan BK- saja) ───────────────────────────
    if (
      newStatus === "confirmed" &&
      updated?.length > 0 &&
      (tableName === "arena_class_bookings" || tableName === "arena_bookings")
    ) {
      console.log("📧 Sending confirmation email for:", bookingCode)
      try {
        const emailRes = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-email`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
            },
            body: JSON.stringify({
              event: "payment.received",
              data: {
                description: `Booking 20FIT - ${bookingCode}`,
              },
            }),
          }
        )
        const emailResult = await emailRes.json()
        console.log("📧 Email result:", emailResult)
      } catch (emailErr) {
        console.error("📧 Email send failed (non-blocking):", emailErr)
      }
    }

    // ─── Increment clinic slot booked_count ───────────────────────────────────
    if (tableName === "clinic_bookings" && newStatus === "confirmed" && updated?.length > 0) {
      const slotId = (updated[0] as { slot_id?: string }).slot_id
      if (slotId) {
        console.log("🏥 Incrementing clinic slot booked_count for slot:", slotId)
        const { error: slotErr } = await supabase
          .rpc("increment_clinic_slot_booked", { p_slot_id: slotId })
        if (slotErr) {
          console.error("❌ Slot increment error:", slotErr)
        } else {
          console.log("✅ Slot booked_count incremented")
        }
      }
    }

    // ─── Generate voucher untuk package order ─────────────────────────────────
    if (tableName === "arena_package_orders" && newStatus === "confirmed" && updated?.length > 0) {
      const orderId = updated[0].id
      console.log("📦 Generating package voucher for order:", orderId)

      try {
        const { data: existingVoucher } = await supabase
          .from("arena_package_vouchers")
          .select("id, voucher_code")
          .eq("order_id", orderId)
          .limit(1)

        if (existingVoucher && existingVoucher.length > 0) {
          console.log("⏭️ Voucher already exists:", existingVoucher[0].voucher_code)
        } else {
          const { data: orderData } = await supabase
            .from("arena_package_orders")
            .select("sessions")
            .eq("id", orderId)
            .single()

          const sessions = orderData?.sessions ?? 5
          const { data: voucherCode } = await supabase
            .rpc("generate_package_voucher_code")

          if (voucherCode) {
            const { error: voucherErr } = await supabase
              .from("arena_package_vouchers")
              .insert({
                voucher_code: voucherCode,
                order_id: orderId,
                total_sessions: sessions,
                used_sessions: 0,
                is_active: true,
              })

            if (voucherErr) {
              console.error("❌ Voucher insert error:", voucherErr)
            } else {
              console.log("✅ Voucher created:", voucherCode)
            }
          }
        }
      } catch (vErr) {
        console.error("💥 Voucher generation error:", vErr)
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      booking_code: bookingCode,
      table: tableName,
      status: newStatus,
      rows_updated: updated?.length || 0,
      group_rows_updated: groupRowsUpdated,
    }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" },
    })

  } catch (err) {
    console.error("💥 Webhook error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }
})
