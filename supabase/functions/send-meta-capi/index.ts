// ────────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "send-meta-capi" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy send-meta-capi,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ────────────────────────────────────────────────────────────────────────────

// supabase/functions/send-meta-capi/index.ts
// Kirim event ke Meta Conversions API (server-side)
import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
}

interface CAPIEventData {
  event_name: string       // 'Purchase' | 'InitiateCheckout' | 'Lead' | 'ViewContent'
  event_time?: number      // Unix timestamp, default: now
  email?: string           // customer email (akan di-hash)
  phone?: string           // customer phone (akan di-hash)
  value?: number           // nilai transaksi dalam IDR
  currency?: string        // default: 'IDR'
  content_name?: string    // nama kelas
  booking_code?: string    // untuk dedup
  client_ip?: string
  client_user_agent?: string
  fbc?: string             // Facebook click ID
  fbp?: string             // Facebook browser ID
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text.toLowerCase().trim())
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const body = await req.json() as CAPIEventData

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    )

    // Fetch config dari DB
    const { data: configs } = await supabase
      .from("arena_tracking_config")
      .select("key, value, is_active")
      .in("key", ["meta_pixel_id", "meta_capi_access_token", "meta_capi_test_event_code"])

    const config: Record<string, string | null> = {}
    for (const row of configs || []) {
      config[row.key] = row.is_active ? row.value : null
    }

    const pixelId = config["meta_pixel_id"]
    const accessToken = config["meta_capi_access_token"]
    const testEventCode = config["meta_capi_test_event_code"]

    if (!pixelId || !accessToken) {
      console.log("⏭️ Meta CAPI not configured or disabled")
      return new Response(JSON.stringify({ ok: false, reason: "not_configured" }), {
        status: 200, headers: { ...CORS, "Content-Type": "application/json" }
      })
    }

    // Build user_data dengan hashing
    const userData: Record<string, string> = {}
    if (body.email) userData["em"] = await sha256(body.email)
    if (body.phone) {
      // Normalize phone: hapus + dan spasi, tambah 62 kalau belum ada
      let phone = body.phone.replace(/\D/g, '')
      if (phone.startsWith('0')) phone = '62' + phone.substring(1)
      if (!phone.startsWith('62')) phone = '62' + phone
      userData["ph"] = await sha256(phone)
    }
    if (body.client_ip) userData["client_ip_address"] = body.client_ip
    if (body.client_user_agent) userData["client_user_agent"] = body.client_user_agent
    if (body.fbc) userData["fbc"] = body.fbc
    if (body.fbp) userData["fbp"] = body.fbp

    // Build custom_data
    const customData: Record<string, unknown> = {
      currency: body.currency || "IDR",
    }
    if (body.value !== undefined) customData["value"] = body.value
    if (body.content_name) {
      customData["content_name"] = body.content_name
      customData["content_type"] = "product"
    }
    if (body.booking_code) customData["order_id"] = body.booking_code

    // Build payload
    const payload: Record<string, unknown> = {
      data: [
        {
          event_name: body.event_name,
          event_time: body.event_time || Math.floor(Date.now() / 1000),
          action_source: "website",
          event_source_url: "https://booking.20fit.id",
          event_id: body.booking_code || crypto.randomUUID(),
          user_data: userData,
          custom_data: customData,
        }
      ]
    }

    // Tambah test_event_code kalau ada
    if (testEventCode) {
      payload["test_event_code"] = testEventCode
    }

    console.log("📤 Sending CAPI event:", body.event_name, "for:", body.booking_code)

    const res = await fetch(
      `https://graph.facebook.com/v18.0/${pixelId}/events?access_token=${accessToken}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    )

    const result = await res.json()
    console.log("📥 Meta CAPI response:", JSON.stringify(result))

    return new Response(JSON.stringify({
      ok: res.ok,
      event_name: body.event_name,
      meta_response: result,
    }), {
      status: 200,
      headers: { ...CORS, "Content-Type": "application/json" }
    })

  } catch (err) {
    console.error("💥 CAPI error:", err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    })
  }
})