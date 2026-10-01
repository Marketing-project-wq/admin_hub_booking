import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate, fmtDateTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import ConfirmModal from '../../components/gym/ConfirmModal'

// GYM — Membership Orders (daftar gym_membership_orders SAJA; MBR-*). Mirror kemampuan
// GymClassBookings (search, filter status, filter tanggal, confirm cash-paid, cancel,
// export) tapi untuk order membership bulanan: tanpa schedule/kuota/gender.
// Confirm HANYA tampil untuk status 'pending_payment' → order yang sudah 'confirmed'
// via webhook Xendit tidak bisa di-"cash-paid" ulang (guard sama persis GymClassBookings).

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
  const [filterType, setFilterType] = useState('paid_at')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selected, setSelected] = useState<Row | null>(null)
  const [confirmConfirm, setConfirmConfirm] = useState<Row | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<Row | null>(null)
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('gym_membership_orders')
      .select(
        `id, order_code, plan_id, plan_name, duration_months, price,
         full_name, email, phone, notes, status, payment_method, payment_ref,
         channel, paid_at, created_at, updated_at`,
        { count: 'exact' },
      )

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    if (search) {
      query = query.or(
        `order_code.ilike.%${search}%,` +
        `full_name.ilike.%${search}%,` +
        `email.ilike.%${search}%,` +
        `phone.ilike.%${search}%,` +
        `plan_name.ilike.%${search}%`
      )
    }

    if (dateFrom) query = query.gte(filterType, dateFrom + 'T00:00:00')
    if (dateTo) query = query.lte(filterType, dateTo + 'T23:59:59')

    query = query
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    const { data: rows, count, error: err } = await query
    if (err) { setError(err.message); setLoading(false); return }
    setError('')
    setData((rows || []) as Row[])
    setTotal(count || 0)
    setLoading(false)
  }, [search, statusFilter, page, filterType, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  // Confirm = tandai lunas tunai (cash) untuk order yang BELUM dibayar (pending_payment).
  // Order yang sudah 'confirmed' (lunas via webhook Xendit) tak punya tombol Confirm.
  const handleConfirm = async (o: Row) => {
    const { error } = await supabase.from('gym_membership_orders').update({
      status: 'confirmed', payment_method: 'cash',
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', o.id)
    if (error) setError(error.message)
    else { setConfirmConfirm(null); fetchData() }
  }

  const handleCancel = async (o: Row) => {
    const { error } = await supabase.from('gym_membership_orders').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', o.id)
    if (error) setError(error.message)
    else { setConfirmCancel(null); fetchData() }
  }

  const handleExport = async () => {
    const { data: all } = await supabase
      .from('gym_membership_orders')
      .select(
        `order_code, plan_name, duration_months, price, full_name, email, phone,
         status, payment_method, payment_ref, channel, paid_at, created_at`,
      )
      .order('paid_at', { ascending: false, nullsFirst: false })
    if (all) exportToCSV(all as Row[], 'gym_membership_orders')
  }

  const hasFilter = !!(search || statusFilter !== 'all' || dateFrom || dateTo)
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  const planLabel = (o: Row) => {
    const n = o.duration_months as number | undefined
    return `${(o.plan_name as string) || '-'}${n ? ` (${n} bln)` : ''}`
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Membership Orders</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, kode order, email, telp, plan..."
          value={searchInput} onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 200 }}
        />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending_payment">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select
          value={filterType}
          onChange={e => { setFilterType(e.target.value); setDateFrom(''); setDateTo(''); setPage(0) }}
          style={{ minWidth: 160 }}
        >
          <option value="paid_at">Filter by Tgl Bayar</option>
          <option value="created_at">Filter by Tgl Daftar</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>s/d</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} />
        {hasFilter && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => {
              setSearch(''); setSearchInput('')
              setStatusFilter('all')
              setDateFrom(''); setDateTo('')
              setPage(0)
            }}
          >
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order Code</th><th>Paket</th>
              <th>Tgl Bayar</th><th>Nama</th><th>Telp</th>
              <th>Amount</th><th>Status</th><th>Payment</th>
              <th style={{ fontSize: 11, color: '#9CA3AF' }}>Channel</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={10}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={10} className="empty-state">Tidak ada data</td></tr>
            ) : data.map((row: Row) => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status, css: '' }
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.order_code as string}</td>
                  <td>{planLabel(row)}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                    {row.paid_at ? fmtDate(row.paid_at as string) : '-'}
                  </td>
                  <td>{row.full_name as string}</td>
                  <td>{row.phone as string}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(row.price as number)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td>{row.payment_method as string || '-'}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text-muted)' }} title={(row.channel as string) || ''}>{(row.channel as string) || '-'}</td>
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
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}><ArrowLeft size={13} style={{ verticalAlign: -2 }} /> Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
          </div>
        </div>
      </div>

      {/* Detail modal */}
      {selected && (() => {
        const o = selected
        const st = STATUS_LABEL[o.status as string] || { label: o.status, css: '' }
        const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }
        const lbl: React.CSSProperties = { color: 'var(--text-muted)' }
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth: 460 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 className="modal-title" style={{ margin: 0 }}>Detail Membership Order</h3>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{o.order_code as string}</span>
                <span className={`badge ${st.css}`}>{st.label}</span>
              </div>
              <div style={rowStyle}><span style={lbl}>Paket</span><span>{planLabel(o)}</span></div>
              <div style={rowStyle}><span style={lbl}>Nama</span><span>{o.full_name as string}</span></div>
              <div style={rowStyle}><span style={lbl}>Email</span><span>{(o.email as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Telepon</span><span>{(o.phone as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Total Bayar</span><span style={{ fontWeight: 700 }}>{fmtRp(o.price as number)}</span></div>
              <div style={rowStyle}><span style={lbl}>Metode Bayar</span><span>{(o.payment_method as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Referensi</span><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{(o.payment_ref as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Channel</span><span>{(o.channel as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Tgl Bayar</span><span>{o.paid_at ? fmtDateTime(o.paid_at as string) : '-'}</span></div>
              <div style={{ ...rowStyle, borderBottom: 'none' }}><span style={lbl}>Tgl Daftar</span><span>{fmtDateTime(o.created_at as string)}</span></div>
              {!!o.notes && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <div style={{ ...lbl, marginBottom: 4 }}>Catatan</div>
                  <div>{o.notes as string}</div>
                </div>
              )}
              <div className="modal-footer">
                {o.status === 'pending_payment' && (
                  <button className="btn-primary" onClick={() => { setConfirmConfirm(o); setSelected(null) }}>Confirm</button>
                )}
                {o.status !== 'cancelled' && (
                  <button className="btn-danger" onClick={() => { setConfirmCancel(o); setSelected(null) }}>Cancel</button>
                )}
                <button className="btn-secondary" onClick={() => setSelected(null)}>Tutup</button>
              </div>
            </div>
          </div>
        )
      })()}

      {confirmConfirm && (
        <ConfirmModal
          title="Konfirmasi Order"
          message={`Konfirmasi order ${confirmConfirm.order_code as string}? Status jadi Confirmed dan ditandai lunas (cash).`}
          onConfirm={() => handleConfirm(confirmConfirm)}
          onCancel={() => setConfirmConfirm(null)}
        />
      )}
      {confirmCancel && (
        <ConfirmModal
          title="Batalkan Order"
          message={`Batalkan order ${confirmCancel.order_code as string}?`}
          onConfirm={() => handleCancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
          danger
        />
      )}
    </div>
  )
}
