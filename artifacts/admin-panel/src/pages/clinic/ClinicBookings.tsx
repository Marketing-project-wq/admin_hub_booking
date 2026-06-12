import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fmtRp, fmtDate, fmtTime, fmtDateTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import ConfirmModal from '../../components/arena/ConfirmModal'
import ManualBookingModal from '../../components/clinic/ManualBookingModal'
import {
  getBookings, getAllBookings, confirmBooking, cancelBooking, serviceName,
  todayISO, daysAgoISO,
  type ClinicBooking, type BookingFilters,
} from '../../lib/clinic'

const PAGE_SIZE = 20

export default function ClinicBookings() {
  const [data, setData] = useState<ClinicBooking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState(() => daysAgoISO(30))
  const [dateTo, setDateTo] = useState(todayISO)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [showManual, setShowManual] = useState(false)
  const [selected, setSelected] = useState<ClinicBooking | null>(null)
  const [confirmConfirm, setConfirmConfirm] = useState<ClinicBooking | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<ClinicBooking | null>(null)
  const [acting, setActing] = useState(false)

  const filters: BookingFilters = { status: statusFilter, dateFrom, dateTo, search }

  const fetchData = useCallback(async () => {
    setLoading(true)
    console.log('date range:', dateFrom, dateTo)
    try {
      const { data: rows, count } = await getBookings({ status: statusFilter, dateFrom, dateTo, search }, page, PAGE_SIZE)
      console.log('fetch result:', rows, count)
      setData(rows); setTotal(count); setError('')
    } catch (err) {
      console.log('fetch result:', null, err)
      setError(err instanceof Error ? err.message : 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, dateFrom, dateTo, search, page])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleConfirm = async (b: ClinicBooking) => {
    setActing(true)
    try {
      await confirmBooking(b.id)
      setConfirmConfirm(null); setSelected(null); fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal konfirmasi')
    } finally { setActing(false) }
  }

  const handleCancel = async (b: ClinicBooking) => {
    setActing(true)
    try {
      await cancelBooking(b.id)
      setConfirmCancel(null); setSelected(null); fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan')
    } finally { setActing(false) }
  }

  const handleExport = async () => {
    try {
      const all = await getAllBookings(filters)
      const flat = all.map(b => ({
        booking_code: b.booking_code,
        service: serviceName(b),
        full_name: b.full_name,
        email: b.email || '',
        phone: b.phone || '',
        slot_date: b.slot_date || '',
        slot_time: b.slot_time || '',
        status: b.status,
        price: b.price,
        payment_method: b.payment_method || '',
        paid_at: b.paid_at || '',
        created_at: b.created_at,
      }))
      exportToCSV(flat as unknown as Record<string, unknown>[], 'clinic_bookings')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal export')
    }
  }

  const hasFilter = !!(search || statusFilter !== 'all' || dateFrom || dateTo)
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Clinic Bookings</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
          <button className="btn-primary" onClick={() => setShowManual(true)}>+ Tambah Booking Manual</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, email, kode booking..."
          value={searchInput} onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending_payment">Pending Payment</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} title="Dari tanggal" />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>s/d</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} title="Sampai tanggal" />
        {hasFilter && (
          <button
            className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setSearchInput(''); setStatusFilter('all'); setDateFrom(''); setDateTo(''); setPage(0) }}
          >
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Booking Code</th><th>Layanan</th><th>Nama</th><th>Telp</th>
              <th>Tgl Slot</th><th>Jam</th><th>Status</th><th>Harga</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">Tidak ada data</td></tr>
            ) : data.map(b => {
              const s = STATUS_LABEL[b.status] || { label: b.status, css: '' }
              return (
                <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(b)}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.booking_code}</td>
                  <td>{serviceName(b)}</td>
                  <td>{b.full_name}</td>
                  <td>{b.phone || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(b.slot_date)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtTime(b.slot_time)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(b.price)}</td>
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

      {/* ── Detail modal ─────────────────────────────────────────────────────── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Detail Booking</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 10, columnGap: 12, fontSize: 14 }}>
              <Field label="Booking Code" value={<span style={{ fontFamily: 'monospace' }}>{selected.booking_code}</span>} />
              <Field label="Layanan" value={serviceName(selected)} />
              <Field label="Nama" value={selected.full_name} />
              <Field label="Email" value={selected.email || '-'} />
              <Field label="Telp" value={selected.phone || '-'} />
              <Field label="Tgl Slot" value={fmtDate(selected.slot_date)} />
              <Field label="Jam" value={fmtTime(selected.slot_time)} />
              <Field label="Status" value={<span className={`badge ${(STATUS_LABEL[selected.status] || { css: '' }).css}`}>{(STATUS_LABEL[selected.status] || { label: selected.status }).label}</span>} />
              <Field label="Harga" value={fmtRp(selected.price)} />
              <Field label="Pembayaran" value={selected.payment_method || '-'} />
              <Field label="Dibayar" value={selected.paid_at ? fmtDateTime(selected.paid_at) : '-'} />
              <Field label="Dibuat" value={fmtDateTime(selected.created_at)} />
            </div>

            <div className="modal-footer">
              {selected.status === 'pending_payment' && (
                <button className="btn-primary" onClick={() => setConfirmConfirm(selected)}>Confirm</button>
              )}
              {selected.status !== 'cancelled' && (
                <button className="btn-danger" onClick={() => setConfirmCancel(selected)}>Cancel</button>
              )}
              <button className="btn-secondary" onClick={() => setSelected(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {showManual && (
        <ManualBookingModal
          onClose={() => setShowManual(false)}
          onSuccess={fetchData}
        />
      )}

      {confirmConfirm && (
        <ConfirmModal
          title="Konfirmasi Booking"
          message={`Konfirmasi booking ${confirmConfirm.booking_code}?`}
          onConfirm={() => handleConfirm(confirmConfirm)}
          onCancel={() => setConfirmConfirm(null)}
          loading={acting}
        />
      )}
      {confirmCancel && (
        <ConfirmModal
          title="Batalkan Booking"
          message={`Batalkan booking ${confirmCancel.booking_code}?`}
          onConfirm={() => handleCancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
          danger
          loading={acting}
        />
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </>
  )
}
