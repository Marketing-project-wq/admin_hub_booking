import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { fmtRp, fmtDate, fmtTime, fmtDateTime } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import {
  listVisitsLog, addVisit, updateVisit,
  listPatientsPaged, listServicesFull, listStaff, getPatient,
  getBookingByCode, createVisitFromBooking, todayISO,
  type ClinicVisitRow, type VisitPayload, type ClinicPatient,
  type ClinicServiceFull, type ClinicStaff, type BookingWithDetails,
} from '../../lib/clinic'

const PAGE_SIZE = 20

const STATUS_OPTIONS = ['scheduled', 'in_progress', 'completed', 'cancelled', 'no_show']
const STATUS_META: Record<string, { label: string; css?: string; style?: React.CSSProperties }> = {
  scheduled:   { label: 'Terjadwal',  css: 'badge-pending' },
  in_progress: { label: 'Berlangsung', style: { background: '#EFF6FF', color: '#1D4ED8' } },
  completed:   { label: 'Selesai',     css: 'badge-confirmed' },
  cancelled:   { label: 'Dibatalkan',  css: 'badge-cancelled' },
  no_show:     { label: 'Tidak Hadir', style: { background: '#F3F4F6', color: '#6B7280' } },
}
const PAYMENT_METHODS = ['cash', 'transfer', 'qris', 'insurance']
const PAYMENT_STATUSES = ['unpaid', 'paid', 'partial']
const PAYMENT_STATUS_LABEL: Record<string, string> = { unpaid: 'Belum Bayar', paid: 'Lunas', partial: 'Sebagian' }

function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || { label: status }
  return <span className={`badge ${m.css ?? ''}`} style={m.style}>{m.label}</span>
}

