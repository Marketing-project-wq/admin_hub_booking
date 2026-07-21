import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate, fmtTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import BookingDetailModal from '../../components/arena/BookingDetailModal'
import ManualBookingModal from '../../components/arena/ManualBookingModal'
import ConfirmModal from '../../components/arena/ConfirmModal'

const PAGE_SIZE = 20
// Default unit for the "Buat Booking" (venue) form — no longer hardcoded/locked:
// the form has a unit selector, this is only the pre-selected value.
const DEFAULT_UNIT_ID = '6e8f44a7-23d4-4602-90d4-980c63b3acc2'

const emptyVenueForm = () => ({
  unit_id: DEFAULT_UNIT_ID,
  full_name: '', email: '', phone: '', customer_type: 'corporation',
  booking_date: '', start_time: '', end_time: '', notes: '',
  price_before_disc: '', discount: '0', paid: false, payment_ref: '',
})

export default function ArenaBookings() {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [customerTypeFilter, setCustomerTypeFilter] = useState('all')
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

  // Venue create form (harga manual, bisa belum bayar, payment_ref)
  const [showVenueCreate, setShowVenueCreate] = useState(false)
  const [venueForm, setVenueForm] = useState(emptyVenueForm())
  const [venueError, setVenueError] = useState('')
  const [venueSubmitting, setVenueSubmitting] = useState(false)

  useEffect(() => {
    supabase.from('arena_booking_units').select('id, name').then(({ data }) => { if (data) setUnits(data) })
  }, [])

  const fetchData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('arena_bookings')
      .select('*, unit:arena_booking_units(name)', { count: 'exact' })
    if (customerTypeFilter !== 'all') query = query.eq('customer_type', customerTypeFilter)
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (search) query = query.or(
      `full_name.ilike.%${search}%,` +
      `booking_code.ilike.%${search}%,` +
      `phone.ilike.%${search}%,` +
      `email.ilike.%${search}%,` +
      `voucher_code.ilike.%${search}%,` +
      `notes.ilike.%${search}%`
    )
    if (dateFrom) query = query.gte('booking_date', dateFrom)
    if (dateTo) query = query.lte('booking_date', dateTo)
    if (unitFilter !== 'all') query = query.eq('unit_id', unitFilter)
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    const { data: rows, count, error: err } = await query
    if (err) setError(err.message)
    else { setData(rows || []); setTotal(count || 0) }
    setLoading(false)
  }, [search, statusFilter, customerTypeFilter, dateFrom, dateTo, unitFilter, page])

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

  const resetVenueForm = () => { setVenueForm(emptyVenueForm()); setVenueError('') }

  const handleVenueCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setVenueError('')
    if (!venueForm.unit_id) return setVenueError('Pilih unit terlebih dahulu')
    if (!venueForm.full_name || !venueForm.booking_date || !venueForm.start_time || !venueForm.end_time || !venueForm.price_before_disc) {
      return setVenueError('Lengkapi semua field wajib')
    }
    if (venueForm.start_time >= venueForm.end_time) return setVenueError('Jam selesai harus lebih dari jam mulai')
    setVenueSubmitting(true)
    try {
      const { data: codeData, error: codeErr } = await supabase.rpc('generate_booking_code')
      if (codeErr) throw codeErr
      const priceBeforeDisc = Number(venueForm.price_before_disc) || 0
      const discount = Number(venueForm.discount) || 0
      const { error: insertErr } = await supabase.from('arena_bookings').insert({
        booking_code: codeData, unit_id: venueForm.unit_id,
        booking_date: venueForm.booking_date, start_time: venueForm.start_time, end_time: venueForm.end_time,
        booker_type: 'guest', customer_type: venueForm.customer_type,
        full_name: venueForm.full_name.trim(), email: venueForm.email?.trim() || 'noemail@20fit.id',
        phone: venueForm.phone?.trim() || '0', notes: venueForm.notes?.trim() || null,
        price_before_disc: priceBeforeDisc, discount, price: priceBeforeDisc - discount,
        status: venueForm.paid ? 'confirmed' : 'pending_payment', payment_method: 'transfer',
        payment_ref: venueForm.payment_ref?.trim() || null,
        paid_at: venueForm.paid ? new Date().toISOString() : null,
      })
      if (insertErr) throw insertErr
      setShowVenueCreate(false); resetVenueForm(); fetchData()
    } catch (err: unknown) {
      const ex = err as { message?: string; details?: string; hint?: string; code?: string } | null
      const parts = [ex?.message, ex?.details, ex?.hint].filter(Boolean)
      setVenueError(parts.length ? `${parts.join(' — ')}${ex?.code ? ` (code: ${ex.code})` : ''}` : 'Terjadi kesalahan')
    } finally {
      setVenueSubmitting(false)
    }
  }

  const handleExport = async () => {
    const { data: all } = await supabase
      .from('arena_bookings')
      .select('booking_code, unit:arena_booking_units(name), booking_date, start_time, end_time, full_name, email, phone, customer_type, price_before_disc, discount, price, status, payment_method, payment_ref, paid_at, notes, created_at')
      .order('created_at', { ascending: false })
    if (all) {
      const flat = all.map((r: Record<string, unknown>) => ({
        ...r,
        unit_name: (r.unit as Record<string, unknown>)?.name || '',
        unit: undefined,
      }))
      exportToCSV(flat, 'bookings')
    }
  }

  const venuePriceFinal = (Number(venueForm.price_before_disc) || 0) - (Number(venueForm.discount) || 0)
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Bookings</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
          <button className="btn-secondary" onClick={() => { resetVenueForm(); setShowVenueCreate(true) }}>+ Buat Booking</button>
          <button className="btn-primary" onClick={() => setShowManual(true)}>+ Manual Booking</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari nama, kode, telp, email, voucher, catatan..."
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={customerTypeFilter} onChange={e => { setCustomerTypeFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Tipe</option>
          <option value="individual">Individual</option>
          <option value="corporation">Corporation</option>
        </select>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending_payment">Pending</option>
          <option value="completed">Completed</option>
          <option value="no_show">No Show</option>
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
              <th>Tipe</th>
              <th>Telp</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={11}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={11} className="empty-state">Tidak ada data</td></tr>
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
                  <td style={{ whiteSpace: 'nowrap' }}>{row.customer_type === 'corporation' ? 'Korporasi' : 'Individu'}</td>
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

      {/* Venue Create Modal — harga manual, bisa belum bayar, referensi transfer */}
      {showVenueCreate && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 620 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Buat Booking</h3>
              <button onClick={() => setShowVenueCreate(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            {venueError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{venueError}</p>}
            <form onSubmit={handleVenueCreate}>
              <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>Informasi Pelanggan</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nama / Organisasi *</label>
                  <input type="text" value={venueForm.full_name} onChange={e => setVenueForm(p => ({ ...p, full_name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Tipe Customer</label>
                  <select value={venueForm.customer_type} onChange={e => setVenueForm(p => ({ ...p, customer_type: e.target.value }))}>
                    <option value="individual">Individu</option>
                    <option value="corporation">Korporasi</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={venueForm.email} onChange={e => setVenueForm(p => ({ ...p, email: e.target.value }))} placeholder="opsional" />
                </div>
                <div className="form-group">
                  <label>No. Telepon *</label>
                  <input type="text" value={venueForm.phone} onChange={e => setVenueForm(p => ({ ...p, phone: e.target.value }))} required />
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '16px 0 12px' }}>Detail Venue</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Unit *</label>
                  <select value={venueForm.unit_id} onChange={e => setVenueForm(p => ({ ...p, unit_id: e.target.value }))} required>
                    <option value="">Pilih unit...</option>
                    {units.map((u: Record<string, unknown>) => (
                      <option key={u.id as string} value={u.id as string}>{u.name as string}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Tanggal *</label>
                  <input type="date" value={venueForm.booking_date} onChange={e => setVenueForm(p => ({ ...p, booking_date: e.target.value }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Jam Mulai *</label>
                  <input type="time" value={venueForm.start_time} onChange={e => setVenueForm(p => ({ ...p, start_time: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Jam Selesai *</label>
                  <input type="time" value={venueForm.end_time} onChange={e => setVenueForm(p => ({ ...p, end_time: e.target.value }))} required />
                </div>
              </div>
              <div className="form-group">
                <label>Catatan</label>
                <textarea value={venueForm.notes} onChange={e => setVenueForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Setup event, kebutuhan khusus, dll..." />
              </div>
              <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '16px 0 12px' }}>Harga & Pembayaran</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Harga Normal (Rp) *</label>
                  <input type="number" min={0} value={venueForm.price_before_disc} onChange={e => setVenueForm(p => ({ ...p, price_before_disc: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Diskon (Rp)</label>
                  <input type="number" min={0} value={venueForm.discount} onChange={e => setVenueForm(p => ({ ...p, discount: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)', marginBottom: 16 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Harga Final:</span>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{fmtRp(Math.max(0, venuePriceFinal))}</span>
              </div>
              <div className="form-group">
                <label>Status Pembayaran</label>
                <div style={{ display: 'flex', gap: 24, marginTop: 6 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input type="radio" name="venue-paid" checked={!venueForm.paid} onChange={() => setVenueForm(p => ({ ...p, paid: false }))} /> Belum Bayar
                  </label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input type="radio" name="venue-paid" checked={venueForm.paid} onChange={() => setVenueForm(p => ({ ...p, paid: true }))} /> Sudah Bayar
                  </label>
                </div>
              </div>
              {venueForm.paid && (
                <div className="form-group">
                  <label>Referensi Transfer</label>
                  <input type="text" value={venueForm.payment_ref} onChange={e => setVenueForm(p => ({ ...p, payment_ref: e.target.value }))} placeholder="TRF/20260515/001 (opsional)" />
                </div>
              )}
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowVenueCreate(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={venueSubmitting}>{venueSubmitting ? 'Menyimpan...' : 'Simpan Booking'}</button>
              </div>
            </form>
          </div>
        </div>
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
