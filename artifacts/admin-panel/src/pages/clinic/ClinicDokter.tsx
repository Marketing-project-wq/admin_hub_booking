import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtTime, fmtDateTime } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { lockRecord, listPatientPackages, scheduleFollowUpVisit, type ClinicPatientPackage } from '../../lib/clinic'
import LockBadge from '../../components/clinic/LockBadge'

interface DokterVisit {
  id: string
  visit_code: string
  visit_date: string
  visit_time: string | null
  status: string
  chief_complaint: string | null
  handled_by: string | null
  patient_package_id: string | null
  patient: {
    id: string
    full_name: string
    patient_code: string
    phone: string
    date_of_birth: string | null
    gender: string | null
  } | null
  services: { id: string; service_id: string; service_name: string; price: number }[]
}

interface PatientHistory {
  id: string
  patient_code: string
  full_name: string
  phone: string
  date_of_birth: string | null
  gender: string | null
}

interface AssessmentForm {
  subjective: string
  objective: string
  assessment: string
  plan: string
  diagnosis: string
  follow_up_date: string
  notes: string
  handled_by: string
}

interface ClinicScreeningData {
  id: string
  selected_services: string[]
  chief_complaint: string | null
  vital_signs: {
    blood_pressure?: string
    heart_rate?: number
    temperature?: number
    spo2?: number
    respiratory_rate?: number
    weight?: number
    height?: number
  }
  par_q: Record<string, boolean>
  msk_location: string[]
  msk_character: string[]
  msk_timing: string[]
  msk_intensity: number | null
  msk_function: string[]
  msk_additional: string[]
  msk_history: string[]
  health_cardiovascular: string[]
  health_metabolic: string[]
  health_respiratory: string[]
  health_musculoskeletal: string[]
  health_special: string[]
  health_female: string[]
  health_medications: string | null
  health_allergies: string[]
  health_surgeries: string | null
  physical_activity_level: string | null
  physical_activity_type: string | null
  created_at: string
  updated_at: string
}

interface ClinicConsentData {
  id: string
  consent_type: string
  is_agreed: boolean
  signature_data: string | null
  signed_at: string | null
  signed_by_name: string | null
}

async function fetchScreening(visitId: string): Promise<ClinicScreeningData | null> {
  const { data } = await supabase
    .from('clinic_screenings')
    .select('*')
    .eq('visit_id', visitId)
    .maybeSingle()
  return data as ClinicScreeningData | null
}

async function fetchConsents(visitId: string): Promise<ClinicConsentData[]> {
  const { data } = await supabase
    .from('clinic_consents')
    .select('*')
    .eq('visit_id', visitId)
    .order('created_at')
  return (data ?? []) as ClinicConsentData[]
}

interface AssessmentRecord {
  form: AssessmentForm
  id: string
  isLocked: boolean
  lockedAt: string | null
  lockedBy: string | null
}

async function fetchAssessment(visitId: string): Promise<AssessmentRecord | null> {
  const { data } = await supabase
    .from('clinic_assessments')
    .select('*')
    .eq('visit_id', visitId)
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    isLocked: !!data.is_locked,
    lockedAt: data.locked_at ?? null,
    lockedBy: data.locked_by ?? null,
    form: {
      subjective: data.subjective ?? '',
      objective: data.objective ?? '',
      assessment: data.assessment ?? '',
      plan: data.plan ?? '',
      diagnosis: data.diagnosis ?? '',
      follow_up_date: data.follow_up_date ?? '',
      notes: data.notes ?? '',
      handled_by: data.handled_by ?? '',
    },
  }
}

async function saveAssessment(visitId: string, patientId: string, form: AssessmentForm): Promise<string> {
  const { data, error } = await supabase
    .from('clinic_assessments')
    .upsert({
      visit_id: visitId,
      patient_id: patientId,
      ...form,
      follow_up_date: form.follow_up_date || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'visit_id' })
    .select('id')
    .single()
  if (error) throw error

  // Update visit status ke completed setelah assessment disimpan
  await supabase
    .from('clinic_visits')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', visitId)

  return (data as { id: string }).id
}

const VISIT_SELECT = `
  id, visit_code, visit_date, visit_time, status, chief_complaint, handled_by, patient_package_id,
  patient:clinic_patients(id, full_name, patient_code, phone, date_of_birth, gender),
  services:clinic_visit_services(id, service_id, service_name, price)
`

// Fetch visits hari ini
async function fetchTodayVisits(): Promise<DokterVisit[]> {
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await supabase
    .from('clinic_visits')
    .select(VISIT_SELECT)
    .eq('visit_date', today)
    .order('visit_time', { ascending: true, nullsFirst: false })
  if (error) throw error
  return (data ?? []) as unknown as DokterVisit[]
}

