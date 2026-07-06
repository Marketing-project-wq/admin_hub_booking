// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "mayar-webhook-package" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy mayar-webhook-package,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const MAILTRAP_API_KEY = Deno.env.get("MAILTRAP_API_KEY")!

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", {
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" }
    })

  try {
    const body = await req.json()
    if (body?.event !== "payment.received")
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 })

    const description: string = body?.data?.description ?? ""
    const match = description.match(/(PKG-\d{8}-\d{4})/)
    const orderCode = match?.[1]

    if (!orderCode)
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 })

    const { data: order } = await supabase
      .from("arena_package_orders")
      .update({
        status:         "confirmed",
        payment_method: "mayar",
        payment_ref:    body?.data?.id ?? null,
        paid_at:        new Date().toISOString(),
        updated_at:     new Date().toISOString(),
      })
      .eq("order_code", orderCode)
      .eq("status", "pending_payment")
      .select("id, order_code, full_name, email, package_name, sessions, price")
      .single()

    if (!order) {
      console.error("Order not found:", orderCode)
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 })
    }

    const { data: voucherCode } = await supabase
      .rpc("generate_package_voucher_code")

    await supabase
      .from("arena_package_vouchers")
      .insert({
        voucher_code:   voucherCode,
        order_id:       order.id,
        total_sessions: order.sessions,
        used_sessions:  0,
        is_active:      true,
      })

    console.log("Voucher created:", voucherCode, "for order:", orderCode)

    const emailHtml = buildVoucherEmail({
      full_name:    order.full_name,
      order_code:   order.order_code,
      package_name: order.package_name,
      sessions:     order.sessions,
      price:        order.price,
      voucher_code: voucherCode,
    })

    await fetch("https://send.api.mailtrap.io/api/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MAILTRAP_API_KEY}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify({
        from:    { email: "booking@20fit.id", name: "20FIT Arena" },
        to:      [{ email: order.email, name: order.full_name }],
        subject: `Your Package Voucher — ${voucherCode} | 20FIT Arena`,
        html:    emailHtml,
      }),
    })

    return new Response(JSON.stringify({ status: "ok" }), { status: 200 })

  } catch (err) {
    console.error("Error:", err)
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 })
  }
})

function buildVoucherEmail(data: {
  full_name: string
  order_code: string
  package_name: string
  sessions: number
  price: number
  voucher_code: string
}) {
  const formatRupiah = (n: number) =>
    new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n)

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

        <tr><td style="background:#080808;padding:28px 36px;text-align:center;">
          <img src="https://cpvzwqptzcxnwzfzgrmt.supabase.co/storage/v1/object/public/assets/Logo%2020FIT%20Arena%20white.png" alt="20FIT Arena" width="140" style="display:block;margin:0 auto;"/>
        </td></tr>

        <tr><td style="background:#C0392B;padding:20px 36px;text-align:center;">
          <div style="font-size:13px;color:#ffffff;letter-spacing:1px;">PACKAGE CONFIRMED</div>
          <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">Your Voucher is Ready ✓</div>
        </td></tr>

        <tr><td style="padding:28px 36px 0;">
          <p style="margin:0;font-size:15px;color:#333333;">Hi <strong>${data.full_name}</strong>,</p>
          <p style="margin:12px 0 0;font-size:14px;color:#555555;line-height:1.6;">
            Your package purchase is confirmed. Here's your unique voucher code to redeem your sessions at 20FIT Arena.
          </p>
        </td></tr>

        <tr><td style="padding:24px 36px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;border-radius:12px;overflow:hidden;">
            <tr><td style="padding:24px;text-align:center;">
              <div style="font-size:11px;color:#aaaaaa;letter-spacing:2px;text-transform:uppercase;margin-bottom:10px;">Your Voucher Code</div>
              <div style="font-size:28px;font-weight:900;color:#ffffff;letter-spacing:6px;font-family:'Courier New',monospace;">${data.voucher_code}</div>
              <div style="margin-top:10px;font-size:12px;color:#888888;">${data.sessions} sessions · Use when booking a class</div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 36px 24px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:10px;border:1px solid #eeeeee;">
            <tr><td style="background:#080808;padding:10px 18px;">
              <div style="font-size:11px;color:#aaaaaa;letter-spacing:1px;">ORDER DETAILS</div>
              <div style="font-size:13px;color:#ffffff;font-weight:700;margin-top:2px;">${data.order_code}</div>
            </td></tr>
            <tr><td style="padding:16px 18px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr><td style="padding:6px 0;border-bottom:1px solid #eeeeee;">
                  <span style="font-size:11px;color:#999999;text-transform:uppercase;">Package</span>
                  <div style="font-size:13px;color:#333333;font-weight:600;margin-top:2px;">${data.package_name}</div>
                </td></tr>
                <tr><td style="padding:6px 0;border-bottom:1px solid #eeeeee;">
                  <span style="font-size:11px;color:#999999;text-transform:uppercase;">Sessions</span>
                  <div style="font-size:13px;color:#333333;font-weight:600;margin-top:2px;">${data.sessions} sessions</div>
                </td></tr>
                <tr><td style="padding:6px 0;">
                  <span style="font-size:11px;color:#999999;text-transform:uppercase;">Total Paid</span>
                  <div style="font-size:15px;color:#C0392B;font-weight:700;margin-top:2px;">${formatRupiah(data.price)}</div>
                </td></tr>
              </table>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:0 36px 28px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF5F5;border-radius:10px;padding:16px 18px;border:1px solid #FCA5A5;">
            <tr><td>
              <div style="font-size:11px;color:#C0392B;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">How to Use</div>
              <div style="font-size:12px;color:#555555;line-height:1.7;">
                1. 1. Go to <a href="https://booking.20fit.id" style="color:#C0392B;text-decoration:none;font-weight:600;">booking.20fit.id</a> and click <strong>Book Arena</strong><br>
                2. Select <strong>Booking Class</strong> and choose your schedule<br>
                3. At checkout, enter code <strong style="color:#C0392B;">${data.voucher_code}</strong> in the voucher field<br>
                4. Each use deducts 1 session from your ${data.sessions}-session package
              </div>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="background:#f9f9f9;padding:20px 36px;text-align:center;border-top:1px solid #eeeeee;">
          <p style="margin:0;font-size:12px;color:#999999;">
            Questions? WhatsApp us at
            <a href="https://wa.me/628211518204" style="color:#C0392B;text-decoration:none;">+62 821-1518-204</a>
          </p>
          <p style="margin:8px 0 0;font-size:11px;color:#bbbbbb;">
            © 2026 20FIT Arena · Jl. Sinabung No.9, Kebayoran Baru, Jakarta Selatan
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}