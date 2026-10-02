import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDateTime } from '../../lib/format'

// Add-on refund queue — add-on line items flagged oversold by the xendit-webhook (F2): the
// customer paid, but the add-on's global stock had run out by the time payment confirmed, so
// commit_addon_stock could not decrement and marked the line oversold. The booking (class/arena)
// stays confirmed; only the add-on needs a manual refund or restock. Read-only list across both
// line-item tables with booking context. Empty until an oversell actually happens.

interface Line {
  id: string; booking_id: string; addon_name: string; addon_price: number; qty: number
  subtotal: number; stock_committed_at: string | null
  source: 'class' | 'arena'
  order_code?: string; full_name?: string; email?: string | null; phone?: string | null
}

export default function ArenaAddonRefunds() {
  const [rows, setRows] = useState<Line[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const sel = 'id, booking_id, addon_name, addon_price, qty, subtotal, stock_committed_at'
    const [{ data: cls, error: e1 }, { data: arn, error: e2 }] = await Promise.all([
      supabase.from('arena_class_booking_addons').select(sel).eq('oversold', true).order('stock_committed_at', { ascending: false }),
      supabase.from('arena_booking_addons').select(sel).eq('oversold', true).order('stock_committed_at', { ascending: false }),
    ])
    if (e1 || e2) { setError((e1 || e2)!.message); setLoading(false); return }

    const clsRows = ((cls ?? []) as Line[]).map(r => ({ ...r, source: 'class' as const }))
    const arnRows = ((arn ?? []) as Line[]).map(r => ({ ...r, source: 'arena' as const }))

    // Booking context per table (two-step; no FK-embed assumption).
    const clsIds = [...new Set(clsRows.map(r => r.booking_id))]
    const arnIds = [...new Set(arnRows.map(r => r.booking_id))]
    const bk: Record<string, { order_code?: string; full_name?: string; email?: string | null; phone?: string | null }> = {}
    if (clsIds.length) {
      const { data } = await supabase.from('arena_class_bookings').select('id, booking_code, full_name, email, phone').in('id', clsIds)
      for (const b of (data ?? []) as Record<string, unknown>[]) bk[b.id as string] = { order_code: b.booking_code as string, full_name: b.full_name as string, email: b.email as string, phone: b.phone as string }
    }
    if (arnIds.length) {
      const { data } = await supabase.from('arena_bookings').select('id, booking_code, full_name, email, phone').in('id', arnIds)
      for (const b of (data ?? []) as Record<string, unknown>[]) bk[b.id as string] = { order_code: b.booking_code as string, full_name: b.full_name as string, email: b.email as string, phone: b.phone as string }
    }

    const merged = [...clsRows, ...arnRows]
      .map(r => ({ ...r, ...bk[r.booking_id] }))
      .sort((a, b) => (b.stock_committed_at ?? '').localeCompare(a.stock_committed_at ?? ''))
    setRows(merged); setError(''); setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Add-on Refunds (Oversold)</h2>
        <button className="btn-secondary" onClick={fetchData}>Refresh</button>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Add-on dibayar tapi stok habis saat konfirmasi — booking tetap confirmed, add-on perlu refund/restock manual.
      </p>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Order Code</th><th>Nama</th><th>Kontak</th><th>Add-on</th><th>Qty</th><th>Subtotal</th><th>Sumber</th><th>Waktu</th></tr></thead>
          <tbody>
            {loading ? <tr className="loading-row"><td colSpan={8}>Memuat...</td></tr>
              : rows.length === 0 ? <tr><td colSpan={8} className="empty-state">Tidak ada add-on oversold</td></tr>
              : rows.map(r => (
                <tr key={`${r.source}-${r.id}`}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{r.order_code || '-'}</td>
                  <td>{r.full_name || '-'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.email || r.phone || '-'}</td>
                  <td>{r.addon_name}</td>
                  <td style={{ textAlign: 'center' }}>{r.qty}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(r.subtotal)}</td>
                  <td style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--text-muted)' }}>{r.source === 'class' ? 'Class' : 'Arena'}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>{r.stock_committed_at ? fmtDateTime(r.stock_committed_at) : '-'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