export default function ClinicVisits() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const patientFilterId = searchParams.get('patient_id')

  const [rows, setRows] = useState<ClinicVisitRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [patientName, setPatientName] = useState<string>('')

  const [showAdd, setShowAdd] = useState(false)
  const [selected, setSelected] = useState<ClinicVisitRow | null>(null)

  // Check-in from booking
  const [code, setCode] = useState('')
  const [searching, setSearching] = useState(false)
  const [booking, setBooking] = useState<BookingWithDetails | null>(null)
  const [checkinMsg, setCheckinMsg] = useState('')
  const [checkingIn, setCheckingIn] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { rows: r, count } = await listVisitsLog({
        patientId: patientFilterId ?? undefined,
        status: statusFilter,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search,
        page,
        pageSize: PAGE_SIZE,
      })
      setRows(r); setTotal(count); setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat kunjungan')
    } finally {
      setLoading(false)
    }
  }, [patientFilterId, statusFilter, dateFrom, dateTo, search, page])

  useEffect(() => { fetchData() }, [fetchData])

  // Resolve the patient name for the banner when filtering by ?patient_id.
  useEffect(() => {
    if (!patientFilterId) { setPatientName(''); return }
    let active = true
    getPatient(patientFilterId)
      .then(p => { if (active) setPatientName(p?.full_name ?? '') })
      .catch(() => {})
    return () => { active = false }
  }, [patientFilterId])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const clearPatientFilter = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('patient_id')
    setSearchParams(next, { replace: true })
    setPage(0)
  }

  const handleSearchBooking = async () => {
    if (!code.trim()) return
    setSearching(true); setCheckinMsg(''); setBooking(null)
    try {
      const b = await getBookingByCode(code)
      if (!b) setCheckinMsg('Booking tidak ditemukan')
      else setBooking(b)
    } catch (err) {
      setCheckinMsg(err instanceof Error ? err.message : 'Pencarian gagal')
    } finally {
      setSearching(false)
    }
  }

  const handleCheckin = async () => {
    if (!booking) return
    if (booking.visit_id) { setCheckinMsg('Booking ini sudah pernah check-in'); return }
    setCheckingIn(true)
    try {
      await createVisitFromBooking(booking.id)
      setBooking(null); setCode(''); setCheckinMsg('Check-in berhasil')
      setPage(0); fetchData()
    } catch (err) {
      setCheckinMsg(err instanceof Error ? err.message : 'Check-in gagal')
    } finally {
      setCheckingIn(false)
    }
  }

  const from = total > 0 ? page * PAGE_SIZE + 1 : 0
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Kunjungan</h2>
        <button className="btn-primary" onClick={() => setShowAdd(true)}>+ Tambah Kunjungan</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {patientFilterId && (
        <div className="card" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>
            Menampilkan kunjungan untuk: <strong>{patientName || '...'}</strong>
          </span>
          <button className="btn-secondary" onClick={clearPatientFilter}>Tampilkan Semua</button>
        </div>
      )}

      {/* ── Check-in from booking ────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px', fontSize: 16, fontWeight: 600 }}>Check-in dari Booking</h3>
        <div style={{ display: 'flex', gap: 8, maxWidth: 420 }}>
          <input
            type="text" placeholder="Masukkan Kode Booking" value={code}
            onChange={e => setCode(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSearchBooking())}
          />
          <button className="btn-primary" onClick={handleSearchBooking} disabled={searching}>
            {searching ? '...' : 'Cari'}
          </button>
        </div>
        {checkinMsg && <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 10 }}>{checkinMsg}</p>}

        {booking && (
          <div className="card" style={{ marginTop: 14, borderLeft: '3px solid var(--red)', maxWidth: 480 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>{booking.patient?.full_name || booking.full_name}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1fr', rowGap: 6, columnGap: 10, marginTop: 10, fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>Layanan</span><span>{booking.service?.name || '-'}</span>
              <span style={{ color: 'var(--text-muted)' }}>Tanggal Slot</span><span>{fmtDate(booking.slot?.slot_date)}</span>
              <span style={{ color: 'var(--text-muted)' }}>Jam Slot</span><span>{fmtTime(booking.slot?.start_time)}</span>
              <span style={{ color: 'var(--text-muted)' }}>Pembayaran</span>
              <span>{booking.payment_method === 'mayar' ? `Sudah dibayar online — ${fmtRp(booking.price)}` : (booking.payment_method || '-')}</span>
            </div>
            <button className="btn-primary" style={{ marginTop: 14 }} onClick={handleCheckin} disabled={checkingIn || !!booking.visit_id}>
              {booking.visit_id ? 'Sudah Check-in' : checkingIn ? 'Memproses...' : 'Check-in & Buat Kunjungan'}
            </button>
          </div>
        )}
      </div>

      {/* ── Filters ──────────────────────────────────────────────────────────── */}
      <div className="filter-bar">
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Dari</label>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} />
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sampai</label>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} />
        <input
          type="text" placeholder="Cari kode kunjungan..." value={searchInput}
          onChange={e => handleSearchChange(e.target.value)} style={{ minWidth: 200 }}
        />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kode</th><th>Pasien</th><th>Layanan</th><th>Tanggal</th>
              <th>Status</th><th>Pembayaran</th><th>Bayar</th><th>Ditangani</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={9}>Memuat data...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="empty-state">Tidak ada kunjungan</td></tr>
            ) : rows.map(v => (
              <tr key={v.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(v)}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{v.visit_code}</td>
                <td>
                  {v.patient?.full_name || '-'}
                  {v.patient?.patient_code && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v.patient.patient_code}</div>
                  )}
                </td>
                <td>{v.service?.name || '-'}</td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                  {fmtDate(v.visit_date)}{v.visit_time ? ` · ${fmtTime(v.visit_time)}` : ''}
                </td>
                <td><StatusBadge status={v.status} /></td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(v.payment_amount ?? 0)}</td>
                <td>
                  <span className="badge" style={v.payment_status === 'paid'
                    ? { background: '#ECFDF5', color: '#059669' }
                    : { background: '#F3F4F6', color: '#6B7280' }}>
                    {PAYMENT_STATUS_LABEL[v.payment_status ?? ''] || v.payment_status || '-'}
                  </span>
                </td>
                <td>{v.handled_by || '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }} onClick={e => e.stopPropagation()}>
                  <button className="action-btn detail" onClick={() => setSelected(v)}>Detail</button>
                  <button className="action-btn confirm" onClick={() => navigate(`/clinic/visits/${v.id}`)}>Buka</button>
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

      {showAdd && (
        <VisitFormModal
          mode="create"
          defaultPatientId={patientFilterId}
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); setPage(0); fetchData() }}
        />
      )}

      {selected && (
        <VisitDetailModal
          visit={selected}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); fetchData() }}
        />
      )}
    </div>
  )
}

