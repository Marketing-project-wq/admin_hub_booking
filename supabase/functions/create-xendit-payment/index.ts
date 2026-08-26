// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "create-xendit-payment" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=true).
// Snapshot untuk git. WAJIB deploy manual setelah edit:
//   supabase functions deploy create-xendit-payment --project-ref cpvzwqptzcxnwzfzgrmt
// ───────────────────────────────────────────────────────────────────────────
//
// Buat Xendit Invoice, lalu simpan invoice_id ke kolom payment_ref di booking table.
// Polling status dilakukan oleh xendit-check-payment — tidak perlu webhook.
//
// Env wajib: XENDIT_SECRET_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"

const XENDIT_SECRET_KEY = Deno.env.get("XENDIT_SECRET_KEY")

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Channel yang ditampilkan di halaman Xendit. Mandiri VA sengaja disertakan (dibutuhkan
// untuk program diskon kartu Mandiri fase berikutnya). Urutan = urutan tampil.
const PAYMENT_METHODS = [
  "QRIS",
  "MANDIRI", "BCA", "BNI", "BRI", "PERMATA", "BSI", "CIMB",
  "DANA", "SHOPEEPAY", "OVO", "LINKAJA",
  "CREDIT_CARD",
]

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const { booking_code, name, email, phone, amount, description, redirect_url } = await req.json()

    if (!booking_code || !amount) {
      return new Response(JSON.stringify({ error: "booking_code & amount wajib" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    if (!XENDIT_SECRET_KEY) {
      return new Response(JSON.stringify({ error: "Server misconfig: XENDIT_SECRET_KEY not set" }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Xendit Basic auth: base64(secret_key + ":")  (password kosong)
    const authHeader = "Basic " + btoa(`${XENDIT_SECRET_KEY}:`)

    const invoiceBody: Record<string, unknown> = {
      external_id: booking_code,               // KEY: di-echo di webhook → routing per prefix
      amount,                                   // rupiah (bukan sen)
      description: description || `Booking 20FIT - ${booking_code}`,
      payer_email: email || undefined,
      currency: "IDR",
      invoice_duration: 3600,                   // 1 jam
      success_redirect_url: redirect_url || undefined,
      failure_redirect_url: redirect_url || undefined,
      payment_methods: PAYMENT_METHODS,
      customer: {
        given_names: name || "Customer",
        email: email || undefined,
        mobile_number: phone || undefined,
      },
      metadata: { booking_code },               // cadangan kalau external_id tak terbawa
    }

    const res = await fetch("https://api.xendit.co/v2/invoices", {
      method: "POST",
      headers: {
        "Authorization": authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(invoiceBody),
    })

    const data = await res.json()

    // Xendit invoice sukses → { id, invoice_url, ... }
    const payment_url = data?.invoice_url
    const payment_id = data?.id

    if (!res.ok || !payment_url) {
      console.error("[create-xendit-payment] Xendit error:", res.status, JSON.stringify(data))
      return new Response(JSON.stringify({ error: data?.message || data?.error_code || "Gagal membuat payment Xendit", xendit: data }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    // Simpan invoice_id ke payment_ref di booking table supaya xendit-check-payment bisa poll status
    if (payment_id) {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      )

      const TABLE_MAP: Record<string, string> = {
        "BK-": "arena_bookings",
        "CL-": "arena_class_bookings",
        "GM-": "gym_class_bookings",
        "PKG-": "arena_package_orders",
        "CLC-": "clinic_bookings",
        "MBR-": "gym_membership_orders",
      }
      const CODE_FIELD: Record<string, string> = {
        arena_bookings: "booking_code",
        arena_class_bookings: "booking_code",
        gym_class_bookings: "booking_code",
        arena_package_orders: "order_code",
        clinic_bookings: "booking_code",
        gym_membership_orders: "order_code",
      }
      const prefix = Object.keys(TABLE_MAP).find(p => booking_code.startsWith(p))
      const table = prefix ? TABLE_MAP[prefix] : null
      const field = table ? CODE_FIELD[table] : null
      if (table && field) {
        await supabase.from(table).update({ payment_ref: payment_id }).eq(field, booking_code)
      }
    }

    return new Response(JSON.stringify({ payment_url, payment_id }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (err) {
    console.error("[create-xendit-payment] Unhandled:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }
})
