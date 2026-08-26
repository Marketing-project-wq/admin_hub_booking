// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "create-xendit-payment" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=true).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy create-xendit-payment,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────
//
// create-xendit-payment — pembuat pembayaran Xendit untuk SEMUA tipe booking 20FIT.
// Drop-in pengganti create-mayar-payment: menerima input yang SAMA
//   { booking_code, name, email, phone, amount, description, redirect_url }
// dan mengembalikan bentuk yang SAMA { payment_url, payment_id } sehingga frontend
// cukup mengganti URL fungsi (lihat VITE_PAYMENT_GATEWAY di frontend).
//
// Memakai Xendit Invoice API (hosted checkout, redirect) — konsisten dgn ticket.20fit.id
// (`createInvoice`). `external_id = booking_code` di-echo balik oleh webhook Xendit
// sehingga xendit-webhook bisa me-routing ke tabel yang benar per prefix.
//
// Env yang WAJIB di-set di Supabase (Edge Function secrets):
//   XENDIT_SECRET_KEY  — mis. xnd_development_... / xnd_production_...

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

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