// ─── Detail + edit modal ─────────────────────────────────────────────────────────
function VisitDetailModal({ visit, onClose, onSaved }: {
  visit: ClinicVisitRow; onClose: () => void; onSaved: () => void
}) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return <VisitFormModal mode="edit" visit={visit} onClose={() => setEditing(false)} onSaved={onSaved} />
  }
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Detail Kunjungan</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 9, columnGap: 12, fontSize: 14 }}>
          <Label>Kode</Label><Val><span style={{ fontFamily: 'monospace' }}>{visit.visit_code}</span></Val>
          <Label>Pasien</Label><Val>{visit.patient?.full_name || '-'}{visit.patient?.phone ? ` · ${visit.patient.phone}` : ''}</Val>
          <Label>Layanan</Label><Val>{visit.service?.name || '-'}</Val>
          <Label>Tanggal</Label><Val>{fmtDate(visit.visit_date)}</Val>
          <Label>Jam</Label><Val>{fmtTime(visit.visit_time)}</Val>
          <Label>Status</Label><Val><StatusBadge status={visit.status} /></Val>
          <Label>Keluhan Utama</Label><Val>{visit.chief_complaint || '-'}</Val>
          <Label>Catatan</Label><Val>{visit.notes || '-'}</Val>
          <Label>Ditangani oleh</Label><Val>{visit.handled_by || '-'}</Val>
          <Label>Metode Bayar</Label><Val>{visit.payment_method || '-'}</Val>
          <Label>Jumlah Bayar</Label><Val>{fmtRp(visit.payment_amount ?? 0)}</Val>
          <Label>Status Bayar</Label><Val>{PAYMENT_STATUS_LABEL[visit.payment_status ?? ''] || visit.payment_status || '-'}</Val>
          <Label>Dibuat</Label><Val>{fmtDateTime(visit.created_at)}</Val>
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Tutup</button>
          <button className="btn-primary" onClick={() => setEditing(true)}>Edit</button>
        </div>
      </div>
    </div>
  )
}

