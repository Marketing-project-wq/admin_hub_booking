import React, { useState, useEffect } from 'react'
import { fmtRp } from '@workspace/admin-shared'
import ClinicPatientForm, { type PatientFormValues } from '../../pages/clinic/ClinicPatientForm'
import {
  listServices, searchPatientByIdNumber, listPatients, createPatient,
  createWalkInVisit, todayISO,
  type ClinicService, type ClinicPatient,
} from '../../lib/clinic'

interface Props {
  onClose: () => void
  onSuccess: () => void
}

export default function WalkInVisitModal({ onClose, onSuccess }: Props) {
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')

  // Step 1 — patient
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClinicPatient[]>([])
  const [searching, setSearching] = useState(false)
  const [patient, setPatient] = useState<ClinicPatient | null>(null)
  const [registering, setRegistering] = useState(false)
  const [savingPatient, setSavingPatient] = useState(false)

  // Step 2 — visit
  const [services, setServices] = useState<ClinicService[]>([])
  const [serviceId, setServiceId] = useState('')
  const [date, setDate] = useState(todayISO)
  const [time, setTime] = useState('')
  const [complaint, setComplaint] = useState('')
  const [handledBy, setHandledBy] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [visitCode, setVisitCode] = useState('')

  const service = services.find(s => s.id === serviceId)

  useEffect(() => {
    listServices().then(setServices).catch(err => setError('Gagal memuat layanan: ' + (err instanceof Error ? err.message : String(err))))
  }, [])

  const runSearch = async () => {
    if (!query.trim()) return
    setSearching(true); setError('')
    try {
      const exact = await searchPatientByIdNumber(query)
      setResults(exact ? [exact] : await listPatients(query))
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
    if (!patient || !serviceId) return
    setSubmitting(true); setError('')
    try {
      const visit = await createWalkInVisit({
        patient_id: patient.id,
        service_id: serviceId,
        visit_date: date,
        visit_time: time || null,
        chief_complaint: complaint.trim() || null,
        handled_by: handledBy.trim() || null,
        payment_amount: service ? Number(service.price) : null,
      })
      setVisitCode(visit.visit_code)
      setStep(3)
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat kunjungan')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 600 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Walk-in Baru</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        {/* Step 1 — patient */}
        {step === 1 && (
          registering ? (
            <>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0 }}>Daftarkan pasien baru:</p>
              <ClinicPatientForm
                initial={{ id_number: query }}
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
                  {patient.id_number} · {patient.phone}
                </div>
                <button className="btn-secondary" style={{ marginTop: 12, fontSize: 12, padding: '5px 12px' }}
                  onClick={() => { setPatient(null); setResults([]) }}>Ganti Pasien</button>
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
                  <input type="text" value={query} onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), runSearch())}
                    placeholder="Ketik nama atau nomor identitas..." />
                  <button className="btn-primary" onClick={runSearch} disabled={searching}>{searching ? '...' : 'Cari'}</button>
                </div>
              </div>
              {results.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {results.map(p => (
                    <button key={p.id} onClick={() => setPatient(p)}
                      style={{ textAlign: 'left', background: '#fff', border: '1.5px solid var(--border)', borderRadius: 8, padding: '10px 14px', cursor: 'pointer' }}>
                      <div style={{ fontWeight: 600 }}>{p.full_name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.id_number} · {p.phone}</div>
                    </button>
                  ))}
                </div>
              ) : query && !searching ? (
                <div style={{ textAlign: 'center', padding: '16px 0' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Pasien tidak ditemukan.</p>
                  <button className="btn-primary" onClick={() => setRegistering(true)}>Daftarkan Pasien Baru</button>
                </div>
              ) : null}
            </>
          )
        )}

        {/* Step 2 — visit details */}
        {step === 2 && (
          <div>
            <div className="form-group">
              <label>Pilih Layanan *</label>
              <select value={serviceId} onChange={e => setServiceId(e.target.value)} required>
                <option value="">Pilih layanan...</option>
                {services.map(s => <option key={s.id} value={s.id}>{s.name} — {fmtRp(s.price)}</option>)}
              </select>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Tanggal *</label>
                <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Jam</label>
                <input type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>
            <div className="form-group">
              <label>Ditangani oleh</label>
              <input type="text" value={handledBy} onChange={e => setHandledBy(e.target.value)} placeholder="Nama dokter / terapis" />
            </div>
            <div className="form-group">
              <label>Keluhan Utama</label>
              <textarea value={complaint} onChange={e => setComplaint(e.target.value)} rows={2} />
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setStep(1)}>← Kembali</button>
              <button className="btn-primary" onClick={handleSubmit} disabled={!serviceId || submitting}>
                {submitting ? 'Menyimpan...' : 'Buat Kunjungan'}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — success */}
        {step === 3 && (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <div style={{ fontSize: 40 }}>✅</div>
            <h3 style={{ margin: '8px 0' }}>Kunjungan dibuat</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Kode kunjungan:</p>
            <p style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700 }}>{visitCode}</p>
            <div className="modal-footer" style={{ justifyContent: 'center' }}>
              <button className="btn-primary" onClick={onClose}>Selesai</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
