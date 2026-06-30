import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '@workspace/admin-shared'
import { fmtRp, fmtDate, fmtTime, fmtDateTime, exportToCSV } from '@workspace/admin-shared'
import { ConfirmModal } from '@workspace/admin-shared'

const UNIT_ID = '6e8f44a7-23d4-4602-90d4-980c63b3acc2'
const PAGE_SIZE = 20

interface Booking {
  id: string; booking_code: string; unit_id: string; booking_date: string;
  start_time: string; end_time: string; booker_type: string; customer_type: string;
  full_name: string; email: string; phone: string; notes: string | null;
  price: number; discount: number; price_before_disc: number;
  status: string; payment_method: string | null; payment_ref: string | null;
  paid_at: string | null; created_at: string; updated_at: string | null;
}

interface EditForm {
  full_name: string; email: string; phone: string; customer_type: string;
  booking_date: string; start_time: string; end_time: string;
  price_before_disc: string; discount: string; notes: string;
  status: string; payment_ref: string;
}

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'badge-confirmed', pending_payment: 'badge-pending',
  cancelled: 'badge-cancelled', completed: 'badge-confirmed', no_show: 'badge-cancelled',
}
const STATUS_LABEL_MAP: Record<string, string> = {
  confirmed: 'Confirmed', pending_payment: 'Pending',
  cancelled: 'Cancelled', completed: 'Completed', no_show: 'No Show',
}

const durStr = (start: string, end: string) => {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const mins = (eh * 60 + em) - (sh * 60 + sm)
  if (mins <= 0) return '-'
  return mins >= 60
    ? `${Math.floor(mins / 60)}j${mins % 60 > 0 ? ` ${mins % 60}m` : ''}`
    : `${mins}m`
}

const emptyForm = () => ({
  full_name: '', email: '', phone: '', customer_type: 'individual',
  booking_date: '', start_time: '', end_time: '', notes: '',
  price_before_disc: '', discount: '0', paid: false, payment_ref: '',
})

const toEditForm = (b: Booking): EditForm => ({
  full_name: b.full_name,
  email: b.email === 'noemail@20fit.id' ? '' : b.email,
  phone: b.phone === '0' ? '' : b.phone,
  customer_type: b.customer_type,
  booking_date: b.booking_date,
  start_time: b.start_time.slice(0, 5),
  end_time: b.end_time.slice(0, 5),
  price_before_disc: String(b.price_before_disc),
  discount: String(b.discount || 0),
  notes: b.notes || '',
  status: b.status,
  payment_ref: b.payment_ref || '',
})