// ─── Create / edit form modal ────────────────────────────────────────────────────
function VisitFormModal({ mode, visit, defaultPatientId, onClose, onSaved }: {
  mode: 'create' | 'edit'
  visit?: ClinicVisitRow
  defaultPatientId?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { user } = useAuth()
  const [services, setServices] = useState<ClinicServiceFull[]>([])
  const [staff, setStaff] = useState<ClinicStaff[]>([])

  // Patient picker
  const [patientId, setPatientId] = useState(visit?.patient_id ?? defaultPatientId ?? '')
  const [patientLabel, setPatientLabel] = useState(
    visit?.patient ? `${visit.patient.full_name} (${visit.patient.patient_code})` : '',
  )
  const [patientQuery, setPatientQuery] = useState('')
  const [patientResults, setPatientResults] = useState<ClinicPatient[]>([])
  const [showResults, setShowResults] = useState(false)
  const patientTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [serviceId, setServiceId] = useState(visit?.service_id ?? '')
  const [visitDate, setVisitDate] = useState(visit?.visit_date ?? todayISO())
  const [visitTime, setVisitTime] = useState(visit?.visit_time ?? '')
  const [status, setStatus] = useState(visit?.status ?? 'scheduled')
  const [complaint, setComplaint] = useState(visit?.chief_complaint ?? '')
  const [notes, setNotes] = useState(visit?.notes ?? '')
  const [handledBy, setHandledBy] = useState(visit?.handled_by ?? '')
  const [paymentMethod, setPaymentMethod] = useState(visit?.payment_method ?? 'cash')
  const [amount, setAmount] = useState<number>(visit?.payment_amount ?? 0)
  const [paymentStatus, setPaymentStatus] = useState(visit?.payment_status ?? 'unpaid')

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listServicesFull(true).then(setServices).catch(() => {})
    listStaff(true).then(setStaff).catch(() => {})
  }, [])

  // Resolve the patient label when it wasn't embedded (edit, or create with ?patient_id).
  useEffect(() => {
    const id = (mode === 'edit' ? patientId : defaultPatientId) || ''
    if (!id || patientLabel) return
    getPatient(id).then(p => p && setPatientLabel(`${p.full_name} (${p.patient_code})`)).catch(() => {})
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePatientQuery = (val: string) => {
    setPatientQuery(val)
    if (patientTimer.current) clearTimeout(patientTimer.current)
    if (!val.trim()) { setPatientResults([]); setShowResults(false); return }
    patientTimer.current = setTimeout(async () => {
      try {
        const { rows } = await listPatientsPaged({ search: val, pageSize: 8, activeOnly: true })
        setPatientResults(rows); setShowResults(true)
      } catch { /* ignore */ }
    }, 300)
  }

  const pickPatient = (p: ClinicPatient) => {
    setPatientId(p.id)
    setPatientLabel(`${p.full_name} (${p.patient_code})`)
    setPatientQuery(''); setPatientResults([]); setShowResults(false)
  }

  const onServiceChange = (id: string) => {
    setServiceId(id)
    const svc = services.find(s => s.id === id)
    if (svc && (mode === 'create' || amount === 0)) setAmount(svc.price)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!patientId) { setError('Pasien wajib dipilih'); return }
    if (!serviceId) { setError('Layanan wajib dipilih'); return }
    if (!visitDate) { setError('Tanggal wajib diisi'); return }
    setSaving(true); setError('')

    const payload: VisitPayload = {
      patient_id: patientId,
      service_id: serviceId,
      visit_date: visitDate,
      visit_time: visitTime || null,
      status,
      chief_complaint: complaint.trim() || null,
      notes: notes.trim() || null,
      handled_by: handledBy.trim() || null,
      payment_method: paymentMethod || null,
      payment_amount: Number(amount) || 0,
      payment_status: paymentStatus,
      created_by: user?.email ?? null,
    }
    try {
      if (mode === 'edit' && visit) await updateVisit(visit.id, payload)
      else await addVisit(payload)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan kunjungan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>{mode === 'edit' ? 'Edit Kunjungan' : 'Tambah Kunjungan'}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        <form onSubmit={handleSubmit}>
          <div className="form-group" style={{ position: 'relative' }}>
            <label>Pasien *</label>
            {patientLabel && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 500 }}>{patientLabel}</span>
                <button type="button" className="action-btn" onClick={() => { setPatientId(''); setPatientLabel('') }}>Ganti</button>
              </div>
            )}
            {!patientLabel && (
              <>
                <input
                  type="text" placeholder="Cari nama / kode / telepon pasien..."
                  value={patientQuery} onChange={e => handlePatientQuery(e.target.value)}
                  onFocus={() => patientResults.length && setShowResults(true)}
                />
                {showResults && patientResults.length > 0 && (
                  <div style={{
                    position: 'absolute', zIndex: 10, left: 0, right: 0, top: '100%',
                    background: 'var(--bg-card, #fff)', border: '1px solid var(--border, #E5E7EB)',
                    borderRadius: 6, maxHeight: 220, overflowY: 'auto', boxShadow: '0 4px 12px rgba(0,0,0,.08)',
                  }}>
                    {patientResults.map(p => (
                      <div key={p.id} onClick={() => pickPatient(p)}
                        style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border, #F3F4F6)' }}>
                        <div style={{ fontWeight: 500 }}>{p.full_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{p.patient_code} · {p.phone}</div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <div className="form-group">
            <label>Layanan *</label>
            <select value={serviceId} onChange={e => onServiceChange(e.target.value)} required>
              <option value="">— Pilih Layanan —</option>
              {services.map(s => <option key={s.id} value={s.id}>{s.name} — {fmtRp(s.price)}</option>)}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Tanggal *</label>
              <input type="date" value={visitDate} onChange={e => setVisitDate(e.target.value)} required />
            </div>
            <div className="form-group">
              <label>Jam</label>
              <input type="time" value={visitTime} onChange={e => setVisitTime(e.target.value)} />
            </div>
          </div>

          <div className="form-group">
            <label>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)}>
              <option value="scheduled">Terjadwal</option>
              <option value="in_progress">Berlangsung</option>
              <option value="completed">Selesai</option>
              <option value="no_show">Tidak Hadir</option>
            </select>
          </div>

          <div className="form-group">
            <label>Keluhan Utama</label>
            <textarea value={complaint} onChange={e => setComplaint(e.target.value)} rows={2} />
          </div>
          <div className="form-group">
            <label>Catatan</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="form-group">
            <label>Ditangani oleh</label>
            <select value={handledBy} onChange={e => setHandledBy(e.target.value)}>
              <option value="">— Pilih Staff —</option>
              {staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Metode Pembayaran</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Jumlah (Rp)</label>
              <input type="number" min={0} value={amount} onChange={e => setAmount(Math.max(0, Number(e.target.value)))} />
            </div>
          </div>
          <div className="form-group">
            <label>Status Pembayaran</label>
            <select value={paymentStatus} onChange={e => setPaymentStatus(e.target.value)}>
              {PAYMENT_STATUSES.map(s => <option key={s} value={s}>{PAYMENT_STATUS_LABEL[s]}</option>)}
            </select>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>Batal</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Menyimpan...' : mode === 'edit' ? 'Simpan Perubahan' : 'Simpan Kunjungan'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return <div style={{ color: 'var(--text-muted)' }}>{children}</div>
}
function Val({ children }: { children: React.ReactNode }) {
  return <div style={{ fontWeight: 500 }}>{children}</div>
}
