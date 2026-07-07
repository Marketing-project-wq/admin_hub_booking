// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "arena-api" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy arena-api,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
//
// Open API untuk sistem eksternal (member system) baca data transaksi member.
// Auth pakai header `x-api-key` — divalidasi terhadap tabel arena_api_keys (SHA-256 hash).
// ───────────────────────────────────────────────────────────────────────────

// supabase/functions/arena-api/index.ts
// v1 — read-only endpoints: /member/bookings, /member/packages, /member/venue
import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-api-key",
}

async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(text)
  const hashBuffer = await crypto.subtle.digest("SHA-256", data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
}

function normalizePhone(phone: string): string[] {
  const digits = phone.replace(/\D/g, "")
  const variants: string[] = []
  if (digits.startsWith("62"))  variants.push(digits, "0" + digits.substring(2), "+" + digits)
  if (digits.startsWith("0"))   variants.push(digits, "62" + digits.substring(1), "+62" + digits.substring(1))
  if (digits.startsWith("8"))   variants.push(digits, "0" + digits, "62" + digits, "+62" + digits)
  return [...new Set(variants)]
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...CORS, "Content-Type": "application/json" }
    })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  // ── Validasi API Key ──────────────────────────────────────────────────────
  const apiKey = req.headers.get("x-api-key")
  if (!apiKey) {
    return new Response(JSON.stringify({ error: "Missing x-api-key header" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" }
    })
  }

  const keyHash = await sha256(apiKey)
  const { data: keyRecord } = await supabase
    .from("arena_api_keys")
    .select("id, name, is_active")
    .eq("key_hash", keyHash)
    .single()

  if (!keyRecord || !keyRecord.is_active) {
    return new Response(JSON.stringify({ error: "Invalid or inactive API key" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" }
    })
  }

  // Update last_used
  await supabase
    .from("arena_api_keys")
    .update({ last_used: new Date().toISOString() })
    .eq("id", keyRecord.id)

  // ── Routing ───────────────────────────────────────────────────────────────
  const url      = new URL(req.url)
  const path     = url.pathname.replace(/^\/arena-api/, "").replace(/^\/functions\/v1\/arena-api/, "")
  const phone    = url.searchParams.get("phone")
  const page     = parseInt(url.searchParams.get("page") || "1")
  const limit    = Math.min(parseInt(url.searchParams.get("limit") || "20"), 100)
  const offset   = (page - 1) * limit

  if (!phone) {
    return new Response(JSON.stringify({ error: "Missing phone parameter" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" }
    })
  }

  const phoneVariants = normalizePhone(phone)

  // ── GET /member/bookings ──────────────────────────────────────────────────
  if (path === "/member/bookings") {
    const { data, error, count } = await supabase
      .from("arena_class_bookings")
      .select(`
        booking_code, full_name, email, phone, status,
        payment_method, price, discount, paid_at, created_at,
        arena_class_schedules (
          schedule_date, start_time, end_time, instructor,
          arena_class_types (name, color)
        )
      `, { count: "exact" })
      .in("phone", phoneVariants)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      })
    }

    return new Response(JSON.stringify({
      ok: true,
      data,
      meta: { total: count, page, limit, phone }
    }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    })
  }

  // ── GET /member/packages ──────────────────────────────────────────────────
  if (path === "/member/packages") {
    const { data: orders, error } = await supabase
      .from("arena_package_orders")
      .select(`
        order_code, package_name, sessions, price,
        status, payment_method, paid_at, created_at,
        arena_package_vouchers (
          voucher_code, total_sessions, used_sessions, is_active
        )
      `)
      .in("phone", phoneVariants)
      .order("created_at", { ascending: false })

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      })
    }

    return new Response(JSON.stringify({
      ok: true,
      data: orders,
      meta: { total: orders?.length || 0, phone }
    }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    })
  }

  // ── GET /member/venue ─────────────────────────────────────────────────────
  if (path === "/member/venue") {
    const { data, error, count } = await supabase
      .from("arena_bookings")
      .select(`
        booking_code, full_name, email, phone, customer_type,
        booking_date, start_time, end_time,
        status, payment_method, price, discount, paid_at, created_at
      `, { count: "exact" })
      .in("phone", phoneVariants)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" }
      })
    }

    return new Response(JSON.stringify({
      ok: true,
      data,
      meta: { total: count, page, limit, phone }
    }), {
      status: 200, headers: { ...CORS, "Content-Type": "application/json" }
    })
  }

  // ── 404 ───────────────────────────────────────────────────────────────────
  return new Response(JSON.stringify({
    error: "Endpoint not found",
    available_endpoints: [
      "GET /member/bookings?phone=628xxx",
      "GET /member/packages?phone=628xxx",
      "GET /member/venue?phone=628xxx",
    ]
  }), {
    status: 404, headers: { ...CORS, "Content-Type": "application/json" }
  })
})
