// ───────────────────────────────────────────────────────────────────────────
// ⚠️  MIRROR dari Supabase Edge Function "create-midtrans-transaction" (project cpvzwqptzcxnwzfzgrmt, verify_jwt=true).
// Snapshot untuk git. Repo ini TIDAK auto-deploy edge functions — kalau ada
// perubahan, WAJIB deploy ulang manual ke Supabase (supabase functions deploy create-midtrans-transaction,
// atau Supabase MCP deploy_edge_function). Jangan edit lalu lupa deploy.
// ───────────────────────────────────────────────────────────────────────────

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const MIDTRANS_SERVER_KEY = Deno.env.get('MIDTRANS_SERVER_KEY') ?? 'REDACTED_SECRET' // ⚠️ secret di-redact dari mirror git — di fungsi live nilainya hardcoded; sebaiknya set via Supabase secret / Deno.env
const MIDTRANS_API_URL = 'https://app.sandbox.midtrans.com/snap/v1/transactions'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const body = await req.json()
    const { booking_code, amount, customer_name, customer_email, customer_phone, item_details } = body

    const payload = {
      transaction_details: {
        order_id: booking_code,
        gross_amount: amount,
      },
      customer_details: {
        first_name: customer_name,
        email: customer_email,
        phone: customer_phone,
      },
      item_details: item_details,
      enabled_payments: ['credit_card','bca_va','bni_va','bri_va','mandiri_va','qris','gopay'],
    }

    const response = await fetch(MIDTRANS_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(MIDTRANS_SERVER_KEY + ':'),
      },
      body: JSON.stringify(payload),
    })

    const data = await response.json()

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})