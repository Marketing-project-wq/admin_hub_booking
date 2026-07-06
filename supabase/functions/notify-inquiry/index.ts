// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "notify-inquiry" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=true).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy notify-inquiry,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

serve(async (req) => {
  try {
    const payload = await req.json()
    const record = payload.record

    const emailBody = `
New inquiry masuk di Race Lab! 🏁

Nama: ${record.name}
Email: ${record.email}
Organisasi / Event: ${record.org}
Kota / Negara: ${record.location}
Format Event: ${record.format}
Jumlah Peserta: ${record.size}
Tanggal Event: ${record.date}
WhatsApp: ${record.phone}
Pesan: ${record.message}

---
Dikirim otomatis dari racelab.20fit.id
    `

    const res = await fetch('https://send.api.mailtrap.io/api/send', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer 5e75762b00a5c3ff72e1f806bc396a32',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: { email: 'noreply@20fit.id', name: '20FIT Race Lab' },
        to: [{ email: 'marketing@20fit.id' }],
        subject: `🏁 New Race Lab Inquiry — ${record.name}`,
        text: emailBody
      })
    })

    if (!res.ok) {
      const err = await res.text()
      return new Response(err, { status: 500 })
    }

    return new Response('ok', { status: 200 })
  } catch (e) {
    return new Response(String(e), { status: 500 })
  }
})