// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "xendit-check-payment" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=true).
// WAJIB deploy manual: supabase functions deploy xendit-check-payment --project-ref cpvzwqptzcxnwzfzgrmt
// ───────────────────────────────────────────────────────────────────────────
//
// Poll status invoice Xendit → kalau PAID, update booking ke confirmed.
// Dipanggil dari confirmation page saat user kembali setelah bayar.
// Tidak butuh webhook — pola sama dengan ticket.20fit.id.
//
// Input:  { booking_code: string }
// Output: { status: "confirmed" | "pending_payment" | "cancelled", booking_code }
//
// Env: XENDIT_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const { booking_code } = await req.json()
    if (!booking_code) {
      return new Response(JSON.stringify({ error: "booking_code wajib" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    const XENDIT_SECRET_KEY = Deno.env.get("XENDIT_SECRET_KEY")
    if (!XENDIT_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "XENDIT_SECRET_KEY not set" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Cari tabel & field berdasarkan prefix booking_code
    const prefix = Object.keys(TABLE_MAP).find(p => booking_code.toUpperCase().startsWith(p))
    const table = prefix ? TABLE_MAP[prefix] : null
    const field = table ? CODE_FIELD[table] : null

    if (!table || !field) {
      return new Response(JSON.stringify({ error: "Unknown booking code prefix", booking_code }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Ambil booking + payment_ref dari DB
    const { data: booking, error: fetchErr } = await supabase
      .from(table)
      .select("status, payment_ref")
      .eq(field, booking_code)
      .maybeSingle()

    if (fetchErr || !booking) {
      return new Response(JSON.stringify({ error: "Booking not found", booking_code }), {
        status: 404, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Sudah confirmed → return langsung, tidak perlu poll
    if (booking.status === "confirmed") {
      return new Response(JSON.stringify({ status: "confirmed", booking_code }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Tidak ada payment_ref → belum ada invoice Xendit
    const invoiceId = booking.payment_ref
    if (!invoiceId) {
      return new Response(JSON.stringify({ status: booking.status, booking_code }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Poll Xendit Invoice status
    const auth = "Basic " + btoa(`${XENDIT_SECRET_KEY}:`)
    const xenditRes = await fetch(`https://api.xendit.co/v2/invoices/${encodeURIComponent(invoiceId)}`, {
      headers: { Authorization: auth },
    })

    if (!xenditRes.ok) {
      console.error("[xendit-check-payment] Xendit API error:", xenditRes.status)
      return new Response(JSON.stringify({ status: booking.status, booking_code }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    const invoice = await xenditRes.json()
    const xenditStatus = String(invoice?.status || "").toUpperCase()

    console.log(`[xendit-check-payment] ${booking_code} → invoice ${invoiceId} → ${xenditStatus}`)

    if (xenditStatus === "PAID" || xenditStatus === "SETTLED") {
      // Update booking ke confirmed
      const { error: updateErr } = await supabase
        .from(table)
        .update({
          status:         "confirmed",
          payment_method: "xendit",
          paid_at:        new Date().toISOString(),
          updated_at:     new Date().toISOString(),
        })
        .eq(field, booking_code)
        .eq("status", "pending_payment") // idempotent guard

      if (updateErr) {
        console.error("[xendit-check-payment] Update error:", updateErr)
        return new Response(JSON.stringify({ error: updateErr.message }), {
          status: 500, headers: { ...CORS, "Content-Type": "application/json" },
        })
      }

      // Side-effects untuk PKG: generate voucher kalau belum ada
      if (table === "arena_package_orders") {
        try {
          const { data: orderData } = await supabase
            .from("arena_package_orders")
            .select("id, sessions")
            .eq("order_code", booking_code)
            .single()

          if (orderData) {
            const { data: existing } = await supabase
              .from("arena_package_vouchers")
              .select("id")
              .eq("order_id", orderData.id)
              .limit(1)

            if (!existing || existing.length === 0) {
              const { data: voucherCode } = await supabase.rpc("generate_package_voucher_code")
              if (voucherCode) {
                await supabase.from("arena_package_vouchers").insert({
                  voucher_code:   voucherCode,
                  order_id:       orderData.id,
                  total_sessions: orderData.sessions ?? 5,
                  used_sessions:  0,
                  is_active:      true,
                })
              }
            }
          }
        } catch (e) { console.error("Voucher generation error (non-blocking):", e) }
      }

      // Side-effects untuk MBR: provision membership kalau belum ada
      if (table === "gym_membership_orders") {
        try {
          const { data: order } = await supabase
            .from("gym_membership_orders")
            .select("id, email, full_name, plan_name, duration_months")
            .eq("order_code", booking_code)
            .single()

          if (order) {
            const wib = new Date(Date.now() + 7 * 60 * 60 * 1000)
            const startDate = wib.toISOString().slice(0, 10)
            const endMs = new Date(Date.UTC(
              wib.getUTCFullYear(),
              wib.getUTCMonth() + (order.duration_months ?? 1),
              wib.getUTCDate()
            ))
            const endDate = endMs.toISOString().slice(0, 10)

            const { data: existing } = await supabase
              .from("gym_memberships")
              .select("id")
              .eq("order_id", order.id)
              .limit(1)

            if (!existing || existing.length === 0) {
              await supabase.from("gym_memberships").insert({
                order_id:   order.id,
                email:      order.email,
                full_name:  order.full_name,
                plan_name:  order.plan_name,
                start_date: startDate,
                end_date:   endDate,
                is_active:  true,
              })
            }
          }
        } catch (e) { console.error("Membership provision error (non-blocking):", e) }
      }

      return new Response(JSON.stringify({ status: "confirmed", booking_code }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    if (xenditStatus === "EXPIRED") {
      await supabase
        .from(table)
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq(field, booking_code)
        .eq("status", "pending_payment")

      return new Response(JSON.stringify({ status: "cancelled", booking_code }), {
        headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Status lain (PENDING, etc) → masih nunggu bayar
    return new Response(JSON.stringify({ status: "pending_payment", booking_code }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })

  } catch (err) {
    console.error("[xendit-check-payment] Unhandled:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }
})
