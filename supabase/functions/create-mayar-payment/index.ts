// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "create-mayar-payment" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=true).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy create-mayar-payment,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

// supabase/functions/create-mayar-payment/index.ts
// v2 — tambah referenceId: booking_code supaya webhook bisa extract booking code
import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const MAYAR_API_KEY = Deno.env.get("MAYAR_API_KEY")
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const { booking_code, name, email, phone, amount, description, redirect_url } = await req.json()

    const res = await fetch("https://api.mayar.id/hl/v1/payment/create", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MAYAR_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        email,
        mobile: phone,
        amount,
        description: description || `Booking 20FIT Arena - ${booking_code}`,
        redirectUrl: redirect_url,
        referenceId: booking_code, // KEY FIX: Mayar echo back field ini di webhook payload
      }),
    })

    const data = await res.json()

    if (!res.ok || !data?.data?.link) {
      return new Response(JSON.stringify({ error: data?.messages || "Gagal membuat payment" }), {
        status: 400, headers: { ...CORS, "Content-Type": "application/json" },
      })
    }

    return new Response(JSON.stringify({ payment_url: data.data.link, payment_id: data.data.id }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    })
  }
})