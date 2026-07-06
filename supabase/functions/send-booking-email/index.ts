// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "send-booking-email" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=false).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy send-booking-email,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
)

const MAILTRAP_API_KEY = Deno.env.get("MAILTRAP_API_KEY")!
const FROM_EMAIL      = "booking@20fit.id"
const FROM_NAME       = "20FIT Arena"
const MAPS_URL        = "https://maps.app.goo.gl/eyXKfjMzDoyw6oAM6"
const LOCATION        = "20FIT Arena, Menteng Prada Basement, Jl. Pegangsaan Timur No.15A, Menteng, Jakarta Pusat 10320"
const EBOOK_ADDON_ID  = "028fde59-023d-4e1f-948d-752572c1ca49"
const EBOOK_URL       = "https://canva.link/0zld8v9kijkcoz3"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

const formatRupiah = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(n)

const formatDate = (d: string) =>
  new Date(d).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })

const formatTime = (t: string) => t?.slice(0, 5) ?? "-"

const buildEmailHtml = (data: {
  full_name: string
  booking_code: string
  booking_type: string
  date: string
  start_time: string
  end_time: string
  instructor: string | null
  price: number
}, hasEbook: boolean) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- HEADER -->
          <tr>
            <td style="background:#080808;padding:28px 36px;text-align:center;">
              <img
                src="https://cpvzwqptzcxnwzfzgrmt.supabase.co/storage/v1/object/public/assets/Logo%2020FIT%20Arena%20white.png"
                alt="20FIT Arena"
                width="140"
                style="display:block;margin:0 auto;"
              />
            </td>
          </tr>

          <!-- HERO -->
          <tr>
            <td style="background:#C0392B;padding:20px 36px;text-align:center;">
              <div style="font-size:13px;color:#ffffff;letter-spacing:1px;">BOOKING CONFIRMED</div>
              <div style="font-size:22px;font-weight:700;color:#ffffff;margin-top:4px;">Payment Successful ✓</div>
            </td>
          </tr>

          <!-- GREETING -->
          <tr>
            <td style="padding:28px 36px 0;">
              <p style="margin:0;font-size:15px;color:#333333;">
                Hi <strong>${data.full_name}</strong>,
              </p>
              <p style="margin:12px 0 0;font-size:14px;color:#555555;line-height:1.6;">
                Your payment has been received and your booking is confirmed.
                See you at the ARENA! 💪
              </p>
            </td>
          </tr>

          <!-- BOOKING DETAIL -->
          <tr>
            <td style="padding:24px 36px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:10px;overflow:hidden;border:1px solid #eeeeee;">
                <tr>
                  <td style="background:#080808;padding:12px 20px;">
                    <div style="font-size:11px;color:#aaaaaa;letter-spacing:1px;">BOOKING DETAILS</div>
                    <div style="font-size:14px;color:#ffffff;font-weight:700;margin-top:2px;">${data.booking_code}</div>
                  </td>
                </tr>
                <tr>
                  <td style="padding:20px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:7px 0;border-bottom:1px solid #eeeeee;">
                          <span style="font-size:12px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Type</span>
                          <div style="font-size:14px;color:#333333;font-weight:600;margin-top:2px;">${data.booking_type}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;border-bottom:1px solid #eeeeee;">
                          <span style="font-size:12px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Date</span>
                          <div style="font-size:14px;color:#333333;font-weight:600;margin-top:2px;">${formatDate(data.date)}</div>
                        </td>
                      </tr>
                      <tr>
                        <td style="padding:7px 0;border-bottom:1px solid #eeeeee;">
                          <span style="font-size:12px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Time</span>
                          <div style="font-size:14px;color:#333333;font-weight:600;margin-top:2px;">${formatTime(data.start_time)} – ${formatTime(data.end_time)} WIB</div>
                        </td>
                      </tr>
                      ${data.instructor ? `
                      <tr>
                        <td style="padding:7px 0;border-bottom:1px solid #eeeeee;">
                          <span style="font-size:12px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Coach</span>
                          <div style="font-size:14px;color:#333333;font-weight:600;margin-top:2px;">${data.instructor}</div>
                        </td>
                      </tr>
                      ` : ""}
                      <tr>
                        <td style="padding:7px 0;">
                          <span style="font-size:12px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Total</span>
                          <div style="font-size:16px;color:#C0392B;font-weight:700;margin-top:2px;">${formatRupiah(data.price)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- EBOOK (only if purchased) -->
          ${hasEbook ? `
          <tr>
            <td style="padding:0 36px 24px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;border-radius:10px;overflow:hidden;">
                <tr>
                  <td style="padding:18px 20px;">
                    <div style="font-size:10px;color:#C0392B;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;font-family:Arial,sans-serif;">
                      YOUR ADD-ON
                    </div>
                    <div style="font-size:15px;font-weight:700;color:#ffffff;margin-bottom:4px;font-family:Arial,sans-serif;">
                      E-Book HYROX Learning Hub by 20FIT
                    </div>
                    <div style="font-size:12px;color:#888888;margin-bottom:14px;font-family:Arial,sans-serif;">
                      Your complete guide to mastering HYROX — technique, training plans, and race strategy.
                    </div>
                    <a href="${EBOOK_URL}"
                      style="display:inline-block;padding:10px 20px;background:#C0392B;color:#ffffff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:700;font-family:Arial,sans-serif;letter-spacing:0.5px;">
                      Download E-Book →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          ` : ""}

          <!-- LOCATION -->
          <tr>
            <td style="padding:0 36px 28px;">
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;border-radius:10px;padding:16px 20px;">
                <tr>
                  <td>
                    <div style="font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">📍 Location</div>
                    <div style="font-size:13px;color:#333333;line-height:1.5;">${LOCATION}</div>
                    <a href="${MAPS_URL}"
                       style="display:inline-block;margin-top:10px;padding:7px 16px;background:#C0392B;color:#ffffff;text-decoration:none;border-radius:6px;font-size:12px;font-weight:600;">
                      Open in Google Maps →
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 36px;text-align:center;border-top:1px solid #eeeeee;">
              <p style="margin:0;font-size:12px;color:#999999;">
                Questions? WhatsApp us at
                <a href="https://wa.me/628211518204" style="color:#C0392B;text-decoration:none;">+62 821-1518-204</a>
              </p>
              <p style="margin:8px 0 0;font-size:11px;color:#bbbbbb;">
                © 2026 20FIT Arena · Jl. Sinabung No.9, Kebayoran Baru, Jakarta Selatan
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  try {
    const body = await req.json()
    const event = body?.event

    if (event !== "payment.received") {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 })
    }

    const description: string = body?.data?.description ?? ""
    const match = description.match(/([BC][KL]-\d{8}-\d{4})/)
    const bookingCode = match?.[1]

    if (!bookingCode) {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 })
    }

    let emailData: {
      full_name: string
      email: string
      booking_code: string
      booking_type: string
      date: string
      start_time: string
      end_time: string
      instructor: string | null
      price: number
    } | null = null

    let bookingUUID: string | null = null

    if (bookingCode.startsWith("BK-")) {
      const { data } = await supabase
        .from("arena_bookings")
        .select("id, full_name, email, booking_code, booking_date, start_time, end_time, price")
        .eq("booking_code", bookingCode)
        .single()

      if (data) {
        bookingUUID = data.id
        emailData = {
          full_name:    data.full_name,
          email:        data.email,
          booking_code: data.booking_code,
          booking_type: "Arena Exclusive",
          date:         data.booking_date,
          start_time:   data.start_time,
          end_time:     data.end_time,
          instructor:   null,
          price:        data.price,
        }
      }

    } else if (bookingCode.startsWith("CL-")) {
      const { data } = await supabase
        .from("arena_class_bookings")
        .select(`
          id, full_name, email, booking_code, price,
          arena_class_schedules!schedule_id (
            schedule_date, start_time, end_time, instructor,
            arena_class_types!class_type_id ( name )
          )
        `)
        .eq("booking_code", bookingCode)
        .single()

      if (data) {
        const sched = data.arena_class_schedules as any
        bookingUUID = data.id
        emailData = {
          full_name:    data.full_name,
          email:        data.email,
          booking_code: data.booking_code,
          booking_type: sched?.arena_class_types?.name ?? "HYROX Class",
          date:         sched?.schedule_date,
          start_time:   sched?.start_time,
          end_time:     sched?.end_time,
          instructor:   sched?.instructor ?? null,
          price:        data.price,
        }
      }
    }

    if (!emailData || !bookingUUID) {
      console.error("Booking not found:", bookingCode)
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 })
    }

    // Cek e-book add-on — gunakan tabel yang sesuai berdasarkan prefix
    const addonTable = bookingCode.startsWith("CL-")
      ? "arena_class_booking_addons"
      : "arena_booking_addons"

    const { data: addons, error: addonError } = await supabase
      .from(addonTable)
      .select("addon_id")
      .eq("booking_id", bookingUUID)

    console.log("Addon table:", addonTable)
    console.log("Addon query result:", { addons, addonError })

    const hasEbook = (addons || []).some(a => a.addon_id === EBOOK_ADDON_ID)
    console.log("Has ebook addon:", hasEbook)

    // Kirim email via Mailtrap
    const emailRes = await fetch("https://send.api.mailtrap.io/api/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MAILTRAP_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: { email: FROM_EMAIL, name: FROM_NAME },
        to: [{ email: emailData.email, name: emailData.full_name }],
        subject: `✅ Booking Confirmed – ${emailData.booking_code} | 20FIT Arena`,
        html: buildEmailHtml(emailData, hasEbook),
      }),
    })

    const emailResult = await emailRes.json()
    console.log("Email sent:", emailResult)

    return new Response(JSON.stringify({ status: "ok" }), { status: 200 })

  } catch (err) {
    console.error("Error:", err)
    return new Response(JSON.stringify({ status: "ok" }), { status: 200 })
  }
})