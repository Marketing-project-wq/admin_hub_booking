import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, fmtRp, fmtDateTime, STATUS_LABEL, exportToCSV, ConfirmModal } from '@workspace/admin-shared'

const PAGE_SIZE = 20
type Row = Record<string, unknown>

export default function GymMembershipOrders() {
  const [data, setData] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selected, setSelected] = useState<Row | null>(null)
  const [confirmConfirm, setConfirmConfirm] = useState<Row | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<Row | null>(null)
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('gym_membership_orders')
      .select('id, order_code, plan_id, plan_name, duration_months, price, full_name, email, phone, notes, status, payment_method, payment_ref, paid_at, created_at, channel', { count: 'exact' })
      .order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    if (search) q = q.or(
      `full_name.ilike.%${search}%,` +
      `order_code.ilike.%${search}%,` +
      `phone.ilike.%${search}%,` +
      `email.ilike.%${search}%,` +
      `plan_name.ilike.%${search}%`
    )
    q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    const { data: rows, count, error: err } = await q
    if (err) { setError(err.message); setLoading(false); return }
    setData((rows as Row[]) || []); setTotal(count || 0); setError(''); setLoading(false)
  }, [page, search, statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const handleConfirm = async (o: Row) => {
    const { error: err } = await supabase.from('gym_membership_orders').update({
      status: 'confirmed', payment_method: 'cash',
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', o.id as string)
    if (err) setError(err.message)
    else { setConfirmConfirm(null); fetchData() }
  }

  const handleCancel = async (o: Row) => {
    const { error: err } = await supabase.from('gym_membership_orders').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', o.id as string)
    if (err) setError(err.message)
    else { setConfirmCancel(null); fetchData() }
  }

  const handleExport = async () => {
    const { data: all } = await supabase.from('gym_membership_orders').select('*').order('created_at', { ascending: false })
    if (all) exportToCSV(all as Row[], 'gym_membership_orders')
  }

  const hasFilter = !!(search || statusFilter !== 'all')
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Membership Orders</h2>
        <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input type="text" placeholder="Cari nama, kode order, telp, plan..." value={searchInput}
          onChange={e => handleSearchChange(e.target.value)} style={{ minWidth: 240 }} />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending_payment">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>
        {hasFilter && (
          <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setSearchInput(''); setStatusFilter('all'); setPage(0) }}>Reset</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order Code</th><th>Plan</th><th>Durasi</th><th>Nama</th><th>Telp</th>
              <th>Amount</th><th>Status</th><th>Payment</th><th>Dibuat</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={10}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={10} className="empty-state">Tidak ada data</td></tr>
            ) : data.map(row => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status as string, css: '' }
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.order_code as string}</td>
                  <td>{row.plan_name as string}</td>
                  <td style={{ textAlign: 'center' }}>{row.duration_months as number} bln</td>
                  <td>{row.full_name as string}</td>
                  <td>{row.phone as string}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(row.price as number)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td>{(row.payment_method as string) || '-'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDateTime(row.created_at as string)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => setSelected(row)}>Detail</button>
                    {row.status === 'pending_payment' && (
                      <button className="action-btn confirm" onClick={() => setConfirmConfirm(row)}>Confirm</button>
                    )}
                    {row.status !== 'cancelled' && (
                      <button className="action-btn cancel" onClick={() => setConfirmCancel(row)}>Cancel</button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="pagination">
          <span>{total > 0 ? `${from}–${to} dari ${total} hasil` : '0 hasil'}</span>
          <div className="pagination-btns">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-box" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Detail Membership Order</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <div className="detail-row"><span className="detail-label">Order Code</span><span className="detail-value" style={{ fontWeight: 700, fontFamily: 'monospace' }}>{selected.order_code as string}</span></div>
            <div className="detail-row"><span className="detail-label">Plan</span><span className="detail-value">{selected.plan_name as string}</span></div>
            <div className="detail-row"><span className="detail-label">Durasi</span><span className="detail-value">{selected.duration_months as number} bulan</span></div>
            <div className="modal-section">
              <div className="detail-row"><span className="detail-label">Customer</span><span className="detail-value">{selected.full_name as string}</span></div>
              <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{(selected.email as string) || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Telp</span><span className="detail-value">{selected.phone as string}</span></div>
              {!!selected.notes && <div className="detail-row"><span className="detail-label">Notes</span><span className="detail-value">{selected.notes as string}</span></div>}
            </div>
            <div className="modal-section">
              <div className="detail-row"><span className="detail-label">Harga</span><span className="detail-value">{fmtRp(selected.price as number)}</span></div>
              <div className="detail-row"><span className="detail-label">Status</span><span><span className={`badge ${(STATUS_LABEL[selected.status as string] || { css: '' }).css}`}>{(STATUS_LABEL[selected.status as string] || { label: selected.status }).label as string}</span></span></div>
              <div className="detail-row"><span className="detail-label">Payment</span><span className="detail-value">{(selected.payment_method as string) || '-'} / {(selected.payment_ref as string) || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Paid At</span><span className="detail-value">{fmtDateTime(selected.paid_at as string)}</span></div>
              <div className="detail-row"><span className="detail-label">Channel</span><span className="detail-value">{(selected.channel as string) || '-'}</span></div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setSelected(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {confirmConfirm && (
        <ConfirmModal title="Konfirmasi Order"
          message={`Konfirmasi order ${confirmConfirm.order_code as string}? Ditandai lunas (cash).`}
          onConfirm={() => handleConfirm(confirmConfirm)} onCancel={() => setConfirmConfirm(null)} />
      )}
      {confirmCancel && (
        <ConfirmModal title="Batalkan Order"
          message={`Batalkan order ${confirmCancel.order_code as string}?`}
          onConfirm={() => handleCancel(confirmCancel)} onCancel={() => setConfirmCancel(null)} danger />
      )}
    </div>
  )
}