export default function ArenaVenueBooking() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  // Filters
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Modals
  const [showCreate, setShowCreate] = useState(false)
  const [selectedBooking, setSelectedBooking] = useState<Booking | null>(null)
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [editBooking, setEditBooking] = useState<Booking | null>(null)

  // Create form
  const [form, setForm] = useState(emptyForm())
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Edit form
  const [editForm, setEditForm] = useState<EditForm | null>(null)
  const [editError, setEditError] = useState('')
  const [editSubmitting, setEditSubmitting] = useState(false)

  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchBookings = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('arena_bookings')
      .select('*', { count: 'exact' })
      .eq('customer_type', 'corporation')
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (statusFilter !== 'all') q = q.eq('status', statusFilter)
    if (search) q = q.or(
      `full_name.ilike.%${search}%,` +
      `booking_code.ilike.%${search}%,` +
      `phone.ilike.%${search}%,` +
      `email.ilike.%${search}%,` +
      `notes.ilike.%${search}%`
    )
    if (dateFrom) q = q.gte('booking_date', dateFrom)
    if (dateTo) q = q.lte('booking_date', dateTo)
    const { data, count, error: err } = await q
    if (err) setError(err.message)
    else { setBookings((data || []) as Booking[]); setTotal(count || 0) }
    setLoading(false)
  }, [search, statusFilter, dateFrom, dateTo, page])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const resetForm = () => { setForm(emptyForm()); setFormError('') }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.full_name || !form.booking_date || !form.start_time || !form.end_time || !form.price_before_disc) {
      return setFormError('Lengkapi semua field wajib')
    }
    if (form.start_time >= form.end_time) return setFormError('Jam selesai harus lebih dari jam mulai')
    setSubmitting(true)
    try {
      const { data: codeData, error: codeErr } = await supabase.rpc('generate_booking_code')
      if (codeErr) throw codeErr
      const priceBeforeDisc = Number(form.price_before_disc) || 0
      const discount = Number(form.discount) || 0
      const { error: insertErr } = await supabase.from('arena_bookings').insert({
        booking_code: codeData, unit_id: UNIT_ID,
        booking_date: form.booking_date, start_time: form.start_time, end_time: form.end_time,
        booker_type: 'guest', customer_type: form.customer_type,
        full_name: form.full_name.trim(), email: form.email?.trim() || 'noemail@20fit.id',
        phone: form.phone?.trim() || '0', notes: form.notes?.trim() || null,
        price_before_disc: priceBeforeDisc, discount, price: priceBeforeDisc - discount,
        status: form.paid ? 'confirmed' : 'pending_payment', payment_method: 'transfer',
        payment_ref: form.payment_ref?.trim() || null,
        paid_at: form.paid ? new Date().toISOString() : null,
      })
      if (insertErr) throw insertErr
      setShowCreate(false); resetForm(); fetchBookings()
    } catch (err: unknown) {
      setFormError(err instanceof Error ? err.message : 'Terjadi kesalahan')
    } finally {
      setSubmitting(false)
    }
  }

  const openEdit = (b: Booking) => {
    setEditForm(toEditForm(b))
    setEditError('')
    setEditBooking(b)
  }

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editForm || !editBooking) return
    setEditError('')
    if (!editForm.full_name.trim()) return setEditError('Nama wajib diisi')
    if (!editForm.booking_date) return setEditError('Tanggal wajib diisi')
    if (!editForm.start_time || !editForm.end_time) return setEditError('Jam wajib diisi')
    if (editForm.start_time >= editForm.end_time) return setEditError('Jam selesai harus lebih dari jam mulai')
    const priceRaw = Number(editForm.price_before_disc) || 0
    const discount = Number(editForm.discount) || 0
    setEditSubmitting(true)
    const { error: err } = await supabase
      .from('arena_bookings')
      .update({
        full_name: editForm.full_name.trim(),
        email: editForm.email.trim() || 'noemail@20fit.id',
        phone: editForm.phone.trim() || '0',
        booking_date: editForm.booking_date,
        start_time: editForm.start_time,
        end_time: editForm.end_time,
        customer_type: editForm.customer_type,
        price_before_disc: priceRaw,
        discount,
        price: priceRaw - discount,
        notes: editForm.notes.trim() || null,
        status: editForm.status,
        payment_ref: editForm.payment_ref.trim() || null,
        payment_method: editForm.status === 'confirmed' ? 'transfer' : null,
        paid_at: editForm.status === 'confirmed'
          ? (editBooking.paid_at || new Date().toISOString())
          : null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', editBooking.id)
    setEditSubmitting(false)
    if (err) { setEditError(err.message); return }
    setEditBooking(null); setEditForm(null); fetchBookings()
  }

  const handleConfirm = async (booking: Booking) => {
    const { error: err } = await supabase.from('arena_bookings').update({
      status: 'confirmed', payment_method: 'transfer',
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    if (!err) { setSelectedBooking(null); fetchBookings() }
  }

  const handleCancel = async () => {
    if (!selectedBooking) return
    const { error: err } = await supabase.from('arena_bookings').update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', selectedBooking.id)
    if (!err) { setShowCancelConfirm(false); setSelectedBooking(null); fetchBookings() }
  }

  const handleExport = async () => {
    const { data } = await supabase
      .from('arena_bookings')
      .select('booking_code, full_name, email, phone, customer_type, booking_date, start_time, end_time, price_before_disc, discount, price, status, payment_method, payment_ref, paid_at, notes, created_at')
      .order('booking_date', { ascending: false })
    if (data) {
      exportToCSV(data.map((b: Record<string, unknown>) => ({
        ...b,
        booking_date: fmtDate(b.booking_date as string),
        start_time: fmtTime(b.start_time as string),
        end_time: fmtTime(b.end_time as string),
        paid_at: b.paid_at ? fmtDateTime(b.paid_at as string) : '',
        created_at: fmtDateTime(b.created_at as string),
      })), 'venue_bookings')
    }
  }

  const priceFinal = (Number(form.price_before_disc) || 0) - (Number(form.discount) || 0)
  const editPriceFinal = editForm ? (Number(editForm.price_before_disc) || 0) - (Number(editForm.discount) || 0) : 0
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Venue Booking</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
          <button className="btn-primary" onClick={() => { resetForm(); setShowCreate(true) }}>+ Buat Booking</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, kode, telp, email, catatan..."
          value={searchInput} onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          <option value="pending_payment">Pending</option>
          <option value="confirmed">Confirmed</option>
          <option value="completed">Completed</option>
          <option value="no_show">No Show</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} title="Dari tanggal" />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>s/d</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} title="Sampai tanggal" />
        {(searchInput || statusFilter !== 'all' || dateFrom || dateTo) && (
          <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setSearchInput(''); setStatusFilter('all'); setDateFrom(''); setDateTo(''); setPage(0) }}>
            Reset
          </button>
        )}
        <div style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)' }}>{total} booking</div>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Booking Code</th><th>Nama / Organisasi</th><th>Telp</th>
              <th>Tanggal</th><th>Waktu</th><th>Durasi</th><th>Harga</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={9}>Memuat data...</td></tr>
            ) : bookings.length === 0 ? (
              <tr><td colSpan={9} className="empty-state">Tidak ada data</td></tr>
            ) : bookings.map(b => (
              <tr key={b.id}>
                <td><code style={{ fontSize: 11 }}>{b.booking_code}</code></td>
                <td>
                  <div style={{ fontWeight: 600 }}>{b.full_name}</div>
                  {b.notes && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{b.notes.slice(0, 40)}</div>}
                </td>
                <td>{b.phone}</td>
                <td>{fmtDate(b.booking_date)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(b.start_time)} – {fmtTime(b.end_time)}</td>
                <td>{durStr(b.start_time, b.end_time)}</td>
                <td style={{ fontWeight: 600 }}>{fmtRp(b.price)}</td>
                <td><span className={`badge ${STATUS_BADGE[b.status] || ''}`}>{STATUS_LABEL_MAP[b.status] || b.status}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => setSelectedBooking(b)}>Detail</button>
                  <button
                    className="action-btn"
                    style={{ borderColor: '#2563EB', color: '#2563EB' }}
                    onClick={() => openEdit(b)}
                  >
                    Edit
                  </button>
                  {b.status !== 'cancelled' && (
                    <button className="action-btn cancel" onClick={() => { setSelectedBooking(b); setShowCancelConfirm(true) }}>Cancel</button>
                  )}
                </td>
              </tr>
            ))}
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

      {/* Create Booking Modal */}
      {showCreate && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 620 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Buat Venue Booking</h3>
              <button onClick={() => setShowCreate(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleCreate}>
              <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 12 }}>Informasi Pelanggan</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nama / Organisasi *</label>
                  <input type="text" value={form.full_name} onChange={e => setForm(p => ({ ...p, full_name: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Tipe Customer</label>
                  <select value={form.customer_type} onChange={e => setForm(p => ({ ...p, customer_type: e.target.value }))}>
                    <option value="individual">Individu</option>
                    <option value="corporation">Korporasi</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="opsional" />
                </div>
                <div className="form-group">
                  <label>No. Telepon *</label>
                  <input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} required />
                </div>
              </div>
              <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '16px 0 12px' }}>Detail Venue</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tanggal *</label>
                  <input type="date" value={form.booking_date} onChange={e => setForm(p => ({ ...p, booking_date: e.target.value }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Jam Mulai *</label>
                  <input type="time" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Jam Selesai *</label>
                  <input type="time" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} required />
                </div>
              </div>
              <div className="form-group">
                <label>Catatan</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Setup event, kebutuhan khusus, dll..." />
              </div>
              <div style={{ fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '16px 0 12px' }}>Harga & Pembayaran</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Harga Normal (Rp) *</label>
                  <input type="number" min={0} value={form.price_before_disc} onChange={e => setForm(p => ({ ...p, price_before_disc: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Diskon (Rp)</label>
                  <input type="number" min={0} value={form.discount} onChange={e => setForm(p => ({ ...p, discount: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)', marginBottom: 16 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Harga Final:</span>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{fmtRp(Math.max(0, priceFinal))}</span>
              </div>
              <div className="form-group">
                <label>Status Pembayaran</label>
                <div style={{ display: 'flex', gap: 24, marginTop: 6 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input type="radio" name="paid" checked={!form.paid} onChange={() => setForm(p => ({ ...p, paid: false }))} /> Belum Bayar
                  </label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input type="radio" name="paid" checked={form.paid} onChange={() => setForm(p => ({ ...p, paid: true }))} /> Sudah Bayar
                  </label>
                </div>
              </div>
              {form.paid && (
                <div className="form-group">
                  <label>Referensi Transfer</label>
                  <input type="text" value={form.payment_ref} onChange={e => setForm(p => ({ ...p, payment_ref: e.target.value }))} placeholder="TRF/20260515/001 (opsional)" />
                </div>
              )}
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowCreate(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={submitting}>{submitting ? 'Menyimpan...' : 'Simpan Booking'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Booking Modal */}
      {editBooking && editForm && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 560 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Edit Venue Booking</h3>
              <button onClick={() => { setEditBooking(null); setEditForm(null) }} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>{editBooking.booking_code}</p>
            {editError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{editError}</p>}
            <form onSubmit={handleEditSubmit}>
              <div className="form-group">
                <label>Nama / Organisasi *</label>
                <input type="text" value={editForm.full_name} onChange={e => setEditForm(p => p && ({ ...p, full_name: e.target.value }))} required />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input type="email" value={editForm.email} onChange={e => setEditForm(p => p && ({ ...p, email: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>No. Telepon *</label>
                  <input type="text" value={editForm.phone} onChange={e => setEditForm(p => p && ({ ...p, phone: e.target.value }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tanggal *</label>
                  <input type="date" value={editForm.booking_date} onChange={e => setEditForm(p => p && ({ ...p, booking_date: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Tipe Customer</label>
                  <select value={editForm.customer_type} onChange={e => setEditForm(p => p && ({ ...p, customer_type: e.target.value }))}>
                    <option value="individual">Individu</option>
                    <option value="corporation">Korporasi</option>
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Jam Mulai *</label>
                  <input type="time" value={editForm.start_time} onChange={e => setEditForm(p => p && ({ ...p, start_time: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Jam Selesai *</label>
                  <input type="time" value={editForm.end_time} onChange={e => setEditForm(p => p && ({ ...p, end_time: e.target.value }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Harga Normal (Rp) *</label>
                  <input type="number" min={0} value={editForm.price_before_disc} onChange={e => setEditForm(p => p && ({ ...p, price_before_disc: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Diskon (Rp)</label>
                  <input type="number" min={0} value={editForm.discount} onChange={e => setEditForm(p => p && ({ ...p, discount: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderTop: '1px solid var(--border)', marginBottom: 16 }}>
                <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Harga Final:</span>
                <span style={{ fontWeight: 700, fontSize: 16 }}>{fmtRp(Math.max(0, editPriceFinal))}</span>
              </div>
              <div className="form-group">
                <label>Catatan</label>
                <textarea value={editForm.notes} onChange={e => setEditForm(p => p && ({ ...p, notes: e.target.value }))} rows={2} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Status Bayar</label>
                  <select value={editForm.status} onChange={e => setEditForm(p => p && ({ ...p, status: e.target.value }))}>
                    <option value="confirmed">Sudah Bayar</option>
                    <option value="pending_payment">Belum Bayar</option>
                    <option value="cancelled">Cancelled</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Referensi Transfer</label>
                  <input type="text" value={editForm.payment_ref} onChange={e => setEditForm(p => p && ({ ...p, payment_ref: e.target.value }))} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => { setEditBooking(null); setEditForm(null) }}>Batal</button>
                <button type="submit" className="btn-primary" disabled={editSubmitting}>{editSubmitting ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedBooking && !showCancelConfirm && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--text-muted)', marginBottom: 2 }}>{selectedBooking.booking_code}</div>
                <span className={`badge ${STATUS_BADGE[selectedBooking.status] || ''}`}>{STATUS_LABEL_MAP[selectedBooking.status] || selectedBooking.status}</span>
              </div>
              <button onClick={() => setSelectedBooking(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <div className="detail-section">
              <div className="detail-section-title">Informasi Customer</div>
              <div className="detail-row"><span>Nama</span><span>{selectedBooking.full_name}</span></div>
              <div className="detail-row"><span>Email</span><span>{selectedBooking.email}</span></div>
              <div className="detail-row"><span>Telp</span><span>{selectedBooking.phone}</span></div>
              <div className="detail-row"><span>Tipe</span><span>{selectedBooking.customer_type === 'corporation' ? 'Korporasi' : 'Individu'}</span></div>
            </div>
            <div className="detail-section">
              <div className="detail-section-title">Detail Venue</div>
              <div className="detail-row"><span>Tanggal</span><span>{fmtDate(selectedBooking.booking_date)}</span></div>
              <div className="detail-row">
                <span>Waktu</span>
                <span>{fmtTime(selectedBooking.start_time)} – {fmtTime(selectedBooking.end_time)} ({durStr(selectedBooking.start_time, selectedBooking.end_time)})</span>
              </div>
              {selectedBooking.notes && <div className="detail-row"><span>Catatan</span><span style={{ textAlign: 'right', maxWidth: 260 }}>{selectedBooking.notes}</span></div>}
            </div>
            <div className="detail-section">
              <div className="detail-section-title">Pembayaran</div>
              <div className="detail-row"><span>Harga Normal</span><span>{fmtRp(selectedBooking.price_before_disc)}</span></div>
              <div className="detail-row"><span>Diskon</span><span>{fmtRp(selectedBooking.discount)}</span></div>
              <div className="detail-row" style={{ fontWeight: 700 }}><span>Harga Final</span><span>{fmtRp(selectedBooking.price)}</span></div>
              <div className="detail-row"><span>Metode</span><span>{selectedBooking.payment_method || '-'}</span></div>
              {selectedBooking.payment_ref && <div className="detail-row"><span>Referensi</span><span>{selectedBooking.payment_ref}</span></div>}
              <div className="detail-row"><span>Dibayar</span><span>{selectedBooking.paid_at ? fmtDateTime(selectedBooking.paid_at) : '-'}</span></div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 20 }}>Dibuat: {fmtDateTime(selectedBooking.created_at)}</div>
            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
              <button className="btn-secondary" onClick={() => setSelectedBooking(null)}>Tutup</button>
              <div style={{ display: 'flex', gap: 8 }}>
                {selectedBooking.status === 'pending_payment' && (
                  <button className="btn-primary" onClick={() => handleConfirm(selectedBooking)}>Tandai Lunas</button>
                )}
                {selectedBooking.status !== 'cancelled' && (
                  <button className="btn-danger" onClick={() => setShowCancelConfirm(true)}>Cancel Booking</button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {showCancelConfirm && selectedBooking && (
        <ConfirmModal
          title="Batalkan Booking"
          message={`Batalkan booking ${selectedBooking.booking_code} atas nama ${selectedBooking.full_name}?`}
          onConfirm={handleCancel}
          onCancel={() => { setShowCancelConfirm(false); setSelectedBooking(null) }}
          danger
        />
      )}
    </div>
  )
}
