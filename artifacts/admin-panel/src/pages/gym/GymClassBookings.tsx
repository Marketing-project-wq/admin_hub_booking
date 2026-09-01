import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate, fmtDateTime, fmtTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import ConfirmModal from '../../components/gym/ConfirmModal'

// GYM — Transaksi (daftar gym_class_bookings SAJA). Mirror kemampuan
// ArenaClassBookings, TAPI hanya baca/tulis tabel gym_*. Skema gym lebih ramping:
// tanpa booker_type / customer_type / group_id / voucher / utm / add-ons; ada kolom channel.

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
  // Sisa kuota per schedule (quota - booking confirmed), dihitung untuk baris yang tampil.
  const [remaining, setRemaining] = useState<Record<string, number>>({})
  const [selectedBooking, setSelectedBooking] = useState<Row | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<Row | null>(null)
  const [confirmConfirm, setConfirmConfirm] = useState<Row | null>(null)
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('gym_class_bookings')
      .select(`
        id, booking_code, schedule_id,
        full_name, email, phone, notes, price, discount, price_before_disc,
        status, payment_method, payment_ref, channel, paid_at, created_at, updated_at,
        schedule:gym_class_schedules(
          schedule_date, start_time, end_time, instructor, quota,
          class_type:gym_class_types(name, color)
        )
      `, { count: 'exact' })

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

    // paid_at / created_at bisa difilter di server; schedule_date ada di tabel join
    // sehingga difilter di klien (pola sama ArenaClassBookings).
    if (filterType !== 'schedule_date') {
      if (dateFrom) query = query.gte(filterType, dateFrom + 'T00:00:00')
      if (dateTo) query = query.lte(filterType, dateTo + 'T23:59:59')
    }

    query = query
      .order('paid_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })

    const isScheduleDateFilter = filterType === 'schedule_date' && (dateFrom || dateTo)
    if (!isScheduleDateFilter) {
      query = query.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    }

    const { data: rows, count, error: err } = await query
    if (err) { setError(err.message); setLoading(false); return }

    let list = (rows || []) as Row[]
    if (isScheduleDateFilter) {
      const fd = dateFrom || '0000-00-00'
      const td = dateTo || '9999-99-99'
      list = list.filter(r => {
        const sd = (r.schedule as Row | undefined)?.schedule_date as string | undefined
        return sd ? sd >= fd && sd <= td : false
      })
      setData(list)
      setTotal(list.length)
    } else {
      setData(list)
      setTotal(count || 0)
    }

    // Hitung sisa kuota: jumlah confirmed per schedule yang tampil di halaman ini.
    const schedIds = Array.from(new Set(list.map(r => r.schedule_id as string).filter(Boolean)))
    if (schedIds.length > 0) {
      const { data: confirmedRows } = await supabase
        .from('gym_class_bookings')
        .select('schedule_id')
        .in('schedule_id', schedIds)
        .eq('status', 'confirmed')
      const counts: Record<string, number> = {}
      for (const b of (confirmedRows || [])) {
        const sid = (b as Row).schedule_id as string
        counts[sid] = (counts[sid] || 0) + 1
      }
      const rem: Record<string, number> = {}
      for (const r of list) {
        const sid = r.schedule_id as string
        const quota = ((r.schedule as Row | undefined)?.quota as number) ?? 0
        rem[sid] = quota - (counts[sid] || 0)
      }
      setRemaining(rem)
    } else {
      setRemaining({})
    }

    setLoading(false)
  }, [search, statusFilter, page, filterType, dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleConfirmBooking = async (booking: Row) => {
    const { error } = await supabase.from('gym_class_bookings').update({
      status: 'confirmed', payment_method: 'cash',
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (error) setError(error.message)
    else { setConfirmConfirm(null); fetchData() }
  }

  const handleCancelBooking = async (booking: Row) => {
    const { error } = await supabase.from('gym_class_bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (error) setError(error.message)
    else { setConfirmCancel(null); fetchData() }
  }

  const handleExport = async () => {
    const { data: all } = await supabase
      .from('gym_class_bookings')
      .select(`
        booking_code,
        schedule:gym_class_schedules(schedule_date, start_time, end_time, instructor, class_type:gym_class_types(name)),
        full_name, email, phone, price_before_disc, discount, price,
        status, payment_method, payment_ref, channel, paid_at, created_at
      `)
      .order('paid_at', { ascending: false, nullsFirst: false })
    if (all) {
      const flat = all.map((r: Row) => {
        const sch = r.schedule as Row | undefined
        const ct = sch?.class_type as Row | undefined
        return {
          booking_code: r.booking_code,
          class_name: ct?.name || '',
          schedule_date: sch?.schedule_date || '',
          start_time: sch?.start_time || '',
          end_time: sch?.end_time || '',
          instructor: sch?.instructor || '',
          full_name: r.full_name,
          email: r.email,
          phone: r.phone,
          price_before_disc: r.price_before_disc,
          discount: r.discount,
          price: r.price,
          status: r.status,
          payment_method: r.payment_method,
          payment_ref: r.payment_ref || '',
          channel: r.channel || '',
          paid_at: r.paid_at,
          created_at: r.created_at,
        }
      })
      exportToCSV(flat as Row[], 'gym_class_bookings')
    }
  }

  const hasFilter = !!(search || statusFilter !== 'all' || dateFrom || dateTo)
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Transaksi</h2>
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
              <th>Booking Code</th><th>Kelas</th>
              <th>Tgl Bayar</th><th>Jadwal</th><th>Nama</th><th>Telp</th>
              <th>Amount</th><th>Sisa Kuota</th><th>Status</th><th>Payment</th>
              <th style={{ fontSize: 11, color: '#9CA3AF' }}>Channel</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={12}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={12} className="empty-state">Tidak ada data</td></tr>
            ) : data.map((row: Row) => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status, css: '' }
              const sch = row.schedule as Row | undefined
              const ct = sch?.class_type as Row | undefined
              const sisa = remaining[row.schedule_id as string]
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.booking_code as string}</td>
                  <td>
                    {!!ct?.color && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ct.color as string, marginRight: 4 }} />}
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
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(row.price as number)}</td>
                  <td style={{ textAlign: 'center', color: sisa === 0 ? 'var(--red)' : 'inherit', fontWeight: sisa === 0 ? 700 : 400 }}>
                    {sisa === undefined ? '-' : sisa}
                  </td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td>{row.payment_method as string || '-'}</td>
                  <td style={{ fontSize: 11, whiteSpace: 'nowrap', color: 'var(--text-muted)' }} title={(row.channel as string) || ''}>{(row.channel as string) || '-'}</td>
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

      {/* Detail modal (gym-scoped, self-contained) */}
      {selectedBooking && (() => {
        const b = selectedBooking
        const sch = b.schedule as Row | undefined
        const ct = sch?.class_type as Row | undefined
        const st = STATUS_LABEL[b.status as string] || { label: b.status, css: '' }
        const sisa = remaining[b.schedule_id as string]
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
              <div style={rowStyle}><span style={lbl}>Kelas</span><span>
                {!!ct?.color && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: ct.color as string, marginRight: 6 }} />}
                {(ct?.name as string) || '-'}
              </span></div>
              <div style={rowStyle}><span style={lbl}>Jadwal</span><span>{fmtDate(sch?.schedule_date as string)} {fmtTime(sch?.start_time as string)}–{fmtTime(sch?.end_time as string)}</span></div>
              <div style={rowStyle}><span style={lbl}>Instruktur</span><span>{(sch?.instructor as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Sisa Kuota</span><span>{sisa === undefined ? '-' : `${sisa} / ${(sch?.quota as number) ?? '-'}`}</span></div>
              <div style={rowStyle}><span style={lbl}>Nama</span><span>{b.full_name as string}</span></div>
              <div style={rowStyle}><span style={lbl}>Email</span><span>{(b.email as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Telepon</span><span>{(b.phone as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Harga Normal</span><span>{fmtRp(b.price_before_disc as number)}</span></div>
              <div style={rowStyle}><span style={lbl}>Diskon</span><span>{fmtRp(b.discount as number)}</span></div>
              <div style={rowStyle}><span style={lbl}>Total Bayar</span><span style={{ fontWeight: 700 }}>{fmtRp(b.price as number)}</span></div>
              <div style={rowStyle}><span style={lbl}>Metode Bayar</span><span>{(b.payment_method as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Referensi</span><span style={{ fontFamily: 'monospace', fontSize: 12 }}>{(b.payment_ref as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Channel</span><span>{(b.channel as string) || '-'}</span></div>
              <div style={rowStyle}><span style={lbl}>Tgl Bayar</span><span>{b.paid_at ? fmtDateTime(b.paid_at as string) : '-'}</span></div>
              <div style={{ ...rowStyle, borderBottom: 'none' }}><span style={lbl}>Tgl Daftar</span><span>{fmtDateTime(b.created_at as string)}</span></div>
              {!!b.notes && (
                <div style={{ marginTop: 10, fontSize: 13 }}>
                  <div style={{ ...lbl, marginBottom: 4 }}>Catatan</div>
                  <div>{b.notes as string}</div>
                </div>
              )}
              <div className="modal-footer">
                {b.status === 'pending_payment' && (
                  <button className="btn-primary" onClick={() => { setConfirmConfirm(b); setSelectedBooking(null) }}>Confirm</button>
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
          title="Konfirmasi Booking"
          message={`Konfirmasi booking ${confirmConfirm.booking_code as string}? Status jadi Confirmed dan ditandai lunas (cash).`}
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
