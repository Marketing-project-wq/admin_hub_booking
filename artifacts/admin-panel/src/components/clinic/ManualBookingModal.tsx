import React, { useState, useEffect } from 'react'
import { fmtRp, fmtTime } from '../../lib/format'
import ClinicPatientForm, { type PatientFormValues } from '../../pages/clinic/ClinicPatientForm'
import {
  listServices, searchPatientByIdNumber, listPatients, createPatient,
  getAvailableSlots, createManualBooking, todayISO,
  type ClinicService, type ClinicPatient, type ClinicSlot,
} from '../../lib/clinic'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'transfer', label: 'Transfer' },
  { value: 'mayar', label: 'Mayar' },
  { value: 'free', label: 'Gratis' },
]

export default function ManualBookingModal({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')

  // Step 1 — patient
  const [patientQuery, setPatientQuery] = useState('')
  const [results, setResults] = useState<ClinicPatient[]>([])
  const [searching, setSearching] = useState(false)
  const [patient, setPatient] = useState<ClinicPatient | null>(null)
  const [registering, setRegistering] = useState(false)
  const [savingPatient, setSavingPatient] = useState(false)

  // Step 2 — booking
  const [services, setServices] = useState<ClinicService[]>([])
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState(todayISO)
  const [slots, setSlots] = useState<ClinicSlot[]>([])
  const [slotId, setSlotId] = useState('')
  const [manualTime, setManualTime] = useState('')
  const [notes, setNotes] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [price, setPrice] = useState(0)

  // Step 3 — submit
  const [submitting, setSubmitting] = useState(false)
  const [bookingCode, setBookingCode] = useState('')

  const service = services.find(s => s.id === serviceId)

  useEffect(() => {
    listServices()
      .then(data => { console.log('services in modal:', data); setServices(data) })
      .catch(err => { console.log('services in modal error:', err); setServices([]); setError('Gagal memuat layanan: ' + (err instanceof Error ? err.message : String(err))) })
  }, [])

  // Load available slots when date changes (step 2)
  useEffect(() => {
    if (step !== 2 || !date) return
    setSlotId(''); setManualTime('')
    getAvailableSlots(date).then(setSlots).catch(() => setSlots([]))
  }, [date, step])

  // Auto-fill price from service
  useEffect(() => {
    if (service) setPrice(Number(service.price) || 0)
  }, [service])

  const runSearch = async () => {
    if (!patientQuery.trim()) return
    setSearching(true); setError('')
    try {
      // Try exact ID match first, then fall back to a name/NIK/phone search.
      const exact = await searchPatientByIdNumber(patientQuery)
      setResults(exact ? [exact] : await listPatients(patientQuery))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pencarian gagal')
    } finally {
      setSearching(false)
    }
  }

  const handleRegister = async (values: PatientFormValues) => {
    setSavingPatient(true); setError('')
    try {
      const created = await createPatient(values)
      setPatient(created); setRegistering(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mendaftarkan pasien')
    } finally {
      setSavingPatient(false)
    }
  }

  const handleSubmit = async () => {
    if (!patient) return
    setSubmitting(true); setError('')
    try {
      const code = await createManualBooking({
        patient_id: patient.id,
        service_id: serviceId,
        full_name: patient.full_name,
        email: patient.email,
        phone: patient.phone,
        notes: notes.trim() || null,
        price,
        payment_method: paymentMethod,
        slot_id: slotId || null,
        manual_date: slotId ? undefined : date,
        manual_time: slotId ? undefined : manualTime,
      })
      setBookingCode(code)
      setStep(4) // success
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat booking')
    } finally {
      setSubmitting(false)
    }
  }

  const canNext2 = !!serviceId && (!!slotId || !!manualTime)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Tambah Booking Manual</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {step < 4 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 20, fontSize: 12 }}>
            {['Pasien', 'Detail Booking', 'Konfirmasi'].map((label, i) => (
              <span key={label} style={{
                padding: '4px 10px', borderRadius: 20,
                background: step === i + 1 ? 'var(--text-primary)' : '#f3f4f6',
                color: step === i + 1 ? '#fff' : 'var(--text-muted)', fontWeight: 600,
              }}>{i + 1}. {label}</span>
            ))}
          </div>
        )}

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        {/* ── Step 1: patient ──────────────────────────────────────────────── */}
        {step === 1 && (
          <div>
            {registering ? (
              <>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>Daftarkan pasien baru:</p>
                <ClinicPatientForm
                  initial={{ id_number: patientQuery }}
                  onSubmit={handleRegister}
                  onCancel={() => setRegistering(false)}
                  saving={savingPatient}
                  submitLabel="Daftarkan & Pilih"
                />
              </>
            ) : patient ? (
              <>
                <div className="card" style={{ borderLeft: '3px solid #059669' }}>
                  <div style={{ fontWeight: 700, fontSize: 15 }}>{patient.full_name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                    {patient.id_number} · {patient.phone}{patient.email ? ` · ${patient.email}` : ''}
                  </div>
                  <button
                    className="btn-secondary" style={{ marginTop: 12, fontSize: 12, padding: '5px 12px' }}
                    onClick={() => { setPatient(null); setResults([]) }}
                  >
                    Ganti Pasien
                  </button>
                </div>
                <div className="modal-footer">
                  <button className="btn-secondary" onClick={onClose}>Batal</button>
                  <button className="btn-primary" onClick={() => setStep(2)}>Lanjut →</button>
                </div>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label>Cari Pasien (nama atau NIK)</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      type="text" value={patientQuery}
                      onChange={e => setPatientQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runSearch())}
                      placeholder="Ketik nama atau nomor identitas..."
                    />
                    <button className="btn-primary" onClick={runSearch} disabled={searching}>
                      {searching ? '...' : 'Cari'}
                    </button>
                  </div>
                </div>

                {results.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {results.map(p => (
                      <button
                        key={p.id} onClick={() => setPatient(p)}
                        style={{
                          textAlign: 'left', background: '#fff', border: '1.5px solid var(--border)',
                          borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontWeight: 600 }}>{p.full_name}</div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.id_number} · {p.phone}</div>
                      </button>
                    ))}
                  </div>
                ) : patientQuery && !searching ? (
                  <div style={{ textAlign: 'center', padding: '16px 0' }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Pasien tidak ditemukan.</p>
                    <button className="btn-primary" onClick={() => setRegistering(true)}>Daftarkan Pasien Baru</button>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* ── Step 2: booking details ──────────────────────────────────────── */}
        {step === 2 && (
          <div>
            <div className="form-group">
              <label>Pilih Layanan *</label>
              <select value={serviceId} onChange={e => setServiceId(e.target.value)} required>
                <option value="">Pilih layanan...</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>{s.name} — {fmtRp(s.price)}</option>
                ))}
              </select>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Tanggal *</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Jam *</label>
                {slots.length > 0 ? (
                  <select value={slotId} onChange={e => setSlotId(e.target.value)}>
                    <option value="">Pilih slot...</option>
                    {slots.map(s => (
                      <option key={s.id} value={s.id}>
                        {fmtTime(s.start_time)} ({s.quota - s.booked_count} tersedia)
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="time" value={manualTime} onChange={e => setManualTime(e.target.value)}
                    title="Tidak ada slot — masukkan jam manual"
                  />
                )}
              </div>
            </div>
            {slots.length === 0 && (
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: -8 }}>
                Tidak ada slot untuk tanggal ini — jam diisi manual (slot baru akan dibuat).
              </p>
            )}

            <div className="form-group">
              <label>Catatan</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Metode Pembayaran</label>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Jumlah Bayar (Rp)</label>
                <input
                  type="number" min={0} value={paymentMethod === 'free' ? 0 : price}
                  disabled={paymentMethod === 'free'}
                  onChange={e => setPrice(Math.max(0, Number(e.target.value)))}
                />
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setStep(1)}>← Kembali</button>
              <button className="btn-primary" onClick={() => setStep(3)} disabled={!canNext2}>Lanjut →</button>
            </div>
          </div>
        )}

        {/* ── Step 3: confirmation ─────────────────────────────────────────── */}
        {step === 3 && patient && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 10, columnGap: 12, fontSize: 14 }}>
              <Field label="Pasien" value={`${patient.full_name} (${patient.id_number})`} />
              <Field label="Telepon" value={patient.phone} />
              <Field label="Layanan" value={service?.name || '-'} />
              <Field label="Tanggal" value={date} />
              <Field label="Jam" value={slotId ? fmtTime(slots.find(s => s.id === slotId)?.start_time || '') : (manualTime || '-')} />
              <Field label="Pembayaran" value={PAYMENT_METHODS.find(m => m.value === paymentMethod)?.label || paymentMethod} />
              <Field label="Jumlah" value={fmtRp(paymentMethod === 'free' ? 0 : price)} />
              <Field label="Status" value={<span className="badge badge-confirmed">Confirmed</span>} />
              {notes && <Field label="Catatan" value={notes} />}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setStep(2)}>← Kembali</button>
              <button className="btn-primary" onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Menyimpan...' : 'Buat Booking'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: success ──────────────────────────────────────────────── */}
        {step === 4 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h3 style={{ margin: '8px 0' }}>Booking berhasil dibuat</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Kode booking:</p>
            <p style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700 }}>{bookingCode}</p>
            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button className="btn-primary" onClick={onClose}>Selesai</button>
            </div>
          </div>
        )}
      </div>
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
