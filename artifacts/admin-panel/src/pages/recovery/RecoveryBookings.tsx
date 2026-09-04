import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate, fmtDateTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import ConfirmModal from '../../components/recovery/ConfirmModal'

// RECOVERY CENTER — Booking. Daftar clinic_bookings dengan channel='recovery_center'
// SAJA (isolasi per unit). Layanan di-embed dari clinic_services. Skema ramping:
// tanpa jadwal/kuota/diskon — booking layanan tunggal + pembayaran.
const CHANNEL = 'recovery_center'
const PAGE_SIZE = 20

type Row = Record<string, unknown>

export default function RecoveryBookings() {
  const [data, setData] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [filterType, setFilterType] = useState('created_at')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedBooking, setSelectedBooking] = useState<Row | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<Row | null>(null)
  const [confirmConfirm, setConfirmConfirm] = useState<Row | null>(null)
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('clinic_bookings')
      .select(`
        id, booking_code, full_name, email, phone, notes,
        price, status, payment_method, payment_ref, channel, paid_at, created_at, updated_at,
        service:clinic_services(name, code, duration_minutes)
      `, { count: 'exact' })
      .eq('channel', CHANNEL)

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    if (search) {
      query = query.or(
        `full_name.ilike.%${search}%,` +
        `booking_code.ilike.%${search}%,` +
        `email.ilike.%${search}%,` +
        `phone.ilike.%${search}%,` +
        `payment_method.ilike.%${search}%`
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
    setData((rows || []) as Row[])
    setTotal(count || 0)
    setError('')
    setLoading(false)
  }, [search, statusFilter, page, filterType, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleConfirmBooking = async (booking: Row) => {
    const { error } = await supabase.from('clinic_bookings').update({
      status: 'confirmed', payment_method: 'cash',
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (error) setError(error.message)
    else { setConfirmConfirm(null); fetchData() }
  }

  const handleCancelBooking = async (booking: Row) => {
    const { error } = await supabase.from('clinic_bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (error) setError(error.message)
    else { setConfirmCancel(null); fetchData() }
  }

  const handleExport = async () => {
    const { data: all } = await supabase
      .from('clinic_bookings')
      .select(`
        booking_code, service:clinic_services(name, code),
        full_name, email, phone, price,
        status, payment_method, payment_ref, paid_at, created_at
      `)
      .eq('channel', CHANNEL)
      .order('paid_at', { ascending: false, nullsFirst: false })
    if (all) {
      const flat = all.map((r: Row) => {
        const svc = r.service as Row | undefined
        return {
          booking_code: r.booking_code,
          service: svc?.name || '',
          full_name: r.full_name,
          email: r.email,
          phone: r.phone,
          price: r.price,
          status: r.status,
          payment_method: r.payment_method,
          payment_ref: r.payment_ref || '',
          paid_at: r.paid_at,
          created_at: r.created_at,
        }
      })
      exportToCSV(flat as Row[], 'recovery_center_bookings')
    }
  }

  const hasFilter = !!(search || statusFilter !== 'all' || dateFrom || dateTo)
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Booking Recovery Center</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, kode, email, telp..."
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
          <option value="created_at">Filter by Tgl Booking</option>
          <option value="paid_at">Filter by Tgl Bayar</option>
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
              <th>Booking Code</th><th>Layanan</th><th>Nama</th><th>Email</th><th>Telp</th>
              <th>Amount</th><th>Status</th><th>Payment</th><th>Jam Bayar</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={10}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={10} className="empty-state">Tidak ada data</td></tr>
            ) : data.map((row: Row) => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status, css: '' }
              const svc = row.service as Row | undefined
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.booking_code as string}</td>
                  <td>{(svc?.name as string) || '-'}</td>
                  <td>{row.full_name as string}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(row.email as string) || '-'}</td>
                  <td>{(row.phone as string) || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(row.price as number)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td>{row.payment_method as string || '-'}</td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                    {row.paid_at ? fmtDateTime(row.paid_at as string) : '-'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => setSelectedBooking(row)}>Detail</button>
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

      {/* Detail modal (recovery-scoped, self-contained) */}
      {selectedBooking && (() => {
        const b = selectedBooking
        const svc = b.service as Row | undefined
        const st = STATUS_LABEL[b.status as string] || { label: b.status, css: '' }
        const rowStyle: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--border)', fontSize: 13 }
        const lbl: React.CSSProperties = { color: 'var(--text-muted)' }
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth: 460 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 className="modal-title" style={{ margin: 0 }}>Detail Booking</h3>
                <button onClick={() => setSelectedBooking(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700 }}>{b.booking_code as string}</span>
                <span className={`badge ${st.css}`}>{st.label}</span>
              </div>
              <div style={rowStyle}><span style={lbl}>Layanan</span><span>{(svc?.name as string) || '-'}</span></div>
              {!!svc?.duration_minutes && <div style={rowStyle}><span style={lbl}>Durasi</span><span>{svc.duration_minutes as number} menit</span></div>}
              <div style={rowStyle}><span style={lbl}>Nama</span><span>{b.full_name as string}</span></div>
              <div style={rowStyle}><span style={lbl}>Email</span><span>{(b.email as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Telepon</span><span>{(b.phone as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Total Bayar</span><span style={{ fontWeight: 700 }}>{fmtRp(b.price as number)}</span></div>
              <div style={rowStyle}><span style={lbl}>Metode Bayar</span><span>{(b.payment_method as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Referensi</span><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{(b.payment_ref as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Jam Bayar</span><span>{b.paid_at ? fmtDateTime(b.paid_at as string) : '-'}</span></div>
              <div style={{ ...rowStyle, borderBottom: 'none' }}><span style={lbl}>Tgl Booking</span><span>{fmtDateTime(b.created_at as string)}</span></div>
              {!!b.notes && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <div style={{ ...lbl, marginBottom: 4 }}>Catatan</div>
                  <div>{b.notes as string}</div>
                </div>
              )}
              <div className="modal-footer">
                {b.status === 'pending_payment' && (
                  <button className="btn-primary" onClick={() => { setConfirmConfirm(b); setSelectedBooking(null) }}>Tandai Lunas (Cash)</button>
                )}
                {b.status !== 'cancelled' && (
                  <button className="btn-danger" onClick={() => { setConfirmCancel(b); setSelectedBooking(null) }}>Cancel</button>
                )}
                <button className="btn-secondary" onClick={() => setSelectedBooking(null)}>Tutup</button>
              </div>
            </div>
          </div>
        )
      })()}

      {confirmConfirm && (
        <ConfirmModal
          title="Konfirmasi Pembayaran"
          message={`Tandai booking ${confirmConfirm.booking_code as string} sebagai LUNAS (cash)? Jam bayar akan diisi sekarang.`}
          onConfirm={() => handleConfirmBooking(confirmConfirm)}
          onCancel={() => setConfirmConfirm(null)}
        />
      )}
      {confirmCancel && (
        <ConfirmModal
          title="Batalkan Booking"
          message={`Batalkan booking ${confirmCancel.booking_code as string}?`}
          onConfirm={() => handleCancelBooking(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
          danger
        />
      )}
    </div>
  )
}
