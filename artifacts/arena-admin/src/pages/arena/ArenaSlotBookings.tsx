import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@workspace/admin-shared'
import { fmtRp, fmtDate, fmtTime, fmtDateTime, STATUS_LABEL, exportToCSV } from '@workspace/admin-shared'
import BookingDetailModal from '../../components/arena/BookingDetailModal'
import ManualBookingModal from '../../components/arena/ManualBookingModal'
import { ConfirmModal } from '@workspace/admin-shared'

const PAGE_SIZE = 20

export default function ArenaSlotBookings() {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [unitFilter, setUnitFilter] = useState('all')
  const [units, setUnits] = useState<Record<string, unknown>[]>([])
  const [selectedBooking, setSelectedBooking] = useState<Record<string, unknown> | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState<Record<string, unknown> | null>(null)
  const [confirmConfirm, setConfirmConfirm] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [searchInput, setSearchInput] = useState('')

  useEffect(() => {
    supabase.from('arena_booking_units').select('id, name').then(({ data }) => { if (data) setUnits(data) })
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('arena_bookings')
      .select('*, unit:arena_booking_units(name)', { count: 'exact' })
      .eq('customer_type', 'individual')
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (search) query = query.or(
      `full_name.ilike.%${search}%,` +
      `booking_code.ilike.%${search}%,` +
      `phone.ilike.%${search}%,` +
      `email.ilike.%${search}%,` +
      `voucher_code.ilike.%${search}%`
    )
    if (dateFrom) query = query.gte('booking_date', dateFrom)
    if (dateTo) query = query.lte('booking_date', dateTo)
    if (unitFilter !== 'all') query = query.eq('unit_id', unitFilter)
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    const { data: rows, count, error: err } = await query
    if (err) setError(err.message)
    else { setData(rows || []); setTotal(count || 0) }
    setLoading(false)
  }, [search, statusFilter, dateFrom, dateTo, unitFilter, page])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleConfirmBooking = async (booking: Record<string, unknown>) => {
    const { error } = await supabase.from('arena_bookings').update({
      status: 'confirmed', payment_method: 'cash', paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (error) setError(error.message)
    else { setConfirmConfirm(null); fetchData() }
  }

  const handleCancelBooking = async (booking: Record<string, unknown>) => {
    const { error } = await supabase.from('arena_bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (error) setError(error.message)
    else { setConfirmCancel(null); fetchData() }
  }

  const handleExport = async () => {
    const { data: all } = await supabase
      .from('arena_bookings')
      .select('booking_code, unit:arena_booking_units(name), booking_date, start_time, end_time, full_name, email, phone, customer_type, price_before_disc, discount, price, status, payment_method, paid_at, created_at')
      .order('created_at', { ascending: false })
    if (all) {
      const flat = all.map((r: Record<string, unknown>) => ({
        ...r,
        unit_name: (r.unit as Record<string, unknown>)?.name || '',
        unit: undefined,
      }))
      exportToCSV(flat, 'slot_bookings')
    }
  }

  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Slot Bookings</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
          <button className="btn-primary" onClick={() => setShowManual(true)}>+ Manual Booking</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari nama, kode, telp, email, voucher..."
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending_payment">Pending</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} placeholder="Dari" title="Dari tanggal" />
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} placeholder="Sampai" title="Sampai tanggal" />
        <select value={unitFilter} onChange={e => { setUnitFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Unit</option>
          {units.map((u: Record<string, unknown>) => <option key={u.id as string} value={u.id as string}>{u.name as string}</option>)}
        </select>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Booking Code</th>
              <th>Unit</th>
              <th>Tanggal</th>
              <th>Waktu</th>
              <th>Nama</th>
              <th>Telp</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={10}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={10} className="empty-state">Tidak ada data</td></tr>
            ) : data.map((row: Record<string, unknown>) => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status, css: '' }
              const unit = row.unit as Record<string, unknown> | undefined
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.booking_code as string}</td>
                  <td>{unit?.name as string || '-'}</td>
                  <td>{fmtDate(row.booking_date as string)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(row.start_time as string)}–{fmtTime(row.end_time as string)}</td>
                  <td>{row.full_name as string}</td>
                  <td>{row.phone as string}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(row.price as number)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td>{row.payment_method as string || '-'}</td>
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
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>

      {selectedBooking && (
        <BookingDetailModal
          type="slot"
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onRefresh={fetchData}
        />
      )}
      {showManual && (
        <ManualBookingModal type="slot" onClose={() => setShowManual(false)} onRefresh={fetchData} />
      )}
      {confirmConfirm && (
        <ConfirmModal
          title="Konfirmasi Booking"
          message={`Konfirmasi booking ${confirmConfirm.booking_code as string}?`}
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
