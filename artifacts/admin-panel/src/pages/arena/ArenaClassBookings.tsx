import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate, fmtTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import BookingDetailModal from '../../components/arena/BookingDetailModal'
import ManualBookingModal from '../../components/arena/ManualBookingModal'
import ConfirmModal from '../../components/arena/ConfirmModal'
import RescheduleModal from '../../components/arena/RescheduleModal'

const PAGE_SIZE = 20

export default function ArenaClassBookings() {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [filterType, setFilterType] = useState('paid_at')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [selectedBooking, setSelectedBooking] = useState<Record<string, unknown> | null>(null)
  const [rescheduleBooking, setRescheduleBooking] = useState<Record<string, unknown> | null>(null)
  const [showManual, setShowManual] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState<Record<string, unknown> | null>(null)
  const [confirmConfirm, setConfirmConfirm] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('arena_class_bookings')
      .select(`
        id, booking_code, schedule_id, booker_type, customer_type,
        full_name, email, phone, notes, price, discount, price_before_disc,
        status, payment_method, payment_ref, voucher_code, paid_at, created_at, updated_at,
        group_id, utm_source, utm_medium, utm_campaign,
        addons:arena_class_booking_addons(
          id, addon_name, addon_price, qty, subtotal
        ),
        schedule:arena_class_schedules(
          schedule_date, start_time, end_time, instructor,
          class_type:arena_class_types(name, color)
        )
      `, { count: 'exact' })

    if (statusFilter !== 'all') query = query.eq('status', statusFilter)

    if (search) {
      const isGroupSearch = /^[0-9a-f]{4}$/i.test(search.trim())
      if (isGroupSearch) {
        query = query.or(
          `full_name.ilike.%${search}%,` +
          `booking_code.ilike.%${search}%,` +
          `email.ilike.%${search}%,` +
          `phone.ilike.%${search}%`
        )
      } else {
        query = query.or(
          `full_name.ilike.%${search}%,` +
          `booking_code.ilike.%${search}%,` +
          `email.ilike.%${search}%,` +
          `phone.ilike.%${search}%,` +
          `payment_method.ilike.%${search}%`
        )
      }
    }

    if (filterType !== 'schedule_date') {
      if (dateFrom) query = query.gte(filterType, dateFrom + 'T00:00:00')
      if (dateTo) query = query.lte(filterType, dateTo + 'T23:59:59')
    }

    query = query
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    const isScheduleDateFilter = filterType === 'schedule_date' && (dateFrom || dateTo)
    const isGroupSearch = search && /^[0-9a-f]{4}$/i.test(search.trim())

    if (!isScheduleDateFilter && !isGroupSearch) {
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    }

    const { data: rows, count, error: err } = await query
    if (err) { setError(err.message); setLoading(false); return }

    if (isScheduleDateFilter) {
      const fd = dateFrom || '0000-00-00'
      const td = dateTo || '9999-99-99'
      const filtered = (rows || []).filter(r => {
        const sd = (r.schedule as unknown as Record<string, unknown> | undefined)?.schedule_date as string | undefined
        if (!sd) return false
        return sd >= fd && sd <= td
      })
      setData(filtered as Record<string, unknown>[])
      setTotal(filtered.length)
    } else if (isGroupSearch) {
      const s = search.toLowerCase()
      const filtered = (rows || []).filter(r =>
        (r.group_id as string | null)?.startsWith(s) ||
        (r.full_name as string | null)?.toLowerCase().includes(s) ||
        (r.booking_code as string | null)?.toLowerCase().includes(s) ||
        (r.email as string | null)?.toLowerCase().includes(s) ||
        (r.phone as string | null)?.includes(search)
      )
      setData(filtered as Record<string, unknown>[])
      setTotal(filtered.length)
    } else {
      setData(rows as Record<string, unknown>[] || [])
      setTotal(count || 0)
    }

    setLoading(false)
  }, [search, statusFilter, page, filterType, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleConfirmBooking = async (booking: Record<string, unknown>) => {
    const { error } = await supabase.from('arena_class_bookings').update({
      status: 'confirmed', payment_method: 'cash',
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (error) setError(error.message)
    else { setConfirmConfirm(null); fetchData() }
  }

  const handleCancelBooking = async (booking: Record<string, unknown>) => {
    const { error } = await supabase.from('arena_class_bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (error) setError(error.message)
    else { setConfirmCancel(null); fetchData() }
  }

  const handleExport = async () => {
    const { data: all } = await supabase
      .from('arena_class_bookings')
      .select(`
        booking_code,
        schedule:arena_class_schedules(schedule_date, start_time, end_time, class_type:arena_class_types(name)),
        full_name, email, phone, customer_type, price_before_disc, discount, price,
        status, payment_method, paid_at, created_at,
        utm_source, utm_medium, utm_campaign
      `)
      .order('paid_at', { ascending: false, nullsFirst: false })
    if (all) {
      const flat = all.map((r: Record<string, unknown>) => {
        const sch = r.schedule as Record<string, unknown> | undefined
        const ct = sch?.class_type as Record<string, unknown> | undefined
        return {
          booking_code: r.booking_code,
          class_name: ct?.name || '',
          schedule_date: sch?.schedule_date || '',
          start_time: sch?.start_time || '',
          end_time: sch?.end_time || '',
          full_name: r.full_name,
          email: r.email,
          phone: r.phone,
          customer_type: r.customer_type,
          price_before_disc: r.price_before_disc,
          discount: r.discount,
          price: r.price,
          status: r.status,
          payment_method: r.payment_method,
          paid_at: r.paid_at,
          created_at: r.created_at,
          utm_source: r.utm_source || '',
          utm_medium: r.utm_medium || '',
          utm_campaign: r.utm_campaign || '',
        }
      })
      exportToCSV(flat as Record<string, unknown>[], 'class_bookings')
    }
  }

  const hasFilter = !!(search || statusFilter !== 'all' || dateFrom || dateTo)
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Class Bookings</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
          <button className="btn-primary" onClick={() => setShowManual(true)}>+ Manual Booking</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, kode, email, telp, grup..."
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
          <option value="schedule_date">Filter by Tgl Kelas</option>
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
              <th>Booking Code</th><th>Grp</th><th>Kelas</th>
              <th>Tgl Bayar</th>
              <th>Jadwal</th><th>Nama</th>
              <th>Telp</th><th>Amount</th><th>Status</th><th>Payment</th>
              <th style={{ fontSize: 11, color: '#9CA3AF' }}>Ref</th>
              <th style={{ fontSize: 11, color: '#9CA3AF' }}>UTM Source</th>
              <th style={{ fontSize: 11, color: '#9CA3AF' }}>UTM Medium</th>
              <th style={{ fontSize: 11, color: '#9CA3AF' }}>UTM Campaign</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={15}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={15} className="empty-state">Tidak ada data</td></tr>
            ) : data.map((row: Record<string, unknown>) => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status, css: '' }
              const sch = row.schedule as Record<string, unknown> | undefined
              const ct = sch?.class_type as Record<string, unknown> | undefined
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.booking_code as string}</td>
                  <td style={{ textAlign: 'center' }}>
                    {row.group_id ? (
                      <span
                        title={`Group ID: ${row.group_id as string}`}
                        style={{
                          display: 'inline-block', padding: '2px 6px',
                          borderRadius: 3, background: '#F3F0FF',
                          color: '#7C3AED', fontSize: 10,
                          fontFamily: 'monospace', fontWeight: 700,
                          letterSpacing: '0.05em', cursor: 'help',
                        }}
                      >
                        {(row.group_id as string).slice(0, 4).toUpperCase()}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    {!!ct?.color && <span style={{ color: ct.color as string, marginRight: 4 }}>●</span>}
                    {ct?.name as string || '-'}
                  </td>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                    {row.paid_at ? fmtDate(row.paid_at as string) : '-'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {fmtDate(sch?.schedule_date as string)} {fmtTime(sch?.start_time as string)}
                  </td>
                  <td>{row.full_name as string}</td>
                  <td>{row.phone as string}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <div style={{ fontWeight: 600 }}>{fmtRp(row.price as number)}</div>
                    {((row.addons as unknown[]) || []).length > 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                        + {((row.addons as unknown[]) || []).length} add-on
                      </div>
                    )}
                  </td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td>{row.payment_method as string || '-'}</td>
                  <td style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                    {(() => {
                      const isVoucher = row.payment_method === 'voucher'
                      const refValue = (isVoucher ? row.voucher_code : row.payment_ref) as string | null
                      if (!refValue) return '-'
                      return (
                        <span
                          title={isVoucher ? `Voucher: ${refValue}` : `Mayar ID: ${refValue}`}
                          style={{
                            display: 'inline-block',
                            maxWidth: 80,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            cursor: 'help',
                          }}
                        >
                          {refValue}
                        </span>
                      )
                    })()}
                  </td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text-muted)' }} title={(row.utm_source as string) || ''}>{(row.utm_source as string) || '-'}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text-muted)' }} title={(row.utm_medium as string) || ''}>{(row.utm_medium as string) || '-'}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text-muted)' }} title={(row.utm_campaign as string) || ''}>{(row.utm_campaign as string) || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => setSelectedBooking(row)}>Detail</button>
                    <button
                      className="action-btn"
                      style={{ borderColor: '#2563EB', color: '#2563EB' }}
                      onClick={() => setRescheduleBooking(row)}
                    >
                      Edit
                    </button>
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
        <BookingDetailModal type="class" booking={selectedBooking} onClose={() => setSelectedBooking(null)} onRefresh={fetchData} />
      )}
      {showManual && (
        <ManualBookingModal type="class" onClose={() => setShowManual(false)} onRefresh={fetchData} />
      )}
      {rescheduleBooking && (
        <RescheduleModal
          booking={rescheduleBooking}
          onClose={() => setRescheduleBooking(null)}
          onRefresh={fetchData}
        />
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
