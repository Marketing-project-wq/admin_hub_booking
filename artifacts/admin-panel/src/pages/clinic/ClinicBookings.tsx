import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fmtRp, fmtDate, fmtTime, fmtDateTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import ConfirmModal from '../../components/arena/ConfirmModal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  getBookings, getAllBookings, confirmBooking, cancelBooking, serviceName,
  todayISO, daysAgoISO, listServices, createManualVisit,
  type ClinicBooking, type BookingFilters, type ClinicService,
} from '../../lib/clinic'

const PAGE_SIZE = 20

export default function ClinicBookings() {
  const { user } = useAuth()
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

  const [services, setServices] = useState<ClinicService[]>([])
  const [toast, setToast] = useState('')

  // Manual visit modal (3-step)
  const [showManualModal, setShowManualModal] = useState(false)
  const [manualStep, setManualStep] = useState<1 | 2 | 3>(1)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<{ id: string; full_name: string; patient_code: string; phone: string }[]>([])
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; full_name: string; patient_code: string; phone: string } | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [manualServices, setManualServices] = useState<{ service_id: string; service_name: string; price: number }[]>([])
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10))
  const [manualTime, setManualTime] = useState('')
  const [manualComplaint, setManualComplaint] = useState('')

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

  useEffect(() => { listServices().then(setServices).catch(() => {}) }, [])

  // Auto-clear toast.
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  const searchPatients = async () => {
    if (!patientSearch.trim()) return
    setSearchLoading(true)
    try {
      const { data } = await supabase
        .from('clinic_patients')
        .select('id, full_name, patient_code, phone')
        .or(`full_name.ilike.%${patientSearch}%,phone.ilike.%${patientSearch}%,patient_code.ilike.%${patientSearch}%`)
        .eq('is_active', true)
        .limit(5)
      setPatientResults(data ?? [])
    } catch { /* ignore */ }
    finally { setSearchLoading(false) }
  }

  const handleManualSubmit = async () => {
    if (!selectedPatient || manualServices.length === 0) return
    setManualLoading(true)
    setManualError(null)
    try {
      const { visit_code } = await createManualVisit({
        patient_id: selectedPatient.id,
        visit_date: manualDate,
        visit_time: manualTime || null,
        chief_complaint: manualComplaint,
        services: manualServices,
        created_by: user?.full_name ?? 'Admin',
      })
      setManualStep(3)
      setToast(`Visit ${visit_code} berhasil dibuat`)
    } catch (e) {
      setManualError('Gagal membuat kunjungan. Coba lagi.')
    } finally {
      setManualLoading(false)
    }
  }

  const resetManualModal = () => {
    setManualStep(1)
    setPatientSearch('')
    setPatientResults([])
    setSelectedPatient(null)
    setManualServices([])
    setManualDate(new Date().toISOString().slice(0, 10))
    setManualTime('')
    setManualComplaint('')
    setManualError(null)
    setShowManualModal(false)
  }

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
          <button className="btn-primary" onClick={() => setShowManualModal(true)}>+ Tambah Booking Manual</button>
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

      {showManualModal && (
        <div className="modal-overlay" onClick={resetManualModal}>
          <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>

            {manualStep === 1 && (
              <div>
                <h3 style={{ color: '#F0F4FF', marginBottom: 16 }}>Step 1: Pilih Pasien</h3>

                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <input
                    value={patientSearch}
                    onChange={e => setPatientSearch(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && searchPatients()}
                    placeholder="Cari nama, HP, atau kode pasien..."
                    style={{ flex: 1, padding: '10px 12px', borderRadius: 8,
                      background: '#152034', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#F0F4FF', fontSize: 13 }}
                  />
                  <button onClick={searchPatients} disabled={searchLoading}
                    style={{ padding: '10px 16px', borderRadius: 8, background: '#C0392B',
                      color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    {searchLoading ? '...' : 'Cari'}
                  </button>
                </div>

                {patientResults.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                    {patientResults.map(p => (
                      <div key={p.id}
                        onClick={() => { setSelectedPatient(p); setPatientResults([]) }}
                        style={{
                          padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                          background: selectedPatient?.id === p.id ? 'rgba(192,57,43,0.15)' : '#243352',
                          border: `1px solid ${selectedPatient?.id === p.id ? '#C0392B' : 'rgba(255,255,255,0.08)'}`,
                        }}
                      >
                        <div style={{ color: '#F0F4FF', fontWeight: 600, fontSize: 13 }}>{p.full_name}</div>
                        <div style={{ color: '#A8B8D8', fontSize: 11 }}>{p.patient_code} · {p.phone}</div>
                      </div>
                    ))}
                  </div>
                )}

                {selectedPatient && (
                  <div style={{ padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)',
                    marginBottom: 16 }}>
                    <div style={{ color: '#F0F4FF', fontWeight: 600 }}>✓ {selectedPatient.full_name}</div>
                    <div style={{ color: '#A8B8D8', fontSize: 12 }}>{selectedPatient.patient_code} · {selectedPatient.phone}</div>
                  </div>
                )}

                <button
                  onClick={() => setManualStep(2)}
                  disabled={!selectedPatient}
                  style={{ width: '100%', padding: 12, borderRadius: 8,
                    background: selectedPatient ? '#C0392B' : '#243352',
                    color: selectedPatient ? '#fff' : '#6B7A99',
                    border: 'none', cursor: selectedPatient ? 'pointer' : 'not-allowed',
                    fontWeight: 600, fontSize: 14 }}
                >
                  Lanjut →
                </button>
              </div>
            )}

            {manualStep === 2 && (
              <div>
                <h3 style={{ color: '#F0F4FF', marginBottom: 16 }}>Step 2: Layanan & Detail</h3>

                {/* Pasien terpilih */}
                <div style={{ padding: '8px 12px', borderRadius: 8, background: '#243352',
                  marginBottom: 16, fontSize: 12, color: '#A8B8D8' }}>
                  Pasien: <strong style={{ color: '#F0F4FF' }}>{selectedPatient?.full_name}</strong>
                </div>

                {/* Pilih Layanan */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, color: '#A8B8D8', textTransform: 'uppercase',
                    letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                    Pilih Layanan *
                  </label>
                  <select
                    onChange={e => {
                      const svc = services.find(s => s.id === e.target.value)
                      if (svc && !manualServices.some(ms => ms.service_id === svc.id)) {
                        setManualServices(prev => [...prev, {
                          service_id: svc.id, service_name: svc.name, price: svc.price
                        }])
                      }
                      e.target.value = ''
                    }}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                      background: '#152034', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#F0F4FF', fontSize: 13 }}
                  >
                    <option value="">— Pilih layanan —</option>
                    {services.filter(s => !manualServices.some(ms => ms.service_id === s.id)).map(s => (
                      <option key={s.id} value={s.id}>{s.name} — Rp {s.price.toLocaleString('id-ID')}</option>
                    ))}
                  </select>

                  {manualServices.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {manualServices.map(s => (
                        <span key={s.service_id} style={{
                          padding: '4px 10px', borderRadius: 999,
                          background: '#243352', border: '1px solid rgba(255,255,255,0.1)',
                          color: '#F0F4FF', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6
                        }}>
                          {s.service_name}
                          <button onClick={() => setManualServices(prev => prev.filter(ms => ms.service_id !== s.service_id))}
                            style={{ background: 'none', border: 'none', color: '#FC8181', cursor: 'pointer',
                              padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tanggal & Jam */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                  <div>
                    <label style={{ fontSize: 11, color: '#A8B8D8', textTransform: 'uppercase',
                      letterSpacing: 1, display: 'block', marginBottom: 6 }}>Tanggal *</label>
                    <input type="date" value={manualDate}
                      onChange={e => setManualDate(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                        background: '#152034', border: '1px solid rgba(255,255,255,0.12)',
                        color: '#F0F4FF', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: '#A8B8D8', textTransform: 'uppercase',
                      letterSpacing: 1, display: 'block', marginBottom: 6 }}>Jam</label>
                    <input type="time" value={manualTime}
                      onChange={e => setManualTime(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                        background: '#152034', border: '1px solid rgba(255,255,255,0.12)',
                        color: '#F0F4FF', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                </div>

                {/* Keluhan */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: '#A8B8D8', textTransform: 'uppercase',
                    letterSpacing: 1, display: 'block', marginBottom: 6 }}>Keluhan Utama</label>
                  <textarea value={manualComplaint}
                    onChange={e => setManualComplaint(e.target.value)}
                    rows={3}
                    placeholder="Deskripsikan keluhan pasien..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                      background: '#152034', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#F0F4FF', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                </div>

                {manualError && (
                  <div style={{ color: '#FC8181', fontSize: 13, marginBottom: 12 }}>{manualError}</div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setManualStep(1)}
                    style={{ flex: 1, padding: 12, borderRadius: 8,
                      background: '#243352', border: '1px solid rgba(255,255,255,0.1)',
                      color: '#A8B8D8', cursor: 'pointer', fontWeight: 600 }}>
                    ← Kembali
                  </button>
                  <button
                    onClick={handleManualSubmit}
                    disabled={manualServices.length === 0 || manualLoading}
                    style={{ flex: 2, padding: 12, borderRadius: 8,
                      background: manualServices.length > 0 ? '#C0392B' : '#243352',
                      color: manualServices.length > 0 ? '#fff' : '#6B7A99',
                      border: 'none', cursor: manualServices.length > 0 ? 'pointer' : 'not-allowed',
                      fontWeight: 600, fontSize: 14 }}>
                    {manualLoading ? 'Menyimpan...' : 'Buat Kunjungan →'}
                  </button>
                </div>
              </div>
            )}

            {manualStep === 3 && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <div style={{ fontSize: 48, marginBottom: 12 }}>✅</div>
                <h3 style={{ color: '#F0F4FF', marginBottom: 8 }}>Kunjungan Berhasil Dibuat!</h3>
                <p style={{ color: '#A8B8D8', fontSize: 13, marginBottom: 8 }}>
                  Pasien: <strong style={{ color: '#F0F4FF' }}>{selectedPatient?.full_name}</strong>
                </p>
                <p style={{ color: '#A8B8D8', fontSize: 13, marginBottom: 24 }}>
                  Layanan: {manualServices.map(s => s.service_name).join(', ')}
                </p>
                <p style={{ color: '#6B7A99', fontSize: 12, marginBottom: 24 }}>
                  Kunjungan sudah masuk ke menu Visits dan Triase.
                </p>
                <button onClick={resetManualModal}
                  style={{ padding: '12px 32px', borderRadius: 8, background: '#C0392B',
                    color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                  Selesai
                </button>
              </div>
            )}

          </div>
        </div>
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

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1100,
          background: '#080808', color: '#fff', padding: '12px 20px', borderRadius: 10,
          fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,.2)',
        }}>{toast}</div>
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
