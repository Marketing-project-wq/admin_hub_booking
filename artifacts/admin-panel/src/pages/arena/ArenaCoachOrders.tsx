import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDateTime, STATUS_LABEL, exportToCSV } from '../../lib/format'

// Coach PACKAGE orders (coach_package_orders). The table is RLS service-role only,
// so this page reads via the `coach-admin-orders` edge function (service role) rather
// than the browser supabase client. Mirrors the ArenaPackageOrders layout.
const PAGE_SIZE = 20

interface CoachOrderRow {
  id: string
  order_code: string
  coach_name: string | null
  tier: string
  sessions: number
  validity_months: number | null
  price: number
  customer_name: string
  customer_wa: string
  customer_email: string | null
  status: string
  payment_method: string | null
  paid_at: string | null
  created_at: string
}

const tierLabel = (t: string) => (t === 'head_coach' ? 'Head Coach' : t === 'coach' ? 'Coach' : t)

export default function ArenaCoachOrders() {
  const [data, setData] = useState<CoachOrderRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selected, setSelected] = useState<CoachOrderRow | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    const { data: res, error: err } = await supabase.functions.invoke<{ rows: CoachOrderRow[]; total: number }>(
      'coach-admin-orders', { body: { page: page + 1, pageSize: PAGE_SIZE, search } },
    )
    if (err) { setError(err.message || 'Gagal memuat data'); setData([]); setTotal(0); setLoading(false); return }
    setData(res?.rows ?? [])
    setTotal(res?.total ?? 0)
    setLoading(false)
  }, [page, search])

  useEffect(() => { fetchData() }, [fetchData])

  // Export pulls every page (100 at a time) from the same function, then builds a CSV.
  const handleExport = async () => {
    const all: CoachOrderRow[] = []
    for (let p = 1; ; p++) {
      const { data: res, error: err } = await supabase.functions.invoke<{ rows: CoachOrderRow[]; total: number }>(
        'coach-admin-orders', { body: { page: p, pageSize: 100, search } },
      )
      if (err) break
      const rows = res?.rows ?? []
      all.push(...rows)
      if (rows.length === 0 || all.length >= (res?.total ?? 0)) break
    }
    if (all.length) exportToCSV(all as unknown as Record<string, unknown>[], 'coach_package_orders')
  }

  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Coach Orders</h2>
        <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari order code, nama, WA..."
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 240 }}
        />
        {search && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setSearchInput(''); setPage(0) }}
          >
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order Code</th>
              <th>Coach</th>
              <th>Tier</th>
              <th>Sesi</th>
              <th>Nama</th>
              <th>WA</th>
              <th>Harga</th>
              <th>Status</th>
              <th>Dibuat</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={10}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={10} className="empty-state">Tidak ada data</td></tr>
            ) : data.map(row => {
              const s = STATUS_LABEL[row.status] || { label: row.status, css: '' }
              return (
                <tr key={row.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.order_code}</td>
                  <td>{row.coach_name || '-'}</td>
                  <td>{tierLabel(row.tier)}</td>
                  <td style={{ textAlign: 'center' }}>{row.sessions}</td>
                  <td>{row.customer_name}</td>
                  <td>{row.customer_wa}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(row.price)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDateTime(row.created_at)}</td>
                  <td><button className="action-btn detail" onClick={() => setSelected(row)}>Detail</button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="pagination">
          <span>{total > 0 ? `${from}–${to} dari ${total} hasil` : '0 hasil'}</span>
          <div className="pagination-btns">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}><ArrowLeft size={13} style={{ verticalAlign: -2 }} /> Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Detail Coach Order</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            <div className="detail-row"><span className="detail-label">Order Code</span><span className="detail-value" style={{ fontWeight: 700 }}>{selected.order_code}</span></div>
            <div className="detail-row"><span className="detail-label">Coach</span><span className="detail-value">{selected.coach_name || '-'} ({tierLabel(selected.tier)})</span></div>
            <div className="detail-row"><span className="detail-label">Sesi</span><span className="detail-value">{selected.sessions}</span></div>
            {selected.validity_months != null && (
              <div className="detail-row"><span className="detail-label">Masa Berlaku</span><span className="detail-value">{selected.validity_months} bulan</span></div>
            )}
            <div className="modal-section">
              <div className="detail-row"><span className="detail-label">Customer</span><span className="detail-value">{selected.customer_name}</span></div>
              <div className="detail-row"><span className="detail-label">WA</span><span className="detail-value">{selected.customer_wa}</span></div>
              {selected.customer_email && <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{selected.customer_email}</span></div>}
            </div>
            <div className="modal-section">
              <div className="detail-row"><span className="detail-label">Harga</span><span className="detail-value">{fmtRp(selected.price)}</span></div>
              <div className="detail-row"><span className="detail-label">Status</span><span><span className={`badge ${(STATUS_LABEL[selected.status] || { css: '' }).css}`}>{(STATUS_LABEL[selected.status] || { label: selected.status }).label}</span></span></div>
              <div className="detail-row"><span className="detail-label">Payment</span><span className="detail-value">{selected.payment_method || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Paid At</span><span className="detail-value">{fmtDateTime(selected.paid_at)}</span></div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setSelected(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