// Update status visit
async function updateVisitStatus(id: string, status: string): Promise<void> {
  const { error } = await supabase
    .from('clinic_visits')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

// Search pasien
async function searchPatients(query: string): Promise<PatientHistory[]> {
  const { data, error } = await supabase
    .from('clinic_patients')
    .select('id, patient_code, full_name, phone, date_of_birth, gender')
    .or(`full_name.ilike.%${query}%,patient_code.ilike.%${query}%,phone.ilike.%${query}%`)
    .eq('is_active', true)
    .order('full_name')
    .limit(20)
  if (error) throw error
  return (data ?? []) as unknown as PatientHistory[]
}

// Fetch riwayat visit pasien
async function fetchPatientVisitHistory(patientId: string): Promise<DokterVisit[]> {
  const { data, error } = await supabase
    .from('clinic_visits')
    .select(VISIT_SELECT)
    .eq('patient_id', patientId)
    .order('visit_date', { ascending: false })
    .order('visit_time', { ascending: false })
  if (error) throw error
  return (data ?? []) as unknown as DokterVisit[]
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const STATUS_META: Record<string, { label: string; css?: string; style?: React.CSSProperties }> = {
  scheduled:   { label: 'Terjadwal', css: 'badge-pending' },
  in_progress: { label: 'Berlangsung', style: { background: '#EFF6FF', color: '#1D4ED8' } },
  completed:   { label: 'Selesai', css: 'badge-confirmed' },
  cancelled:   { label: 'Dibatalkan', css: 'badge-cancelled' },
  no_show:     { label: 'Tidak Hadir', style: { background: '#F3F4F6', color: '#6B7280' } },
}
function StatusBadge({ status }: { status: string }) {
  const m = STATUS_META[status] || { label: status }
  return <span className={`badge ${m.css ?? ''}`} style={m.style}>{m.label}</span>
}

function ageFromDob(dob: string | null): string {
  if (!dob) return '-'
  const d = new Date(dob)
  if (isNaN(d.getTime())) return '-'
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const mo = now.getMonth() - d.getMonth()
  if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) age--
  return `${age} th`
}

const TABS = ['jadwal', 'antrian', 'riwayat'] as const
type Tab = typeof TABS[number]
const TAB_LABEL: Record<Tab, string> = { jadwal: 'Jadwal Hari Ini', antrian: 'Antrian Aktif', riwayat: 'Riwayat Pasien' }

// ─── Visit card ─────────────────────────────────────────────────────────────────
function VisitCard({ visit, queue = false, onStatusChange, onOpen, busy }: {
  visit: DokterVisit
  queue?: boolean
  onStatusChange: (id: string, status: string) => void
  onOpen: (visit: DokterVisit) => void
  busy: boolean
}) {
  const s = visit.status
  const leftColor = s === 'in_progress' ? '#1D4ED8' : s === 'scheduled' ? '#F59E0B' : s === 'completed' ? '#10B981' : 'transparent'
  const cardStyle: React.CSSProperties = {
    display: 'flex', gap: 14, alignItems: 'center',
    background: queue && s === 'in_progress' ? '#FFF5F5' : '#fff',
    border: '1px solid #E5E7EB',
    borderLeft: `4px solid ${queue && s === 'in_progress' ? '#C0392B' : leftColor}`,
    borderRadius: 12, padding: 16, marginBottom: 8,
    opacity: s === 'completed' ? 0.8 : 1,
  }
  const timeBox: React.CSSProperties = {
    minWidth: 64, textAlign: 'center', padding: '8px 6px', borderRadius: 8, fontWeight: 700, fontSize: 14,
    background: s === 'in_progress' ? '#FEE2E2' : '#F3F4F6',
    color: s === 'in_progress' ? '#C0392B' : '#374151',
  }

  return (
    <div style={cardStyle}>
      <div style={timeBox}>{visit.visit_time ? fmtTime(visit.visit_time) : '—'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>{visit.patient?.full_name || '-'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{visit.patient?.patient_code || '-'}</div>
        <div style={{ fontSize: 13, marginTop: 2 }}>{visit.services.map(s => s.service_name).join(', ') || '-'}</div>
        {visit.patient_package_id && (
          <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 999, background: '#DBEAFE', color: '#1D4ED8' }}>📦 Paket</span>
        )}
        {visit.chief_complaint && (
          <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {visit.chief_complaint}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8, flexShrink: 0 }}>
        <StatusBadge status={s} />
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {s === 'scheduled' && (
            <button className="btn-primary" style={{ width: 'auto', padding: '6px 14px' }} disabled={busy} onClick={() => onStatusChange(visit.id, 'in_progress')}>Mulai</button>
          )}
          {s === 'in_progress' && (
            <>
              <button className="btn-primary" style={{ width: 'auto', padding: '6px 14px', background: '#1D4ED8' }} onClick={() => onOpen(visit)}>Buka Assessment</button>
              <button className="btn-primary" style={{ width: 'auto', padding: '6px 12px', background: '#10B981' }} disabled={busy} onClick={() => onStatusChange(visit.id, 'completed')}>Selesai</button>
            </>
          )}
          {s === 'completed' && (
            <button className="btn-secondary" style={{ width: 'auto', padding: '6px 14px' }} onClick={() => onOpen(visit)}>Lihat</button>
          )}
        </div>
      </div>
    </div>
  )
}

const EmptyState = ({ children }: { children: React.ReactNode }) => (
  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', background: '#fff', border: '1px dashed #E5E7EB', borderRadius: 12 }}>{children}</div>
)

const SCREENING_SECTION_TITLE: React.CSSProperties = { fontWeight: 700, fontSize: 12, color: '#374151', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }

// Baris chips read-only untuk satu kategori. Tidak merender apa pun jika items kosong.
function ChipRow({ label, items, tone = 'gray' }: { label: string; items: string[]; tone?: 'gray' | 'red' }) {
  if (!items || items.length === 0) return null
  const chip: React.CSSProperties = tone === 'red'
    ? { padding: '2px 8px', background: '#FEE2E2', color: '#C0392B', borderRadius: 999, fontSize: 11 }
    : { padding: '2px 8px', background: '#F3F4F6', color: '#374151', borderRadius: 999, fontSize: 11 }
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 12, color: '#6B7280', marginBottom: 4 }}>{label}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {items.map((it, i) => <span key={`${it}-${i}`} style={chip}>{it}</span>)}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
export default function ClinicDokter() {
  const { user } = useAuth()
  const [tab, setTab] = useState<Tab>('jadwal')

  const [todayVisits, setTodayVisits] = useState<DokterVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Visit detail modal
  const [selectedVisit, setSelectedVisit] = useState<DokterVisit | null>(null)
  const [showVisitModal, setShowVisitModal] = useState(false)
  const [modalTab, setModalTab] = useState<'screening' | 'consent' | 'assessment'>('screening')
  const [screeningData, setScreeningData] = useState<ClinicScreeningData | null>(null)
  const [loadingScreening, setLoadingScreening] = useState(false)
  const [consentData, setConsentData] = useState<ClinicConsentData[]>([])
  const [loadingConsent, setLoadingConsent] = useState(false)
  const [assessment, setAssessment] = useState<AssessmentForm>({
    subjective: '', objective: '', assessment: '', plan: '', diagnosis: '', follow_up_date: '', notes: '', handled_by: '',
  })
  const [loadingAssessment, setLoadingAssessment] = useState(false)
  const [savingAssessment, setSavingAssessment] = useState(false)
  const [assessmentError, setAssessmentError] = useState('')
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [assessmentLocked, setAssessmentLocked] = useState(false)
  const [assessmentLockedAt, setAssessmentLockedAt] = useState<string | null>(null)
  const [assessmentLockedBy, setAssessmentLockedBy] = useState<string | null>(null)

  // Follow-up scheduling + paket pasien
  const [patientPackages, setPatientPackages] = useState<ClinicPatientPackage[]>([])
  const [showFollowUpModal, setShowFollowUpModal] = useState(false)
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpNotes, setFollowUpNotes] = useState('')
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null)
  const [savingFollowUp, setSavingFollowUp] = useState(false)
  const [followUpResult, setFollowUpResult] = useState<string | null>(null)

  // Auto-clear toast follow-up.
  useEffect(() => {
    if (!followUpResult) return
    const t = window.setTimeout(() => setFollowUpResult(null), 4000)
    return () => window.clearTimeout(t)
  }, [followUpResult])

  const loadToday = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    try {
      setTodayVisits(await fetchTodayVisits())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat jadwal')
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [])

  useEffect(() => { loadToday() }, [loadToday])

  // Auto-refresh setiap 30 detik untuk tab Jadwal & Antrian.
  useEffect(() => {
    if (tab !== 'jadwal' && tab !== 'antrian') return
    const t = window.setInterval(() => loadToday(false), 30000)
    return () => window.clearInterval(t)
  }, [tab, loadToday])

  const handleStatusChange = async (id: string, status: string) => {
    setBusy(true)
    try {
      await updateVisitStatus(id, status)
      await loadToday(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memperbarui status')
    } finally {
      setBusy(false)
    }
  }

  const openVisitModal = async (visit: DokterVisit) => {
    setSelectedVisit(visit)
    setModalTab('screening')
    setShowVisitModal(true)
    setScreeningData(null)
    setConsentData([])
    setAssessmentError('')

    // Reset state follow-up untuk kunjungan baru.
    setShowFollowUpModal(false)
    setFollowUpDate('')
    setFollowUpNotes('')
    setSelectedPackageId(null)
    setPatientPackages([])

    setLoadingScreening(true)
    setLoadingConsent(true)
    setLoadingAssessment(true)
    try {
      const [screening, consents, existingAssessment, packages] = await Promise.all([
        fetchScreening(visit.id),
        fetchConsents(visit.id),
        fetchAssessment(visit.id),
        listPatientPackages(visit.patient?.id ?? ''),
      ])
      setScreeningData(screening)
      setConsentData(consents)
      setPatientPackages(packages)
      if (existingAssessment) {
        setAssessment(existingAssessment.form)
        setAssessmentId(existingAssessment.id)
        setAssessmentLocked(existingAssessment.isLocked)
        setAssessmentLockedAt(existingAssessment.lockedAt)
        setAssessmentLockedBy(existingAssessment.lockedBy)
      } else {
        setAssessment({
          subjective: '', objective: '', assessment: '', plan: '', diagnosis: '', follow_up_date: '', notes: '',
          handled_by: user?.full_name ?? '',
        })
        setAssessmentId(null)
        setAssessmentLocked(false)
        setAssessmentLockedAt(null)
        setAssessmentLockedBy(null)
      }
    } catch (e) {
      setAssessmentError(e instanceof Error ? e.message : 'Gagal memuat data kunjungan')
    } finally {
      setLoadingScreening(false)
      setLoadingConsent(false)
      setLoadingAssessment(false)
    }
  }

  const handleSaveAssessment = async (): Promise<boolean> => {
    if (!selectedVisit?.id || !selectedVisit?.patient?.full_name) return false
    setSavingAssessment(true)
    setAssessmentError('')
    try {
      const { data: visitData } = await supabase
        .from('clinic_visits')
        .select('patient_id')
        .eq('id', selectedVisit.id)
        .single()
      const patientId = (visitData as { patient_id: string } | null)?.patient_id
      if (!patientId) throw new Error('Data pasien tidak ditemukan')
      const savedId = await saveAssessment(selectedVisit.id, patientId, assessment)
      if (user) await lockRecord('clinic_assessments', savedId, user.full_name)
      setAssessmentId(savedId)
      setAssessmentLocked(true)
      setAssessmentLockedAt(new Date().toISOString())
      setAssessmentLockedBy(user?.full_name ?? null)
      await loadToday(false)
      return true
    } catch (e) {
      setAssessmentError(e instanceof Error ? e.message : 'Gagal menyimpan assessment')
      return false
    } finally {
      setSavingAssessment(false)
    }
  }

  // Simpan SOAP lalu buka modal penjadwalan kunjungan berikutnya.
  const handleSaveAndSchedule = async () => {
    const ok = await handleSaveAssessment()
    if (ok) {
      setFollowUpDate('')
      setFollowUpNotes('')
      setSelectedPackageId(null)
      setShowFollowUpModal(true)
    }
  }

  const handleScheduleFollowUp = async () => {
    if (!selectedVisit || !followUpDate) return
    setSavingFollowUp(true)
    try {
      const services = selectedVisit.services?.map(s => ({
        service_id: s.service_id,
        service_name: s.service_name,
        price: s.price,
      })) ?? []

      const result = await scheduleFollowUpVisit({
        patient_id: selectedVisit.patient?.id ?? '',
        follow_up_date: followUpDate,
        follow_up_notes: followUpNotes || null,
        patient_package_id: selectedPackageId,
        services,
      })

      setFollowUpResult(result.visit_code)
      setShowFollowUpModal(false)
      setShowVisitModal(false)
      await loadToday(false)
    } catch (e) {
      setAssessmentError(e instanceof Error ? e.message : 'Gagal menjadwalkan kunjungan berikutnya')
    } finally {
      setSavingFollowUp(false)
    }
  }

  const counts = {
    total: todayVisits.length,
    waiting: todayVisits.filter(v => v.status === 'scheduled').length,
    progress: todayVisits.filter(v => v.status === 'in_progress').length,
    done: todayVisits.filter(v => v.status === 'completed').length,
  }
  const queue = todayVisits.filter(v => v.status === 'in_progress' || v.status === 'scheduled')

  const callNext = async () => {
    const next = todayVisits.find(v => v.status === 'scheduled')
    if (!next) return
    await handleStatusChange(next.id, 'in_progress')
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Panel Dokter</h2>
        {user?.full_name && (
          <span className="badge" style={{ background: '#EFF6FF', color: '#1D4ED8' }}>{user.full_name}</span>
        )}
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '2px solid #E5E7EB', marginBottom: 20 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{
              padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
              fontWeight: tab === t ? 700 : 500, fontSize: 14,
              color: tab === t ? '#C0392B' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid #C0392B' : '2px solid transparent',
              marginBottom: -2,
            }}>{TAB_LABEL[t]}</button>
        ))}
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* TAB 1 — Jadwal */}
      {tab === 'jadwal' && (
        <div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Total: {counts.total} | Menunggu: {counts.waiting} | Berlangsung: {counts.progress} | Selesai: {counts.done}
          </div>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Memuat data...</p>
          ) : todayVisits.length === 0 ? (
            <EmptyState>Tidak ada jadwal hari ini</EmptyState>
          ) : todayVisits.map(v => (
            <VisitCard key={v.id} visit={v} onStatusChange={handleStatusChange} onOpen={openVisitModal} busy={busy} />
          ))}
        </div>
      )}

      {/* TAB 2 — Antrian Aktif */}
      {tab === 'antrian' && (
        <div>
          <button className="btn-primary" style={{ marginBottom: 16 }} disabled={busy || counts.waiting === 0} onClick={callNext}>
            Panggil Berikutnya
          </button>
          {loading ? (
            <p style={{ color: 'var(--text-muted)' }}>Memuat data...</p>
          ) : queue.length === 0 ? (
            <EmptyState>Antrian kosong</EmptyState>
          ) : queue.map(v => (
            <VisitCard key={v.id} visit={v} queue onStatusChange={handleStatusChange} onOpen={openVisitModal} busy={busy} />
          ))}
        </div>
      )}

      {/* TAB 3 — Riwayat Pasien */}
      {tab === 'riwayat' && <RiwayatTab onOpenVisit={openVisitModal} />}

      {showVisitModal && selectedVisit && (
        <div className="modal-overlay" onClick={() => setShowVisitModal(false)}>
          <div
            className="modal-box"
            style={{ maxWidth: 680, width: '95vw', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div style={{ background: '#080808', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ color: '#aaa', fontSize: 11, letterSpacing: 1 }}>KUNJUNGAN</div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                  {selectedVisit.patient?.full_name} · {selectedVisit.patient?.patient_code}
                </div>
                <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
                  {selectedVisit.services.map(s => s.service_name).join(' · ') || '-'} · {fmtTime(selectedVisit.visit_time ?? '')}
                </div>
              </div>
              <button onClick={() => setShowVisitModal(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            {/* Tab Bar */}
            <div style={{ display: 'flex', borderBottom: '2px solid #E5E7EB', background: '#fff', flexShrink: 0 }}>
              {(['screening', 'consent', 'assessment'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setModalTab(t)}
                  style={{
                    padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
                    fontWeight: modalTab === t ? 700 : 400,
                    color: modalTab === t ? '#C0392B' : '#6B7280',
                    borderBottom: modalTab === t ? '2px solid #C0392B' : '2px solid transparent',
                    marginBottom: -2, textTransform: 'capitalize',
                  }}
                >
                  {t === 'screening' ? 'Screening' : t === 'consent' ? 'Consent' : 'Assessment'}
                </button>
              ))}
            </div>

            {/* Tab Content - scrollable */}
            <div style={{ flex: 1, overflow: 'auto', padding: '20px' }}>

              {/* TAB SCREENING - read only */}
              {modalTab === 'screening' && (
                loadingScreening ? <p style={{ color: '#9CA3AF', textAlign: 'center', padding: 40 }}>Memuat data screening...</p>
                : !screeningData ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                    <p style={{ color: '#9CA3AF' }}>Screening belum diisi</p>
                    <p style={{ color: '#9CA3AF', fontSize: 12 }}>Admin/registrasi perlu mengisi screening terlebih dahulu</p>
                  </div>
                ) : (
                  <div>
                    {/* Vital Signs */}
                    {screeningData.vital_signs && Object.values(screeningData.vital_signs).some(v => v) && (
                      <div style={{ marginBottom: 16, padding: 16, background: '#F0FFF4', borderRadius: 10, border: '1px solid #6EE7B7' }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: '#065F46', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 1 }}>Vital Signs</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
                          {screeningData.vital_signs.blood_pressure && <div><span style={{ fontSize: 11, color: '#6B7280' }}>Tekanan Darah</span><div style={{ fontWeight: 600 }}>{screeningData.vital_signs.blood_pressure} mmHg</div></div>}
                          {screeningData.vital_signs.heart_rate && <div><span style={{ fontSize: 11, color: '#6B7280' }}>Heart Rate</span><div style={{ fontWeight: 600 }}>{screeningData.vital_signs.heart_rate} bpm</div></div>}
                          {screeningData.vital_signs.temperature && <div><span style={{ fontSize: 11, color: '#6B7280' }}>Suhu</span><div style={{ fontWeight: 600 }}>{screeningData.vital_signs.temperature} °C</div></div>}
                          {screeningData.vital_signs.spo2 && <div><span style={{ fontSize: 11, color: '#6B7280' }}>SpO2</span><div style={{ fontWeight: 600 }}>{screeningData.vital_signs.spo2}%</div></div>}
                          {screeningData.vital_signs.respiratory_rate && <div><span style={{ fontSize: 11, color: '#6B7280' }}>Resp. Rate</span><div style={{ fontWeight: 600 }}>{screeningData.vital_signs.respiratory_rate} x/mnt</div></div>}
                          {screeningData.vital_signs.weight && <div><span style={{ fontSize: 11, color: '#6B7280' }}>Berat Badan</span><div style={{ fontWeight: 600 }}>{screeningData.vital_signs.weight} kg</div></div>}
                          {screeningData.vital_signs.height && <div><span style={{ fontSize: 11, color: '#6B7280' }}>Tinggi Badan</span><div style={{ fontWeight: 600 }}>{screeningData.vital_signs.height} cm</div></div>}
                        </div>
                      </div>
                    )}

                    {/* Chief Complaint */}
                    {screeningData.chief_complaint && (
                      <div style={{ marginBottom: 12, padding: 12, background: '#FFF5F5', borderRadius: 8, borderLeft: '3px solid #C0392B' }}>
                        <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', marginBottom: 4 }}>Keluhan Utama</div>
                        <div style={{ fontSize: 14, color: '#111' }}>{screeningData.chief_complaint}</div>
                      </div>
                    )}

                    {/* PAR-Q */}
                    {Object.keys(screeningData.par_q).length > 0 && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontWeight: 700, fontSize: 12, color: '#374151', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>PAR-Q</div>
                        {Object.entries(screeningData.par_q).map(([q, val]) => (
                          <div key={q} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #F3F4F6', fontSize: 13 }}>
                            <span style={{ color: '#374151' }}>{q}</span>
                            <span style={{ fontWeight: 700, color: val ? '#C0392B' : '#065F46' }}>{val ? 'Ya' : 'Tidak'}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* MSK */}
                    {(screeningData.msk_location.length > 0 || screeningData.msk_character.length > 0 ||
                      screeningData.msk_timing.length > 0 || screeningData.msk_intensity !== null ||
                      screeningData.msk_function.length > 0 || screeningData.msk_additional.length > 0 ||
                      screeningData.msk_history.length > 0) && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={SCREENING_SECTION_TITLE}>MSK Screening</div>
                        <ChipRow label="Lokasi Nyeri" items={screeningData.msk_location} tone="red" />
                        <ChipRow label="Karakter Nyeri" items={screeningData.msk_character} />
                        <ChipRow label="Waktu Timbul" items={screeningData.msk_timing} />
                        {screeningData.msk_intensity !== null && (
                          <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>
                            Intensitas Nyeri: <strong style={{ color: screeningData.msk_intensity >= 7 ? '#C0392B' : screeningData.msk_intensity >= 4 ? '#F59E0B' : '#065F46' }}>{screeningData.msk_intensity}/10</strong>
                          </div>
                        )}
                        <ChipRow label="Fungsi & Mobilitas" items={screeningData.msk_function} />
                        <ChipRow label="Gejala Tambahan" items={screeningData.msk_additional} />
                        <ChipRow label="Riwayat Treatment" items={screeningData.msk_history} />
                      </div>
                    )}

                    {/* Riwayat Kesehatan */}
                    {(screeningData.health_cardiovascular.length > 0 || screeningData.health_metabolic.length > 0 ||
                      screeningData.health_respiratory.length > 0 || screeningData.health_musculoskeletal.length > 0 ||
                      screeningData.health_special.length > 0 || !!screeningData.health_medications ||
                      screeningData.health_allergies.length > 0) && (
                      <div style={{ marginBottom: 12 }}>
                        <div style={SCREENING_SECTION_TITLE}>Riwayat Kesehatan</div>
                        <ChipRow label="Kardiovaskular" items={screeningData.health_cardiovascular} />
                        <ChipRow label="Metabolik" items={screeningData.health_metabolic} />
                        <ChipRow label="Respirasi" items={screeningData.health_respiratory} />
                        <ChipRow label="Muskuloskeletal" items={screeningData.health_musculoskeletal} />
                        <ChipRow label="Kondisi Khusus" items={screeningData.health_special} />
                        <ChipRow label="Obat-obatan" items={screeningData.health_medications ? [screeningData.health_medications] : []} />
                        <ChipRow label="Alergi" items={screeningData.health_allergies} />
                      </div>
                    )}

                    <div style={{ fontSize: 11, color: '#9CA3AF', textAlign: 'right' }}>
                      Diisi: {fmtDateTime(screeningData.updated_at)}
                    </div>
                  </div>
                )
              )}

              {/* TAB CONSENT - read only */}
              {modalTab === 'consent' && (
                loadingConsent ? <p style={{ color: '#9CA3AF', textAlign: 'center', padding: 40 }}>Memuat data consent...</p>
                : consentData.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40 }}>
                    <div style={{ fontSize: 40, marginBottom: 12 }}>📝</div>
                    <p style={{ color: '#9CA3AF' }}>Consent belum diisi</p>
                  </div>
                ) : (
                  <div>
                    {consentData.map(c => (
                      <div key={c.id} style={{ marginBottom: 12, padding: 14, border: '1px solid #E5E7EB', borderRadius: 10, borderLeft: `4px solid ${c.is_agreed ? '#10B981' : '#F59E0B'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ fontWeight: 600, fontSize: 13, textTransform: 'capitalize', color: '#111' }}>
                            {c.consent_type.replace(/_/g, ' ')}
                          </div>
                          <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999, background: c.is_agreed ? '#D1FAE5' : '#FEF3C7', color: c.is_agreed ? '#065F46' : '#92400E' }}>
                            {c.is_agreed ? '✓ Disetujui' : '⏳ Belum'}
                          </span>
                        </div>
                        {c.signed_by_name && <div style={{ fontSize: 12, color: '#6B7280', marginTop: 4 }}>Ditandatangani: {c.signed_by_name} · {c.signed_at ? fmtDateTime(c.signed_at) : '-'}</div>}
                        {c.signature_data && <img src={c.signature_data} alt="Tanda tangan" style={{ marginTop: 8, maxHeight: 60, border: '1px solid #E5E7EB', borderRadius: 4 }} />}
                      </div>
                    ))}
                  </div>
                )
              )}

              {/* TAB ASSESSMENT - editable */}
              {modalTab === 'assessment' && (
                loadingAssessment ? <p style={{ color: '#9CA3AF', textAlign: 'center', padding: 40 }}>Memuat data assessment...</p>
                : (
                  <div>
                    {assessmentError && (
                      <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '10px 14px', color: '#B91C1C', fontSize: 13, marginBottom: 12 }}>
                        {assessmentError}
                      </div>
                    )}

                    {assessmentId && (
                      <div style={{ marginBottom: 14 }}>
                        <LockBadge isLocked={assessmentLocked} lockedAt={assessmentLockedAt} lockedBy={assessmentLockedBy} recordId={assessmentId} table="clinic_assessments" onUnlocked={() => setAssessmentLocked(false)} onRelocked={() => setAssessmentLocked(true)} />
                      </div>
                    )}

                    <fieldset disabled={assessmentLocked} style={{ border: 'none', padding: 0, margin: 0 }}>

                    {([
                      { key: 'subjective', label: 'S — Subjective', color: '#1D4ED8', bg: '#EFF6FF', placeholder: 'Keluhan subjektif pasien, riwayat singkat...' },
                      { key: 'objective', label: 'O — Objective', color: '#065F46', bg: '#D1FAE5', placeholder: 'Temuan pemeriksaan fisik, hasil tes...' },
                      { key: 'assessment', label: 'A — Assessment', color: '#92400E', bg: '#FEF3C7', placeholder: 'Diagnosis / clinical impression...' },
                      { key: 'plan', label: 'P — Plan', color: '#5B21B6', bg: '#EDE9FE', placeholder: 'Rencana tindakan, edukasi, follow-up...' },
                    ] as const).map(({ key, label, color, bg, placeholder }) => (
                      <div key={key} style={{ marginBottom: 14 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ padding: '2px 10px', borderRadius: 999, background: bg, color, fontSize: 12, fontWeight: 700 }}>{label}</span>
                        </label>
                        <textarea
                          value={assessment[key]}
                          onChange={e => setAssessment(prev => ({ ...prev, [key]: e.target.value }))}
                          placeholder={placeholder}
                          rows={3}
                          style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                        />
                      </div>
                    ))}

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Diagnosis</label>
                        <input
                          type="text"
                          value={assessment.diagnosis}
                          onChange={e => setAssessment(prev => ({ ...prev, diagnosis: e.target.value }))}
                          placeholder="Diagnosis / ICD-10"
                          style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Follow-up</label>
                        <input
                          type="date"
                          value={assessment.follow_up_date}
                          onChange={e => setAssessment(prev => ({ ...prev, follow_up_date: e.target.value }))}
                          style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                        />
                      </div>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Ditangani oleh</label>
                      <input
                        type="text"
                        value={assessment.handled_by}
                        onChange={e => setAssessment(prev => ({ ...prev, handled_by: e.target.value }))}
                        placeholder="Nama dokter / therapist"
                        style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }}
                      />
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Catatan Tambahan</label>
                      <textarea
                        value={assessment.notes}
                        onChange={e => setAssessment(prev => ({ ...prev, notes: e.target.value }))}
                        placeholder="Catatan tambahan..."
                        rows={2}
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                      />
                    </div>
                    </fieldset>
                  </div>
                )
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #E5E7EB', background: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <button className="btn-secondary" onClick={() => setShowVisitModal(false)} style={{ width: 'auto' }}>Tutup</button>
              {modalTab === 'assessment' && !assessmentLocked && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn-secondary"
                    onClick={handleSaveAssessment}
                    disabled={savingAssessment}
                    style={{ width: 'auto', opacity: savingAssessment ? 0.6 : 1 }}
                  >
                    {savingAssessment ? 'Menyimpan...' : 'Simpan Assessment'}
                  </button>
                  <button
                    className="btn-primary"
                    onClick={handleSaveAndSchedule}
                    disabled={savingAssessment}
                    style={{ width: 'auto', opacity: savingAssessment ? 0.6 : 1 }}
                  >
                    Simpan & Jadwalkan Berikutnya
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Follow-up modal — di atas modal visit */}
      {showFollowUpModal && selectedVisit && (
        <div className="modal-overlay" style={{ zIndex: 1100 }}>
          <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Jadwalkan Kunjungan Berikutnya</h3>

            {/* Tanggal follow-up */}
            <div className="form-group">
              <label>Tanggal Kunjungan Berikutnya *</label>
              <input
                type="date"
                value={followUpDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={e => setFollowUpDate(e.target.value)}
              />
            </div>

            {/* Catatan untuk pasien */}
            <div className="form-group">
              <label>Catatan untuk Pasien</label>
              <textarea
                value={followUpNotes}
                onChange={e => setFollowUpNotes(e.target.value)}
                placeholder="Instruksi atau catatan untuk kunjungan berikutnya..."
                rows={2}
              />
            </div>

            {/* Pilih paket (jika pasien punya paket aktif) */}
            {patientPackages.length > 0 && (
              <div className="form-group">
                <label>Gunakan Paket</label>
                <select value={selectedPackageId ?? ''} onChange={e => setSelectedPackageId(e.target.value || null)}>
                  <option value="">— Tidak pakai paket —</option>
                  {patientPackages.map(pp => (
                    <option key={pp.id} value={pp.id}>
                      {pp.package?.name} — Sisa {pp.remaining_sessions} sesi
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowFollowUpModal(false)}>Batal</button>
              <button
                className="btn-primary"
                disabled={!followUpDate || savingFollowUp}
                onClick={handleScheduleFollowUp}
                style={{ width: 'auto' }}
              >
                {savingFollowUp ? 'Menyimpan...' : 'Jadwalkan →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast sukses follow-up */}
      {followUpResult && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1200,
          background: '#080808', color: '#fff', padding: '12px 20px', borderRadius: 10,
          fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,.2)',
        }}>
          Kunjungan berikutnya dijadwalkan: {followUpResult}
        </div>
      )}
    </div>
  )
}

// ─── Tab 3 ──────────────────────────────────────────────────────────────────────
function RiwayatTab({ onOpenVisit }: { onOpenVisit: (visit: DokterVisit) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<PatientHistory[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [selectedPatient, setSelectedPatient] = useState<PatientHistory | null>(null)
  const [patientVisits, setPatientVisits] = useState<DokterVisit[]>([])
  const [loadingVisits, setLoadingVisits] = useState(false)

  const handleQuery = (val: string) => {
    setQuery(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!val.trim()) { setResults([]); return }
    searchTimer.current = setTimeout(async () => {
      setSearching(true)
      try {
        setResults(await searchPatients(val.trim()))
        setError('')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Pencarian gagal')
      } finally {
        setSearching(false)
      }
    }, 300)
  }

  const selectPatient = async (p: PatientHistory) => {
    setSelectedPatient(p)
    setLoadingVisits(true)
    try {
      setPatientVisits(await fetchPatientVisitHistory(p.id))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat riwayat')
    } finally {
      setLoadingVisits(false)
    }
  }

  return (
    <div>
      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, kode pasien, atau nomor HP..."
          value={query} onChange={e => handleQuery(e.target.value)} style={{ minWidth: 300 }}
        />
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* Search results */}
        <div style={{ flex: '1 1 280px', minWidth: 260 }}>
          {searching ? (
            <p style={{ color: 'var(--text-muted)' }}>Mencari...</p>
          ) : results.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{query.trim() ? 'Tidak ada pasien ditemukan.' : 'Ketik untuk mencari pasien.'}</p>
          ) : results.map(p => (
            <div key={p.id} onClick={() => selectPatient(p)}
              style={{
                background: selectedPatient?.id === p.id ? '#FFF5F5' : '#fff',
                border: '1px solid #E5E7EB', borderLeft: selectedPatient?.id === p.id ? '4px solid #C0392B' : '1px solid #E5E7EB',
                borderRadius: 10, padding: 12, marginBottom: 8, cursor: 'pointer',
              }}>
              <div style={{ fontWeight: 600 }}>{p.full_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ fontFamily: 'monospace' }}>{p.patient_code}</span> · {p.phone} · {ageFromDob(p.date_of_birth)}
              </div>
            </div>
          ))}
        </div>

        {/* Detail panel */}
        <div style={{ flex: '2 1 380px', minWidth: 300 }}>
          {!selectedPatient ? (
            <EmptyState>Pilih pasien untuk melihat riwayat kunjungan</EmptyState>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>{selectedPatient.full_name}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '6px 16px', fontSize: 13, marginTop: 8, marginBottom: 16 }}>
                <div><span style={{ color: 'var(--text-muted)' }}>Kode: </span><span style={{ fontFamily: 'monospace' }}>{selectedPatient.patient_code}</span></div>
                <div><span style={{ color: 'var(--text-muted)' }}>HP: </span>{selectedPatient.phone}</div>
                <div><span style={{ color: 'var(--text-muted)' }}>Tgl Lahir: </span>{fmtDate(selectedPatient.date_of_birth)} ({ageFromDob(selectedPatient.date_of_birth)})</div>
                <div><span style={{ color: 'var(--text-muted)' }}>Gender: </span>{selectedPatient.gender || '-'}</div>
              </div>

              {loadingVisits ? (
                <p style={{ color: 'var(--text-muted)' }}>Memuat riwayat...</p>
              ) : patientVisits.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Belum ada riwayat kunjungan</p>
              ) : patientVisits.map(v => (
                <div key={v.id} style={{ borderTop: '1px solid #F3F4F6', padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{fmtDate(v.visit_date)}{v.visit_time ? ` · ${fmtTime(v.visit_time)}` : ''}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v.services.map(s => s.service_name).join(', ') || '-'}</div>
                    {v.chief_complaint && <div style={{ fontSize: 12, fontStyle: 'italic', color: 'var(--text-muted)' }}>{v.chief_complaint}</div>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <StatusBadge status={v.status} />
                    <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => onOpenVisit(v)}>Lihat Detail</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
