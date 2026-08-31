import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, fmtRp, fmtDate, fmtTime, fmtDateTime, STATUS_LABEL, exportToCSV, ConfirmModal } from '@workspace/admin-shared'

const PAGE_SIZE = 20

type Row = Record<string, unknown>

export default function GymClassBookings() {
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
      .from('gym_class_bookings')
      .select(`
        id, booking_code, schedule_id, full_name, email, phone, notes,
        price, discount, price_before_disc, status, payment_method, payment_ref,
        paid_at, created_at, channel,
        schedule:gym_class_schedules(
          schedule_date, start_time, end_time, instructor,
          class_type:gym_class_types(name, color)
        )
      `, { count: 'exact' })

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (search) query = query.or(
      `full_name.ilike.%${search}%,` +
      `booking_code.ilike.%${search}%,` +
      `email.ilike.%${search}%,` +
      `phone.ilike.%${search}%,` +
      `payment_method.ilike.%${search}%`
    )
    if (filterType !== 'schedule_date') {
      if (dateFrom) query = query.gte(filterType, dateFrom + 'T00:00:00')
      if (dateTo) query = query.lte(filterType, dateTo + 'T23:59:59')
    }
    query = query
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    const isScheduleDateFilter = filterType === 'schedule_date' && (dateFrom || dateTo)
    if (!isScheduleDateFilter) query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    const { data: rows, count, error: err } = await query
    if (err) { setError(err.message); setLoading(false); return }

    if (isScheduleDateFilter) {
      const fd = dateFrom || '0000-00-00', td = dateTo || '9999-99-99'
      const filtered = (rows || []).filter(r => {
        const sd = (r.schedule as unknown as Row | undefined)?.schedule_date as string | undefined
        return sd ? sd >= fd && sd <= td : false
      })
      setData(filtered as Row[]); setTotal(filtered.length)
    } else {
      setData((rows as Row[]) || []); setTotal(count || 0)
    }
    setError(''); setLoading(false)
  }, [search, statusFilter, page, filterType, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleConfirm = async (b: Row) => {
    const { error: err } = await supabase.from('gym_class_bookings').update({
      status: 'confirmed', payment_method: 'cash',
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', b.id as string)
    if (err) setError(err.message)
    else { setConfirmConfirm(null); fetchData() }
  }

  const handleCancel = async (b: Row) => {
    const { error: err } = await supabase.from('gym_class_bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', b.id as string)
    if (err) setError(err.message)
    else { setConfirmCancel(null); fetchData() }
  }

  const handleExport = async () => {
    const { data: all } = await supabase
      .from('gym_class_bookings')
      .select('booking_code, schedule:gym_class_schedules(schedule_date, start_time, class_type:gym_class_types(name)), full_name, email, phone, price_before_disc, discount, price, status, payment_method, paid_at, created_at, channel')
      .order('paid_at', { ascending: false, nullsFirst: false })
    if (all) {
      const flat = (all as Row[]).map(r => {
        const sch = r.schedule as Row | undefined
        const ct = sch?.class_type as Row | undefined
        return {
          booking_code: r.booking_code, class_name: ct?.name || '',
          schedule_date: sch?.schedule_date || '', start_time: sch?.start_time || '',
          full_name: r.full_name, email: r.email, phone: r.phone,
          price_before_disc: r.price_before_disc, discount: r.discount, price: r.price,
          status: r.status, payment_method: r.payment_method, paid_at: r.paid_at,
          created_at: r.created_at, channel: r.channel || '',
        }
      })
      exportToCSV(flat as Row[], 'gym_class_bookings')
    }
  }

  const hasFilter = !!(search || statusFilter !== 'all' || dateFrom || dateTo)
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  const schOf = (r: Row) => r.schedule as Row | undefined
  const ctOf = (r: Row) => (r.schedule as Row | undefined)?.class_type as Row | undefined

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Class Bookings</h2>
        <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input type="text" placeholder="Cari nama, kode, email, telp..." value={searchInput}
          onChange={e => handleSearchChange(e.target.value)} style={{ minWidth: 200 }} />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending_payment">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={filterType} onChange={e => { setFilterType(e.target.value); setDateFrom(''); setDateTo(''); setPage(0) }} style={{ minWidth: 160 }}>
          <option value="paid_at">Filter by Tgl Bayar</option>
          <option value="created_at">Filter by Tgl Daftar</option>
          <option value="schedule_date">Filter by Tgl Kelas</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>s/d</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} />
        {hasFilter && (
          <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setSearchInput(''); setStatusFilter('all'); setDateFrom(''); setDateTo(''); setPage(0) }}>
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Booking Code</th><th>Kelas</th><th>Jadwal</th><th>Nama</th>
              <th>Telp</th><th>Amount</th><th>Status</th><th>Payment</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={9}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={9} className="empty-state">Tidak ada data</td></tr>
            ) : data.map(row => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status as string, css: '' }
              const sch = schOf(row); const ct = ctOf(row)
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.booking_code as string}</td>
                  <td>
                    {!!ct?.color && <span style={{ color: ct.color as string, marginRight: 4 }}>●</span>}
                    {(ct?.name as string) || '-'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {fmtDate(sch?.schedule_date as string)} {fmtTime(sch?.start_time as string)}
                  </td>
                  <td>{row.full_name as string}</td>
                  <td>{row.phone as string}</td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(row.price as number)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td>{(row.payment_method as string) || '-'}</td>
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

      {selected && (() => {
        const sch = schOf(selected); const ct = ctOf(selected)
        return (
          <div className="modal-overlay" onClick={() => setSelected(null)}>
            <div className="modal-box" style={{ maxWidth: 500 }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
                <h3 className="modal-title" style={{ margin: 0 }}>Detail Booking</h3>
                <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
              </div>
              <div className="detail-row"><span className="detail-label">Booking Code</span><span className="detail-value" style={{ fontWeight: 700, fontFamily: 'monospace' }}>{selected.booking_code as string}</span></div>
              <div className="detail-row"><span className="detail-label">Kelas</span><span className="detail-value">{(ct?.name as string) || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Jadwal</span><span className="detail-value">{fmtDate(sch?.schedule_date as string)} {fmtTime(sch?.start_time as string)}–{fmtTime(sch?.end_time as string)}</span></div>
              <div className="detail-row"><span className="detail-label">Instruktur</span><span className="detail-value">{(sch?.instructor as string) || '-'}</span></div>
              <div className="modal-section">
                <div className="detail-row"><span className="detail-label">Nama</span><span className="detail-value">{selected.full_name as string}</span></div>
                <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{(selected.email as string) || '-'}</span></div>
                <div className="detail-row"><span className="detail-label">Telp</span><span className="detail-value">{selected.phone as string}</span></div>
                {!!selected.notes && <div className="detail-row"><span className="detail-label">Notes</span><span className="detail-value">{selected.notes as string}</span></div>}
              </div>
              <div className="modal-section">
                <div className="detail-row"><span className="detail-label">Harga</span><span className="detail-value">{fmtRp(selected.price as number)}</span></div>
                {!!selected.discount && <div className="detail-row"><span className="detail-label">Diskon</span><span className="detail-value">{fmtRp(selected.discount as number)}</span></div>}
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
        )
      })()}

      {confirmConfirm && (
        <ConfirmModal title="Konfirmasi Booking"
          message={`Konfirmasi booking ${confirmConfirm.booking_code as string}? Ditandai lunas (cash).`}
          onConfirm={() => handleConfirm(confirmConfirm)} onCancel={() => setConfirmConfirm(null)} />
      )}
      {confirmCancel && (
        <ConfirmModal title="Batalkan Booking"
          message={`Batalkan booking ${confirmCancel.booking_code as string}?`}
          onConfirm={() => handleCancel(confirmCancel)} onCancel={() => setConfirmCancel(null)} danger />
      )}
    </div>
  )
}
