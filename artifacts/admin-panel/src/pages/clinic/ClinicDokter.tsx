import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtTime, fmtDateTime } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { lockRecord, orIlike } from '../../lib/clinic'
import LockBadge from '../../components/clinic/LockBadge'

// ─── Subjective (EMR) ────────────────────────────────────────────────────────
// Daftar tetap sengaja didefinisikan di kode (bukan di database) supaya gampang diedit.
const ILLNESS_HISTORY_OPTIONS = [
  'Hipertensi', 'Diabetes', 'Penyakit Jantung', 'Asma', 'Osteoarthritis',
  'Rheumatoid Arthritis', 'Osteoporosis', 'Riwayat Cedera Olahraga',
  'Riwayat Operasi Ortopedi', 'Riwayat Patah Tulang', 'Gangguan Ginjal',
  'Gangguan Tiroid', 'Tidak Ada',
]
const OTHER_ALLERGY_OPTIONS = [
  'Alergi Makanan', 'Alergi Debu', 'Alergi Dingin',
  'Alergi Lateks/Getah', 'Alergi Serbuk Sari', 'Tidak Ada',
]
const BLOOD_TYPE_OPTIONS = ['A', 'B', 'AB', 'O']
const ADDITIONAL_NOTE_TYPES = [
  { value: 'psikologis', label: 'Psikologis' },
  { value: 'ekonomi', label: 'Ekonomi' },
  { value: 'spiritual', label: 'Spiritual' },
] as const

type AdditionalNoteType = (typeof ADDITIONAL_NOTE_TYPES)[number]['value']

interface SubjectiveGeneral {
  blood_type: string
  is_smoker: boolean
  is_pregnant: boolean
  is_lactating: boolean
}
interface SubjectiveAdditionalNote {
  type: AdditionalNoteType
  value: string
}
interface SubjectiveData {
  general: SubjectiveGeneral
  chief_complaint: string
  illness_history: string[]
  illness_other: string
  illness_notes: string
  drug_allergies: string
  other_allergies: string[]
  allergy_other: string
  allergy_notes: string
  additional_notes: SubjectiveAdditionalNote[]
}

const emptySubjective = (): SubjectiveData => ({
  general: { blood_type: '', is_smoker: false, is_pregnant: false, is_lactating: false },
  chief_complaint: '',
  illness_history: [], illness_other: '', illness_notes: '',
  drug_allergies: '',
  other_allergies: [], allergy_other: '', allergy_notes: '',
  additional_notes: [],
})

/**
 * Normalisasi kolom `subjective` jadi SubjectiveData. Tahan tiga bentuk:
 * jsonb terstruktur (baru), hasil migrasi legacy ({chief_complaint, legacy_migrated}),
 * dan plain text (kalau migrasi SQL belum dijalankan).
 */
function parseSubjective(raw: unknown): SubjectiveData {
  const base = emptySubjective()
  if (raw == null) return base
  if (typeof raw === 'string') return { ...base, chief_complaint: raw }
  if (typeof raw !== 'object') return base
  const r = raw as Partial<SubjectiveData> & { general?: Partial<SubjectiveGeneral> }
  return {
    general: { ...base.general, ...(r.general ?? {}) },
    chief_complaint: r.chief_complaint ?? '',
    illness_history: Array.isArray(r.illness_history) ? r.illness_history : [],
    illness_other: r.illness_other ?? '',
    illness_notes: r.illness_notes ?? '',
    drug_allergies: r.drug_allergies ?? '',
    other_allergies: Array.isArray(r.other_allergies) ? r.other_allergies : [],
    allergy_other: r.allergy_other ?? '',
    allergy_notes: r.allergy_notes ?? '',
    additional_notes: Array.isArray(r.additional_notes) ? r.additional_notes : [],
  }
}

// ─── Objective (EMR) ─────────────────────────────────────────────────────────
// Dipakai lagi di Tahap B (Lokasi Nyeri) — sengaja didefinisikan sekali di sini.
const SPORTS_BODY_PARTS = [
  'Leher', 'Bahu', 'Siku', 'Pergelangan Tangan', 'Punggung/Tulang Belakang',
  'Panggul', 'Lutut', 'Pergelangan Kaki', 'Telapak Kaki', 'Otot & Sendi Umum',
]
const CONSCIOUSNESS_OPTIONS = ['Compos Mentis', 'Somnolence', 'Sopor', 'Coma'] as const
type Consciousness = (typeof CONSCIOUSNESS_OPTIONS)[number]

interface ObjectivePhysicalExamItem {
  part: string
  status: 'normal' | 'abnormal'
  notes: string
}
const PAIN_FREQUENCY_OPTIONS = ['Jarang', 'Hilang timbul', 'Terus menerus'] as const
type PainFrequency = (typeof PAIN_FREQUENCY_OPTIONS)[number]

/** Lokasi nyeri: status saja, TANPA catatan per baris (beda dgn Pemeriksaan Fisik). */
interface PainLocationItem {
  part: string
  status: 'normal' | 'abnormal'
}
interface PainAssessmentData {
  nrs_score: number | null   // 0–10
  locations: PainLocationItem[]
  cause: string
  duration: string
  frequency: PainFrequency | null
}
/** Titik pada diagram tubuh. x/y disimpan sebagai PERSEN (0–100) relatif kotak SVG,
 *  jadi posisinya ikut menyesuaikan kalau container di-resize. */
interface BodyPoint {
  id: string
  view: 'front' | 'back'
  x: number
  y: number
  part_label: string
  notes: string
}
// ⚠️ BUTUH VALIDASI KLINIS. Ambang "Get Up and Go" bervariasi antar sumber (12–14.5 detik),
// belum dikonfirmasi cocok dengan SOP klinik ini.
// TODO: validasi ke fisioterapis 20FIT. Ubah angka ini kapan pun sudah ada kepastian.
const FALL_RISK_THRESHOLD_SECONDS = 12

/** risk_level dihitung OTOMATIS dari test_seconds — bukan dipilih manual. */
type FallRiskLevel = 'rendah' | 'tinggi'
interface FallRiskData {
  test_seconds: number | null
  risk_level: FallRiskLevel | null
}
const computeFallRisk = (secs: number | null): FallRiskLevel | null =>
  secs === null ? null : (secs >= FALL_RISK_THRESHOLD_SECONDS ? 'tinggi' : 'rendah')

interface ObjectiveData {
  consciousness: Consciousness | null
  physical_exam: ObjectivePhysicalExamItem[]
  pain_assessment: PainAssessmentData
  body_points: BodyPoint[]
  fall_risk: FallRiskData
  // Fallback baris lama — jangan dihapus.
  legacy_text?: string
  legacy_migrated?: true
}

/** Urutan pencarian ekstensi gambar diagram tubuh: .png dulu, lalu .jpg, lalu .jpeg. */
const BODY_IMAGE_EXTS = ['png', 'jpg', 'jpeg'] as const

const newPointId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
/** Kolom `vital_signs` TERPISAH dari `objective` (bukan bagian dari jsonb objective). */
interface VitalSigns {
  temperature: number | null       // celcius
  systolic: number | null          // mmHg
  diastolic: number | null         // mmHg
  pulse: number | null             // /menit
  respiratory_rate: number | null  // /menit
}

const emptyPainAssessment = (): PainAssessmentData => ({
  nrs_score: null, locations: [], cause: '', duration: '', frequency: null,
})
const emptyFallRisk = (): FallRiskData => ({ test_seconds: null, risk_level: null })
const emptyObjective = (): ObjectiveData => ({
  consciousness: null, physical_exam: [], pain_assessment: emptyPainAssessment(), body_points: [], fall_risk: emptyFallRisk(),
})

/** Backward-compat: baris lama tanpa fall_risk → default kosong. risk_level selalu
 *  dihitung ulang dari test_seconds (abaikan nilai risk_level tersimpan). */
function parseFallRisk(raw: unknown): FallRiskData {
  if (raw == null || typeof raw !== 'object') return emptyFallRisk()
  const r = raw as Partial<FallRiskData>
  const secs = typeof r.test_seconds === 'number' && Number.isFinite(r.test_seconds) ? r.test_seconds : null
  return { test_seconds: secs, risk_level: computeFallRisk(secs) }
}

/** Backward-compat: baris lama yang belum punya pain_assessment → default kosong. */
function parsePainAssessment(raw: unknown): PainAssessmentData {
  const base = emptyPainAssessment()
  if (raw == null || typeof raw !== 'object') return base
  const r = raw as Partial<PainAssessmentData>
  const score = typeof r.nrs_score === 'number' && r.nrs_score >= 0 && r.nrs_score <= 10 ? r.nrs_score : null
  const freqValid = (PAIN_FREQUENCY_OPTIONS as readonly string[]).includes(r.frequency as string)
  return {
    nrs_score: score,
    locations: Array.isArray(r.locations)
      ? r.locations
          .filter(l => l && typeof l.part === 'string')
          .map(l => ({ part: l.part, status: l.status === 'abnormal' ? 'abnormal' as const : 'normal' as const }))
      : [],
    cause: r.cause ?? '',
    duration: r.duration ?? '',
    frequency: freqValid ? (r.frequency as PainFrequency) : null,
  }
}
const emptyVitalSigns = (): VitalSigns => ({
  temperature: null, systolic: null, diastolic: null, pulse: null, respiratory_rate: null,
})

/** Normalisasi kolom `objective`: jsonb baru, hasil migrasi legacy, atau plain text lama. */
function parseObjective(raw: unknown): ObjectiveData {
  const base = emptyObjective()
  if (raw == null) return base
  if (typeof raw === 'string') return raw.trim() ? { ...base, legacy_text: raw, legacy_migrated: true } : base
  if (typeof raw !== 'object') return base
  const r = raw as Partial<ObjectiveData>
  const valid = (CONSCIOUSNESS_OPTIONS as readonly string[]).includes(r.consciousness as string)
  return {
    consciousness: valid ? (r.consciousness as Consciousness) : null,
    physical_exam: Array.isArray(r.physical_exam)
      ? r.physical_exam
          .filter(p => p && typeof p.part === 'string')
          .map(p => ({ part: p.part, status: p.status === 'abnormal' ? 'abnormal' as const : 'normal' as const, notes: p.notes ?? '' }))
      : [],
    pain_assessment: parsePainAssessment(r.pain_assessment),
    body_points: Array.isArray(r.body_points)
      ? r.body_points
          .filter(p => p && typeof p.id === 'string')
          .map(p => ({
            id: p.id,
            view: p.view === 'back' ? 'back' as const : 'front' as const,
            x: typeof p.x === 'number' ? p.x : 0,
            y: typeof p.y === 'number' ? p.y : 0,
            part_label: p.part_label ?? '',
            notes: p.notes ?? '',
          }))
      : [],
    fall_risk: parseFallRisk(r.fall_risk),
    ...(r.legacy_text ? { legacy_text: r.legacy_text } : {}),
    ...(r.legacy_migrated ? { legacy_migrated: true as const } : {}),
  }
}

/** Normalisasi kolom `vital_signs` (kolom tersendiri di clinic_assessments). */
function parseVitalSigns(raw: unknown): VitalSigns {
  const base = emptyVitalSigns()
  if (raw == null || typeof raw !== 'object') return base
  const r = raw as Record<string, unknown>
  const num = (v: unknown): number | null =>
    v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v)
  return {
    temperature: num(r.temperature),
    systolic: num(r.systolic),
    diastolic: num(r.diastolic),
    pulse: num(r.pulse),
    respiratory_rate: num(r.respiratory_rate),
  }
}

/** Warna skala nyeri — replikasi persis intensityColor() di ClinicTriase.tsx:470. */
function intensityColor(v: number): string {
  if (v <= 2) return '#16A34A'
  if (v <= 5) return '#CA8A04'
  if (v <= 7) return '#EA580C'
  return '#DC2626'
}

// Gaya input konsisten dgn form lain — semua lewat theme vars, tanpa warna hardcode.
const emrField: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13,
  fontFamily: 'inherit', boxSizing: 'border-box',
  border: '1px solid var(--border-strong)', background: 'var(--bg-input)', color: 'var(--text-primary)',
}
const emrSubLabel: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4,
}

/** Sub-blok di dalam section Subjective. */
function EmrBlock({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12, border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-elevated)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  )
}

/** Checkbox group — pola & styling sama persis dgn MultiCheck di ClinicTriase.tsx. */
function MultiCheck({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) => onChange(value.includes(opt) ? value.filter(o => o !== opt) : [...value, opt])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
      {options.map(opt => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} style={{ width: 'auto', accentColor: 'var(--red)' }} />
          {opt}
        </label>
      ))}
    </div>
  )
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ width: 'auto', accentColor: 'var(--red)' }} />
      {label}
    </label>
  )
}

/**
 * Siluet tubuh SKEMATIK (stick-figure) — SVG ORISINAL yang dibangun murni dari
 * bentuk geometris dasar: lingkaran (kepala/tangan), rounded-rect (torso, lengan,
 * tungkai, panggul), dan ellipse (telapak kaki). BUKAN ilustrasi anatomis dan
 * tidak menjiplak/men-trace gambar mana pun. Tampak 'back' hanya menambah garis
 * tengah tipis sebagai pembeda visual — tanpa detail anatomi.
 * viewBox tetap 0 0 200 500 supaya rasio konsisten & koordinat persen stabil.
 */
function BodySilhouette({ view }: { view: 'front' | 'back' }) {
  const shape = { fill: 'var(--bg-elevated)', stroke: 'var(--border-strong)', strokeWidth: 1.25 }
  const guide = { fill: 'var(--border-strong)', opacity: 0.35 }
  return (
    <g>
      {/* Kepala (oval) + leher pendek */}
      <ellipse cx={100} cy={44} rx={25} ry={31} {...shape} />
      <rect x={92} y={68} width={16} height={14} rx={7} {...shape} />

      {/* Bahu/dada lebar (92) → pinggang meruncing (58) → panggul (68) */}
      <ellipse cx={100} cy={118} rx={46} ry={40} {...shape} />
      <rect x={71} y={142} width={58} height={58} rx={22} {...shape} />
      <rect x={66} y={192} width={68} height={54} rx={24} {...shape} />

      {/* Lengan kiri: lengan atas — siku — lengan bawah — telapak tangan */}
      <rect x={40} y={92} width={20} height={72} rx={10} {...shape} />
      <circle cx={50} cy={166} r={11} {...shape} />
      <rect x={40} y={168} width={20} height={68} rx={10} {...shape} />
      <ellipse cx={50} cy={248} rx={11} ry={14} {...shape} />

      {/* Lengan kanan */}
      <rect x={140} y={92} width={20} height={72} rx={10} {...shape} />
      <circle cx={150} cy={166} r={11} {...shape} />
      <rect x={140} y={168} width={20} height={68} rx={10} {...shape} />
      <ellipse cx={150} cy={248} rx={11} ry={14} {...shape} />

      {/* Tungkai kiri: paha — lutut — betis — telapak kaki */}
      <rect x={74} y={240} width={24} height={100} rx={12} {...shape} />
      <circle cx={86} cy={343} r={12} {...shape} />
      <rect x={75} y={346} width={22} height={100} rx={11} {...shape} />
      <ellipse cx={86} cy={458} rx={16} ry={12} {...shape} />

      {/* Tungkai kanan */}
      <rect x={102} y={240} width={24} height={100} rx={12} {...shape} />
      <circle cx={114} cy={343} r={12} {...shape} />
      <rect x={103} y={346} width={22} height={100} rx={11} {...shape} />
      <ellipse cx={114} cy={458} rx={16} ry={12} {...shape} />

      {/* Tampak belakang: garis tengah + garis bahu & pinggang (opacity rendah) */}
      {view === 'back' && (
        <>
          <rect x={97.5} y={92} width={5} height={104} rx={2.5} {...guide} />
          <rect x={62} y={102} width={76} height={4} rx={2} {...guide} />
          <rect x={76} y={186} width={48} height={4} rx={2} {...guide} />
        </>
      )}
    </g>
  )
}

/** Replikasi persis Collapsible di ClinicTriase.tsx:354-366 (module-local, tak di-export). */
function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: 'var(--bg-card)', borderLeft: '3px solid var(--red)', borderRadius: 8, padding: 16, marginBottom: 12, boxShadow: '0 1px 2px rgba(0,0,0,.2)' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <span style={{ color: 'var(--red)', fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>{title}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  )
}

interface BodyPartStatus { part: string; status: 'normal' | 'abnormal'; notes?: string }

/**
 * Daftar bagian tubuh + toggle Normal / Ada Kelainan (pola tombol Ya/Tidak PAR-Q).
 * Dipakai dua kali:
 *   showNotes=true  → Pemeriksaan Fisik (muncul input catatan saat "Ada Kelainan")
 *   showNotes=false → Lokasi Nyeri (status saja, tanpa catatan per baris)
 */
function BodyPartStatusList({ parts, value, onChange, showNotes }: {
  parts: string[]
  value: BodyPartStatus[]
  onChange: (next: BodyPartStatus[]) => void
  showNotes: boolean
}) {
  const setPart = (part: string, patch: Partial<BodyPartStatus>) => {
    const idx = value.findIndex(v => v.part === part)
    onChange(idx >= 0
      ? value.map((v, i) => (i === idx ? { ...v, ...patch } : v))
      : [...value, { part, status: 'normal' as const, ...patch }])
  }
  return (
    <>
      {parts.map(part => {
        const ex = value.find(v => v.part === part) ?? null
        const abnormal = ex?.status === 'abnormal'
        const isNormal = !!ex && !abnormal
        return (
          <div key={part} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 13, flex: 1 }}>{part}</span>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={() => setPart(part, showNotes ? { status: 'normal', notes: '' } : { status: 'normal' })}
                  style={{ padding: '5px 16px', borderRadius: 6, border: '1px solid', cursor: 'pointer',
                    borderColor: isNormal ? '#374151' : 'var(--border-strong)', background: isNormal ? '#374151' : 'transparent', color: isNormal ? '#fff' : 'var(--text-muted)', fontWeight: isNormal ? 700 : 400 }}>Normal</button>
                <button type="button" onClick={() => setPart(part, { status: 'abnormal' })}
                  style={{ padding: '5px 16px', borderRadius: 6, border: '1px solid', cursor: 'pointer',
                    borderColor: abnormal ? 'var(--red)' : 'var(--border-strong)', background: abnormal ? 'var(--red)' : 'transparent', color: abnormal ? '#fff' : 'var(--text-muted)', fontWeight: abnormal ? 700 : 400 }}>Ada Kelainan</button>
              </div>
            </div>
            {showNotes && abnormal && (
              <input type="text" value={ex?.notes ?? ''} onChange={ev => setPart(part, { notes: ev.target.value })}
                placeholder={`Catatan kelainan pada ${part}...`} style={{ ...emrField, marginTop: 8 }} />
            )}
          </div>
        )
      })}
    </>
  )
}

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
  services: { id: string; service_id: string; service_name: string; price: number; service?: { requires_doctor: boolean } | null }[]
}

interface PatientHistory {
  id: string
  patient_code: string
  full_name: string
  phone: string
  date_of_birth: string | null
  gender: string | null
}

// ─── Diagnosis (EMR) ─────────────────────────────────────────────────────────
interface Icd10Selection {
  code: string
  display: string
  is_primary: boolean
}
interface DiagnosisData {
  text: string                 // diagnosa kerja, teks bebas (wajib)
  icd10_codes: Icd10Selection[] // minimal 1 (wajib); tepat 1 yang is_primary
}
const emptyDiagnosis = (): DiagnosisData => ({ text: '', icd10_codes: [] })

/** Kolom diagnosis (jsonb). Baris lama semuanya null → jalur default. */
function parseDiagnosis(raw: unknown): DiagnosisData {
  if (raw == null || typeof raw !== 'object') return emptyDiagnosis()
  const r = raw as Partial<DiagnosisData>
  return {
    text: typeof r.text === 'string' ? r.text : '',
    icd10_codes: Array.isArray(r.icd10_codes)
      ? r.icd10_codes
          .filter(c => c && typeof c.code === 'string')
          .map(c => ({ code: c.code, display: c.display ?? '', is_primary: !!c.is_primary }))
      : [],
  }
}

// ── Plan (SOAP: P) ──────────────────────────────────────────────────────────
type DischargeStatus = 'Berobat Jalan' | 'Sehat' | 'Rujuk' | 'Meninggal'
const DISCHARGE_STATUS_OPTIONS: DischargeStatus[] = ['Berobat Jalan', 'Sehat', 'Rujuk', 'Meninggal']

interface PlanData {
  treatment: string            // Rencana Terapi/Tindakan
  education_followup: string   // Edukasi & Follow-up
  discharge_status: DischargeStatus | null
  legacy_migrated?: true       // penanda baris hasil migrasi (saat ini tak ada isinya)
}
const emptyPlan = (): PlanData => ({ treatment: '', education_followup: '', discharge_status: null })

/** Kolom plan (jsonb). Baris lama kosong → jalur default. */
function parsePlan(raw: unknown): PlanData {
  if (raw == null || typeof raw !== 'object') return emptyPlan()
  const r = raw as Partial<PlanData>
  const ds = r.discharge_status
  return {
    treatment: typeof r.treatment === 'string' ? r.treatment : '',
    education_followup: typeof r.education_followup === 'string' ? r.education_followup : '',
    discharge_status: DISCHARGE_STATUS_OPTIONS.includes(ds as DischargeStatus) ? (ds as DischargeStatus) : null,
    ...(r.legacy_migrated ? { legacy_migrated: true as const } : {}),
  }
}

interface AssessmentForm {
  subjective: SubjectiveData
  objective: ObjectiveData
  vital_signs: VitalSigns
  assessment: string
  plan: PlanData
  diagnosis: DiagnosisData
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

type ModalTab = 'screening' | 'consent' | 'assessment' | 'riwayat'

interface MedicalHistory {
  visit_id: string
  visit_date: string
  visit_time: string | null
  chief_complaint: string | null
  services: { service_name: string; price: number }[]
  assessment: {
    diagnosis: DiagnosisData | string | null   // jsonb (baru) / string (legacy) / null
    plan: PlanData | string | null             // jsonb (baru) / string (legacy) / null
    // subjective/objective: jsonb setelah migrasi; string kalau data lama. Tidak dirender di Riwayat.
    subjective: SubjectiveData | string | null
    objective: ObjectiveData | string | null
    assessment: string | null
    handled_by: string | null
  } | null
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
    .eq('assessment_type', 'doctor')   // ambil baris dokter; hindari nyangkut baris 'therapist' + error multi-row
    .maybeSingle()
  if (!data) return null
  return {
    id: data.id,
    isLocked: !!data.is_locked,
    lockedAt: data.locked_at ?? null,
    lockedBy: data.locked_by ?? null,
    form: {
      subjective: parseSubjective(data.subjective),
      objective: parseObjective(data.objective),
      vital_signs: parseVitalSigns(data.vital_signs),
      assessment: data.assessment ?? '',
      plan: parsePlan(data.plan),
      diagnosis: parseDiagnosis(data.diagnosis),
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
      assessment_type: 'doctor',   // form ini = assessment dokter; koeksis dgn baris 'therapist' (ClinicTriase)
      ...form,
      // plan & diagnosis disimpan sebagai jsonb dari ...form. follow_up_date kolom date:
      // string kosong tidak valid → normalisasi '' menjadi null (opsional, tidak wajib).
      follow_up_date: form.follow_up_date || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'visit_id,assessment_type' })   // match unique index asli (visit_id, assessment_type)
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
  services:clinic_visit_services(id, service_id, service_name, price, service:clinic_services(requires_doctor))
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
  const rows = (data ?? []) as unknown as DokterVisit[]
  // Hanya tampilkan visit dengan minimal 1 layanan yang requires_doctor = true.
  return rows.filter(v => v.services?.some(s => s.service?.requires_doctor === true))
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
    .or(orIlike(['full_name', 'patient_code', 'phone'], query))
    .eq('is_active', true)
    .order('full_name')
    .limit(20)
  if (error) throw error
  return (data ?? []) as unknown as PatientHistory[]
}

// Daftar default tab Riwayat Pasien: pasien diurut berdasarkan kunjungan TERAKHIR
// (visit_date terbaru dulu, bukan alfabetis). PostgREST tak bisa DISTINCT ON / order-by
// agregat embedded, jadi ambil sejumlah visit terbaru lalu dedupe per pasien di klien
// (maks 50 pasien). Pasien tanpa kunjungan tidak muncul di daftar default — itu memang
// "riwayat" — tapi tetap bisa ditemukan lewat kotak pencarian.
async function fetchRecentPatients(): Promise<PatientHistory[]> {
  const { data, error } = await supabase
    .from('clinic_visits')
    .select('visit_date, patient:clinic_patients!inner(id, patient_code, full_name, phone, date_of_birth, gender, is_active)')
    .eq('patient.is_active', true)
    .order('visit_date', { ascending: false })
    .limit(200)
  if (error) throw error
  const seen = new Set<string>()
  const out: PatientHistory[] = []
  for (const row of (data ?? []) as any[]) {
    const p = row.patient
    if (!p || seen.has(p.id)) continue
    seen.add(p.id)
    out.push({
      id: p.id, patient_code: p.patient_code, full_name: p.full_name,
      phone: p.phone, date_of_birth: p.date_of_birth, gender: p.gender,
    })
    if (out.length >= 50) break
  }
  return out
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
    background: queue && s === 'in_progress' ? 'rgba(192,57,43,0.12)' : 'var(--bg-card)',
    border: '1px solid var(--border)',
    borderLeft: `4px solid ${queue && s === 'in_progress' ? 'var(--red)' : leftColor}`,
    borderRadius: 12, padding: 16, marginBottom: 8,
    opacity: s === 'completed' ? 0.8 : 1,
  }
  const timeBox: React.CSSProperties = {
    minWidth: 64, textAlign: 'center', padding: '8px 6px', borderRadius: 8, fontWeight: 700, fontSize: 14,
    background: s === 'in_progress' ? 'rgba(192,57,43,0.2)' : 'var(--bg-elevated)',
    color: s === 'in_progress' ? 'var(--red)' : 'var(--text-secondary)',
  }

  return (
    <div style={cardStyle}>
      <div style={timeBox}>{visit.visit_time ? fmtTime(visit.visit_time) : '—'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{visit.patient?.full_name || '-'}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{visit.patient?.patient_code || '-'}</div>
        <div style={{ fontSize: 13, marginTop: 2, color: 'var(--text-secondary)' }}>{visit.services.map(s => s.service_name).join(', ') || '-'}</div>
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
  <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)', background: 'var(--bg-card)', border: '1px dashed var(--border)', borderRadius: 12 }}>{children}</div>
)

const SCREENING_SECTION_TITLE: React.CSSProperties = { fontWeight: 700, fontSize: 12, color: '#374151', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }

// Baris chips read-only untuk satu kategori. Tidak merender apa pun jika items kosong.
function ChipRow({ label, items, tone = 'gray' }: { label: string; items: string[]; tone?: 'gray' | 'red' }) {
  if (!items || items.length === 0) return null
  const chip: React.CSSProperties = tone === 'red'
    ? { padding: '2px 8px', background: '#FEE2E2', color: 'var(--red)', borderRadius: 999, fontSize: 11 }
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
  const [modalTab, setModalTab] = useState<ModalTab>('screening')
  const [screeningData, setScreeningData] = useState<ClinicScreeningData | null>(null)
  const [loadingScreening, setLoadingScreening] = useState(false)
  const [consentData, setConsentData] = useState<ClinicConsentData[]>([])
  const [loadingConsent, setLoadingConsent] = useState(false)
  const [medicalHistory, setMedicalHistory] = useState<MedicalHistory[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [assessment, setAssessment] = useState<AssessmentForm>({
    subjective: emptySubjective(), objective: emptyObjective(), vital_signs: emptyVitalSigns(),
    assessment: '', plan: emptyPlan(), diagnosis: emptyDiagnosis(), follow_up_date: '', notes: '', handled_by: '',
  })
  const [loadingAssessment, setLoadingAssessment] = useState(false)
  const [savingAssessment, setSavingAssessment] = useState(false)
  const [newNoteType, setNewNoteType] = useState<AdditionalNoteType>('psikologis')
  const [bodyView, setBodyView] = useState<'front' | 'back'>('front')
  const [pointDraft, setPointDraft] = useState<(BodyPoint & { isNew: boolean }) | null>(null)
  // ICD-10 picker
  const [icdQuery, setIcdQuery] = useState('')
  const [icdResults, setIcdResults] = useState<{ code: string; display: string }[]>([])
  const [icdSearching, setIcdSearching] = useState(false)
  const icdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Index ekstensi yang sedang dicoba, dilacak per basis nama file (mis. 'front-male').
  // Naik tiap kali <img> gagal; kalau sudah melewati daftar ekstensi → fallback ke siluet SVG.
  const [bodyExtIndex, setBodyExtIndex] = useState<Record<string, number>>({})
  const [assessmentError, setAssessmentError] = useState('')
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [assessmentLocked, setAssessmentLocked] = useState(false)
  const [assessmentLockedAt, setAssessmentLockedAt] = useState<string | null>(null)
  const [assessmentLockedBy, setAssessmentLockedBy] = useState<string | null>(null)

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

  // Fetch riwayat kunjungan pasien saat tab Riwayat dibuka.
  useEffect(() => {
    if (modalTab !== 'riwayat' || !selectedVisit) return

    const fetchHistory = async () => {
      setHistoryLoading(true)
      try {
        const patientId = selectedVisit.patient?.id

        // Fetch past visits (excluding current visit)
        const { data: visits } = await supabase
          .from('clinic_visits')
          .select(`
            id, visit_date, visit_time, chief_complaint,
            services:clinic_visit_services(service_name, price),
            assessment:clinic_assessments(
              diagnosis, plan, subjective, objective, assessment, handled_by, assessment_type
            )
          `)
          .eq('patient_id', patientId)
          .neq('id', selectedVisit.id)
          .eq('payment_status', 'paid')
          .order('visit_date', { ascending: false })
          .limit(10)

        const history: MedicalHistory[] = (visits ?? []).map((v: any) => ({
          visit_id: v.id,
          visit_date: v.visit_date,
          visit_time: v.visit_time,
          chief_complaint: v.chief_complaint,
          services: v.services ?? [],
          assessment: Array.isArray(v.assessment)
            ? (v.assessment.find((a: any) => a?.assessment_type === 'doctor') ?? null)
            : v.assessment,
        }))

        setMedicalHistory(history)
      } catch (e) {
        console.error(e)
      } finally {
        setHistoryLoading(false)
      }
    }

    fetchHistory()
  }, [modalTab, selectedVisit])

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
    setMedicalHistory([])
    setHistoryLoading(false)
    setAssessmentError('')

    setLoadingScreening(true)
    setLoadingConsent(true)
    setLoadingAssessment(true)
    try {
      const [screening, consents, existingAssessment] = await Promise.all([
        fetchScreening(visit.id),
        fetchConsents(visit.id),
        fetchAssessment(visit.id),
      ])
      setScreeningData(screening)
      setConsentData(consents)
      if (existingAssessment) {
        setAssessment(existingAssessment.form)
        setAssessmentId(existingAssessment.id)
        setAssessmentLocked(existingAssessment.isLocked)
        setAssessmentLockedAt(existingAssessment.lockedAt)
        setAssessmentLockedBy(existingAssessment.lockedBy)
      } else {
        setAssessment({
          subjective: emptySubjective(), objective: emptyObjective(), vital_signs: emptyVitalSigns(),
          assessment: '', plan: emptyPlan(), diagnosis: emptyDiagnosis(), follow_up_date: '', notes: '',
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

  // ── Subjective helpers ────────────────────────────────────────────────────
  const subj = assessment.subjective
  const patchSubj = (patch: Partial<SubjectiveData>) =>
    setAssessment(p => ({ ...p, subjective: { ...p.subjective, ...patch } }))
  const patchGeneral = (patch: Partial<SubjectiveGeneral>) =>
    setAssessment(p => ({ ...p, subjective: { ...p.subjective, general: { ...p.subjective.general, ...patch } } }))
  const addNote = () =>
    setAssessment(p => ({ ...p, subjective: { ...p.subjective, additional_notes: [...p.subjective.additional_notes, { type: newNoteType, value: '' }] } }))
  const updateNote = (i: number, value: string) =>
    setAssessment(p => ({ ...p, subjective: { ...p.subjective, additional_notes: p.subjective.additional_notes.map((n, idx) => (idx === i ? { ...n, value } : n)) } }))
  const removeNote = (i: number) =>
    setAssessment(p => ({ ...p, subjective: { ...p.subjective, additional_notes: p.subjective.additional_notes.filter((_, idx) => idx !== i) } }))

  // ── Objective helpers ─────────────────────────────────────────────────────
  const obj = assessment.objective
  const vitals = assessment.vital_signs
  const patchObj = (patch: Partial<ObjectiveData>) =>
    setAssessment(p => ({ ...p, objective: { ...p.objective, ...patch } }))
  const patchVital = (k: keyof VitalSigns, v: string) =>
    setAssessment(p => ({ ...p, vital_signs: { ...p.vital_signs, [k]: v === '' ? null : Number(v) } }))
  const pain = obj.pain_assessment
  const patchPain = (patch: Partial<PainAssessmentData>) =>
    setAssessment(p => ({ ...p, objective: { ...p.objective, pain_assessment: { ...p.objective.pain_assessment, ...patch } } }))

  // ── Body diagram helpers ──────────────────────────────────────────────────
  // Klik di siluet → titik baru pada koordinat itu, disimpan sebagai PERSEN
  // terhadap bounding box SVG (aman terhadap resize container).
  const handleDiagramClick = (e: React.MouseEvent<SVGSVGElement>) => {
    if (assessmentLocked) return
    const rect = e.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
    const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
    setPointDraft({ id: newPointId(), view: bodyView, x, y, part_label: '', notes: '', isNew: true })
  }
  const savePoint = () => {
    if (!pointDraft) return
    const { isNew, ...p } = pointDraft
    patchObj({ body_points: isNew ? [...obj.body_points, p] : obj.body_points.map(bp => (bp.id === p.id ? p : bp)) })
    setPointDraft(null)
  }
  const deletePoint = (id: string) => {
    patchObj({ body_points: obj.body_points.filter(bp => bp.id !== id) })
    setPointDraft(null)
  }
  const viewPoints = obj.body_points.filter(p => p.view === bodyView)
  // Fall risk — risk_level SELALU turunan dari test_seconds (tidak dipilih manual).
  const setFallSeconds = (secs: number | null) =>
    patchObj({ fall_risk: { test_seconds: secs, risk_level: computeFallRisk(secs) } })

  // ── Diagnosis helpers ─────────────────────────────────────────────────────
  const diag = assessment.diagnosis
  const patchDiag = (patch: Partial<DiagnosisData>) =>
    setAssessment(p => ({ ...p, diagnosis: { ...p.diagnosis, ...patch } }))
  // Toggle: kode yang belum ada → tambah (kode pertama otomatis primer); kode yang
  // sudah ada → batalkan (kalau yang dibatalkan primer, promosikan sisa pertama).
  const toggleIcd = (code: string, display: string) =>
    setAssessment(p => {
      const list = p.diagnosis.icd10_codes
      let next: Icd10Selection[]
      if (list.some(c => c.code === code)) {
        next = list.filter(c => c.code !== code)
        if (next.length && !next.some(c => c.is_primary)) next = next.map((c, i) => ({ ...c, is_primary: i === 0 }))
      } else {
        next = [...list, { code, display, is_primary: list.length === 0 }]
      }
      return { ...p, diagnosis: { ...p.diagnosis, icd10_codes: next } }
    })
  const setPrimaryIcd = (code: string) =>
    setAssessment(p => ({ ...p, diagnosis: { ...p.diagnosis, icd10_codes: p.diagnosis.icd10_codes.map(c => ({ ...c, is_primary: c.code === code })) } }))

  const handleIcdSearch = (q: string) => {
    setIcdQuery(q)
    if (icdTimer.current) clearTimeout(icdTimer.current)
    const term = q.trim()
    if (term.length < 2) { setIcdResults([]); setIcdSearching(false); return }
    setIcdSearching(true)
    icdTimer.current = setTimeout(async () => {
      try {
        const { data } = await supabase
          .from('clinic_icd10')
          .select('code, display')
          .or(orIlike(['code', 'display'], term))
          .limit(15)
        setIcdResults((data ?? []) as { code: string; display: string }[])
      } catch { setIcdResults([]) }
      finally { setIcdSearching(false) }
    }, 300)
  }

  // ── Plan helpers ──────────────────────────────────────────────────────────
  const plan = assessment.plan
  const patchPlan = (patch: Partial<PlanData>) =>
    setAssessment(p => ({ ...p, plan: { ...p.plan, ...patch } }))

  // Gender pasien menentukan file gambar; selain 'male'/'female' (atau kosong) → default 'male'.
  const patientGender: 'male' | 'female' = selectedVisit?.patient?.gender === 'female' ? 'female' : 'male'
  const bodyImageKey = `${bodyView}-${patientGender}`
  const bodyExtTried = bodyExtIndex[bodyImageKey] ?? 0
  // Semua ekstensi sudah dicoba dan gagal → pakai siluet SVG.
  const bodyImageFailed = bodyExtTried >= BODY_IMAGE_EXTS.length
  const bodyImageSrc = bodyImageFailed ? '' : `/images/body-diagram/${bodyImageKey}.${BODY_IMAGE_EXTS[bodyExtTried]}`

  const handleSaveAssessment = async (): Promise<boolean> => {
    if (!selectedVisit?.id || !selectedVisit?.patient?.full_name) return false
    // Keluhan Utama wajib diisi (validasi client-side sebelum simpan).
    if (!assessment.subjective.chief_complaint.trim()) {
      setAssessmentError('Keluhan Utama wajib diisi.')
      return false
    }
    if (!assessment.diagnosis.text.trim()) {
      setAssessmentError('Diagnosa wajib diisi.')
      return false
    }
    if (assessment.diagnosis.icd10_codes.length === 0) {
      setAssessmentError('Minimal 1 kode ICD-10 wajib dipilih.')
      return false
    }
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
        <h2 className="page-title">Panel EMR</h2>
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
              color: tab === t ? 'var(--red)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--red)' : '2px solid transparent',
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
            <div style={{ background: 'var(--bg-deep)', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 11, letterSpacing: 1 }}>KUNJUNGAN</div>
                <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 15 }}>
                  {selectedVisit.patient?.full_name} · {selectedVisit.patient?.patient_code}
                </div>
                <div style={{ color: 'var(--text-secondary)', fontSize: 12, marginTop: 2 }}>
                  {selectedVisit.services.map(s => s.service_name).join(' · ') || '-'} · {fmtTime(selectedVisit.visit_time ?? '')}
                </div>
              </div>
              <button onClick={() => setShowVisitModal(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer' }}>×</button>
            </div>

            {/* Tab Bar */}
            <div style={{ display: 'flex', borderBottom: '2px solid var(--border)', background: 'var(--bg-deep)', flexShrink: 0 }}>
              {(['screening', 'consent', 'assessment', 'riwayat'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setModalTab(t)}
                  style={{
                    padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
                    fontWeight: modalTab === t ? 700 : 400,
                    color: modalTab === t ? 'var(--red)' : 'var(--text-muted)',
                    borderBottom: modalTab === t ? '2px solid var(--red)' : '2px solid transparent',
                    marginBottom: -2, textTransform: 'capitalize',
                  }}
                >
                  {t === 'screening' ? 'Screening' : t === 'consent' ? 'Consent' : t === 'assessment' ? 'Assessment' : 'Riwayat'}
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
                      <div style={{ marginBottom: 12, padding: 12, background: '#FFF5F5', borderRadius: 8, borderLeft: '3px solid var(--red)' }}>
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
                            <span style={{ fontWeight: 700, color: val ? 'var(--red)' : '#065F46' }}>{val ? 'Ya' : 'Tidak'}</span>
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
                            Intensitas Nyeri: <strong style={{ color: screeningData.msk_intensity >= 7 ? 'var(--red)' : screeningData.msk_intensity >= 4 ? '#F59E0B' : '#065F46' }}>{screeningData.msk_intensity}/10</strong>
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

                    {/* ── Subjective (terstruktur) ──────────────────────────────────── */}
                    <div style={{ marginBottom: 18 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(59,130,246,0.15)', color: '#93C5FD', fontSize: 12, fontWeight: 700 }}>Keluhan Subjektif Pasien</span>
                      </label>

                      <EmrBlock label="Data Kesehatan">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, alignItems: 'start' }}>
                          <div>
                            <label style={emrSubLabel}>Golongan Darah</label>
                            <select value={subj.general.blood_type} onChange={e => patchGeneral({ blood_type: e.target.value })} style={emrField}>
                              <option value="">— Pilih —</option>
                              {BLOOD_TYPE_OPTIONS.map(b => <option key={b} value={b}>{b}</option>)}
                            </select>
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 22 }}>
                            <CheckRow label="Merokok" checked={subj.general.is_smoker} onChange={v => patchGeneral({ is_smoker: v })} />
                            <CheckRow label="Hamil" checked={subj.general.is_pregnant} onChange={v => patchGeneral({ is_pregnant: v })} />
                            <CheckRow label="Menyusui" checked={subj.general.is_lactating} onChange={v => patchGeneral({ is_lactating: v })} />
                          </div>
                        </div>
                      </EmrBlock>

                      <EmrBlock label={<>Keluhan Utama <span style={{ color: 'var(--red)' }}>*</span></>}>
                        <textarea
                          value={subj.chief_complaint}
                          onChange={e => patchSubj({ chief_complaint: e.target.value })}
                          placeholder="Keluhan utama pasien saat ini..."
                          rows={3}
                          style={{ ...emrField, resize: 'vertical' }}
                        />
                      </EmrBlock>

                      <EmrBlock label="Riwayat Penyakit">
                        <MultiCheck options={ILLNESS_HISTORY_OPTIONS} value={subj.illness_history} onChange={v => patchSubj({ illness_history: v })} />
                        <div style={{ marginTop: 10 }}>
                          <label style={emrSubLabel}>Lainnya</label>
                          <input type="text" value={subj.illness_other} onChange={e => patchSubj({ illness_other: e.target.value })} placeholder="Riwayat penyakit lain..." style={emrField} />
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <label style={emrSubLabel}>Catatan</label>
                          <textarea value={subj.illness_notes} onChange={e => patchSubj({ illness_notes: e.target.value })} rows={2} placeholder="Catatan riwayat penyakit..." style={{ ...emrField, resize: 'vertical' }} />
                        </div>
                      </EmrBlock>

                      <EmrBlock label="Riwayat Alergi Obat">
                        <textarea value={subj.drug_allergies} onChange={e => patchSubj({ drug_allergies: e.target.value })} rows={2} placeholder="Tulis alergi obat yang diketahui..." style={{ ...emrField, resize: 'vertical' }} />
                      </EmrBlock>

                      <EmrBlock label="Riwayat Alergi Lainnya">
                        <MultiCheck options={OTHER_ALLERGY_OPTIONS} value={subj.other_allergies} onChange={v => patchSubj({ other_allergies: v })} />
                        <div style={{ marginTop: 10 }}>
                          <label style={emrSubLabel}>Lainnya</label>
                          <input type="text" value={subj.allergy_other} onChange={e => patchSubj({ allergy_other: e.target.value })} placeholder="Alergi lain..." style={emrField} />
                        </div>
                        <div style={{ marginTop: 10 }}>
                          <label style={emrSubLabel}>Catatan</label>
                          <textarea value={subj.allergy_notes} onChange={e => patchSubj({ allergy_notes: e.target.value })} rows={2} placeholder="Catatan alergi..." style={{ ...emrField, resize: 'vertical' }} />
                        </div>
                      </EmrBlock>

                      <EmrBlock label="Isian Tambahan">
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <select value={newNoteType} onChange={e => setNewNoteType(e.target.value as AdditionalNoteType)} style={{ ...emrField, width: 'auto', minWidth: 160 }}>
                            {ADDITIONAL_NOTE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                          </select>
                          <button type="button" className="btn-secondary" onClick={addNote} style={{ width: 'auto', padding: '8px 16px' }}>+ Tambah</button>
                        </div>
                        {subj.additional_notes.length === 0 ? (
                          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>Belum ada isian tambahan.</p>
                        ) : subj.additional_notes.map((n, i) => (
                          <div key={i} style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                              <span className="badge" style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                                {ADDITIONAL_NOTE_TYPES.find(t => t.value === n.type)?.label ?? n.type}
                              </span>
                              <button type="button" onClick={() => removeNote(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>Hapus</button>
                            </div>
                            <textarea value={n.value} onChange={e => updateNote(i, e.target.value)} rows={2} placeholder="Isi catatan..." style={{ ...emrField, resize: 'vertical' }} />
                          </div>
                        ))}
                      </EmrBlock>
                    </div>

                    {/* ── Objective (terstruktur) — Tahap A ─────────────────────────── */}
                    <div style={{ marginBottom: 18 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(5,150,105,0.15)', color: '#34D399', fontSize: 12, fontWeight: 700 }}>Temuan Pemeriksaan Fisik</span>
                      </label>

                      {obj.legacy_text && (
                        <div style={{ marginBottom: 12, padding: 10, border: '1px dashed var(--border-strong)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>Catatan lama (sebelum form terstruktur)</div>
                          <div style={{ fontSize: 13, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>{obj.legacy_text}</div>
                        </div>
                      )}

                      <EmrBlock label="Status Kesadaran">
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          {CONSCIOUSNESS_OPTIONS.map(lvl => (
                            <label key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                              <input type="radio" name="consciousness" checked={obj.consciousness === lvl} onChange={() => patchObj({ consciousness: lvl })} style={{ width: 'auto', accentColor: 'var(--red)' }} />
                              {lvl}
                            </label>
                          ))}
                        </div>
                      </EmrBlock>

                      <EmrBlock label="Vital Signs">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
                          {([
                            { k: 'temperature', label: 'Suhu', unit: 'celcius', step: '0.1' },
                            { k: 'systolic', label: 'Sistole', unit: 'mmHg', step: '1' },
                            { k: 'diastolic', label: 'Diastole', unit: 'mmHg', step: '1' },
                            { k: 'pulse', label: 'Nadi', unit: '/menit', step: '1' },
                            { k: 'respiratory_rate', label: 'Frekuensi Pernafasan', unit: '/menit', step: '1' },
                          ] as const).map(({ k, label, unit, step }) => (
                            <div key={k}>
                              <label style={emrSubLabel}>{label}</label>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <input type="number" step={step} value={vitals[k] ?? ''} onChange={e => patchVital(k, e.target.value)} placeholder="-" style={{ ...emrField, flex: 1 }} />
                                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', minWidth: 52 }}>{unit}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </EmrBlock>

                      <EmrBlock label="Pemeriksaan Fisik">
                        <BodyPartStatusList
                          parts={SPORTS_BODY_PARTS}
                          value={obj.physical_exam}
                          onChange={next => patchObj({ physical_exam: next.map(n => ({ part: n.part, status: n.status, notes: n.notes ?? '' })) })}
                          showNotes
                        />
                      </EmrBlock>

                      {/* ── Pain Assessment — Tahap B ──────────────────────────────── */}
                      <EmrBlock label="Pain Assessment">
                        {/* NRS Score — pola D.4 Intensitas Nyeri (ClinicTriase:684-696) */}
                        <label style={emrSubLabel}>NRS Score (0–10)</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <input type="range" min={0} max={10} value={pain.nrs_score ?? 0}
                            onChange={e => patchPain({ nrs_score: Number(e.target.value) })}
                            style={{ flex: 1, accentColor: pain.nrs_score != null ? intensityColor(pain.nrs_score) : '#9CA3AF' }} />
                          <span style={{ minWidth: 40, textAlign: 'center', fontWeight: 700, fontSize: 16, color: pain.nrs_score != null ? intensityColor(pain.nrs_score) : 'var(--text-muted)' }}>{pain.nrs_score ?? '-'}</span>
                        </div>
                        <div style={{ height: 6, borderRadius: 4, marginTop: 6, background: 'linear-gradient(to right, #16A34A, #CA8A04, #EA580C, #DC2626)' }} />
                        {pain.nrs_score != null && pain.nrs_score >= 8 && (
                          <div style={{ marginTop: 8, padding: 10, background: '#FEE2E2', border: '1px solid #DC2626', borderRadius: 8, color: '#991B1B', fontSize: 13 }}>
                            ⚠ Intensitas nyeri sangat berat — wajib konsultasi dokter.
                          </div>
                        )}

                        <div style={{ marginTop: 14 }}>
                          <label style={emrSubLabel}>Lokasi Nyeri</label>
                          <BodyPartStatusList
                            parts={SPORTS_BODY_PARTS}
                            value={pain.locations}
                            onChange={next => patchPain({ locations: next.map(n => ({ part: n.part, status: n.status })) })}
                            showNotes={false}
                          />
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10, marginTop: 14 }}>
                          <div>
                            <label style={emrSubLabel}>Penyebab Nyeri</label>
                            <input type="text" value={pain.cause} onChange={e => patchPain({ cause: e.target.value })} placeholder="Penyebab nyeri..." style={emrField} />
                          </div>
                          <div>
                            <label style={emrSubLabel}>Durasi Nyeri</label>
                            <input type="text" value={pain.duration} onChange={e => patchPain({ duration: e.target.value })} placeholder="mis. 3 hari / 2 minggu..." style={emrField} />
                          </div>
                        </div>

                        <div style={{ marginTop: 14 }}>
                          <label style={emrSubLabel}>Frekuensi Nyeri</label>
                          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                            {PAIN_FREQUENCY_OPTIONS.map(f => (
                              <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                                <input type="radio" name="pain_frequency" checked={pain.frequency === f} onChange={() => patchPain({ frequency: f })} style={{ width: 'auto', accentColor: 'var(--red)' }} />
                                {f}
                              </label>
                            ))}
                          </div>
                        </div>
                      </EmrBlock>

                      {/* ── Diagram Tubuh — Tahap C ────────────────────────────────── */}
                      <EmrBlock label="Diagram Tubuh">
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, alignItems: 'start' }}>
                          <div>
                            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
                              {(['front', 'back'] as const).map(v => {
                                const on = bodyView === v
                                return (
                                  <button type="button" key={v} onClick={() => setBodyView(v)}
                                    style={{ padding: '6px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 13, border: '1px solid',
                                      borderColor: on ? 'var(--red)' : 'var(--border-strong)', background: on ? 'var(--red)' : 'transparent',
                                      color: on ? '#fff' : 'var(--text-secondary)', fontWeight: on ? 700 : 400 }}>
                                    {v === 'front' ? 'Depan' : 'Belakang'}
                                  </button>
                                )
                              })}
                            </div>
                            <div style={{ maxWidth: 260, margin: '0 auto', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-input)', padding: 8 }}>
                              {/* Kotak referensi koordinat — rasio dikunci 200:500 (2:5), sama dgn viewBox SVG.
                                  Gambar asli & siluet SVG mengisi kotak yang PERSIS sama, jadi posisi titik
                                  (persen x/y) identik di kedua mode. */}
                              <div style={{ position: 'relative', width: '100%', aspectRatio: '200 / 500' }}>
                                {!bodyImageFailed && (
                                  <img
                                    key={bodyImageSrc}
                                    src={bodyImageSrc}
                                    alt=""
                                    onError={() => setBodyExtIndex(m => ({ ...m, [bodyImageKey]: (m[bodyImageKey] ?? 0) + 1 }))}
                                    style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'fill', display: 'block', pointerEvents: 'none' }}
                                  />
                                )}
                                <svg viewBox="0 0 200 500" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', cursor: assessmentLocked ? 'default' : 'crosshair' }} onClick={handleDiagramClick}>
                                {/* Fallback: siluet SVG hanya digambar kalau gambar asli belum ada / gagal dimuat. */}
                                {bodyImageFailed && <BodySilhouette view={bodyView} />}
                                {viewPoints.map((p, i) => (
                                  <g key={p.id} style={{ cursor: assessmentLocked ? 'default' : 'pointer' }}
                                    onClick={ev => { ev.stopPropagation(); if (!assessmentLocked) setPointDraft({ ...p, isNew: false }) }}>
                                    <circle cx={(p.x / 100) * 200} cy={(p.y / 100) * 500} r={11} fill="var(--red)" stroke="#fff" strokeWidth={2} />
                                    <text x={(p.x / 100) * 200} y={(p.y / 100) * 500 + 4} textAnchor="middle" fontSize={12} fontWeight={700} fill="#fff">{i + 1}</text>
                                  </g>
                                ))}
                                </svg>
                              </div>
                            </div>
                            <p style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', marginTop: 6 }}>
                              Klik pada diagram untuk menambah titik. Klik titik untuk mengubah.
                            </p>
                          </div>

                          <div>
                            <label style={emrSubLabel}>Daftar Titik ({obj.body_points.length})</label>
                            {obj.body_points.length === 0 ? (
                              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 0' }}>Belum ada titik.</p>
                            ) : (['front', 'back'] as const)
                              .flatMap(v => obj.body_points.filter(p => p.view === v).map((p, i) => ({ p, v, n: i + 1 })))
                              .map(({ p, v, n }) => (
                                <div key={p.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                                  <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 999, background: 'var(--red)', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{n}</span>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                                      {p.part_label || '(tanpa nama)'}
                                      <span className="badge" style={{ marginLeft: 8, background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>{v === 'front' ? 'Depan' : 'Belakang'}</span>
                                    </div>
                                    {p.notes && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2, whiteSpace: 'pre-wrap' }}>{p.notes}</div>}
                                  </div>
                                  <button type="button" onClick={() => deletePoint(p.id)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Hapus</button>
                                </div>
                              ))}
                          </div>
                        </div>
                      </EmrBlock>

                      {/* ── Skala Risiko Jatuh — Tahap D (opsional, default tertutup) ── */}
                      <Collapsible title="Skala Risiko Jatuh (opsional)">
                        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                          <div style={{ flex: '1 1 160px' }}>
                            <label style={emrSubLabel}>Waktu Tes (detik)</label>
                            <input type="number" step="0.1" min={0} value={obj.fall_risk.test_seconds ?? ''}
                              onChange={e => setFallSeconds(e.target.value === '' ? null : Number(e.target.value))}
                              placeholder="-" style={emrField} />
                          </div>
                          <div style={{ paddingBottom: 9 }}>
                            {obj.fall_risk.risk_level === 'tinggi' ? (
                              <span className="badge" style={{ background: 'var(--red)', color: '#fff' }}>Risiko Tinggi</span>
                            ) : obj.fall_risk.risk_level === 'rendah' ? (
                              <span className="badge" style={{ background: '#DCFCE7', color: '#166534' }}>Risiko Rendah</span>
                            ) : (
                              <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-muted)' }}>-</span>
                            )}
                          </div>
                          <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setFallSeconds(null)}>Atur Ulang</button>
                        </div>
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0', lineHeight: 1.5 }}>
                          Waktu berdiri dari kursi, berjalan ±3 meter, berbalik, duduk kembali. Ambang batas berdasarkan referensi umum — validasikan dengan SOP klinis 20FIT sebelum dipakai untuk keputusan klinis.
                        </p>
                      </Collapsible>
                    </div>

                    {pointDraft && (
                      <div className="modal-overlay" onClick={() => setPointDraft(null)}>
                        <div className="modal-box" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
                          <h3 className="modal-title" style={{ marginTop: 0 }}>{pointDraft.isNew ? 'Tambah Titik' : 'Edit Titik'}</h3>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                            Tampak {pointDraft.view === 'front' ? 'Depan' : 'Belakang'} · x {pointDraft.x.toFixed(1)}% · y {pointDraft.y.toFixed(1)}%
                          </div>

                          <label style={emrSubLabel}>Bagian Tubuh</label>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
                            {SPORTS_BODY_PARTS.map(part => {
                              const on = pointDraft.part_label === part
                              return (
                                <button type="button" key={part} onClick={() => setPointDraft(d => (d ? { ...d, part_label: part } : d))}
                                  style={{ padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, border: '1px solid',
                                    borderColor: on ? 'var(--red)' : 'var(--border-strong)',
                                    background: on ? 'rgba(192,57,43,0.2)' : 'var(--bg-elevated)', color: on ? '#fff' : 'var(--text-secondary)', fontWeight: on ? 600 : 400 }}>{part}</button>
                              )
                            })}
                          </div>
                          <input type="text" value={pointDraft.part_label} onChange={e => setPointDraft(d => (d ? { ...d, part_label: e.target.value } : d))}
                            placeholder="Atau ketik bagian tubuh lain..." style={emrField} />

                          <div style={{ marginTop: 12 }}>
                            <label style={emrSubLabel}>Catatan</label>
                            <textarea value={pointDraft.notes} onChange={e => setPointDraft(d => (d ? { ...d, notes: e.target.value } : d))}
                              rows={3} placeholder="Catatan temuan pada titik ini..." style={{ ...emrField, resize: 'vertical' }} />
                          </div>

                          <div className="modal-footer" style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <div>
                              {!pointDraft.isNew && (
                                <button type="button" onClick={() => deletePoint(pointDraft.id)}
                                  style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 8, padding: '8px 16px', cursor: 'pointer', fontWeight: 600 }}>Hapus</button>
                              )}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setPointDraft(null)}>Batal</button>
                              <button type="button" className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={savePoint}>Simpan</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Clinical Impression / Assessment (dulu satu .map bersama Plan; Plan dipindah
                        ke bawah Diagnosis, markup & perilaku Plan tak berubah) */}
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(245,158,11,0.15)', color: '#FCD34D', fontSize: 12, fontWeight: 700 }}>Clinical Impression / Assessment</span>
                      </label>
                      <textarea
                        value={assessment.assessment}
                        onChange={e => setAssessment(prev => ({ ...prev, assessment: e.target.value }))}
                        placeholder="Diagnosis / clinical impression..."
                        rows={3}
                        style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                      />
                    </div>

                    {/* ── Diagnosis — sebelum Plan ─────────────────────────────────── */}
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(239,68,68,0.15)', color: 'var(--red)', fontSize: 12, fontWeight: 700 }}>Diagnosis</span>
                      </label>

                      <label style={emrSubLabel}>Diagnosa <span style={{ color: 'var(--red)' }}>*</span></label>
                      <textarea
                        value={diag.text}
                        onChange={e => patchDiag({ text: e.target.value })}
                        placeholder="Diagnosa kerja..."
                        rows={2}
                        style={{ ...emrField, resize: 'vertical' }}
                      />

                      <label style={{ ...emrSubLabel, marginTop: 12 }}>ICD-10 (2010) <span style={{ color: 'var(--red)' }}>*</span></label>
                      <div style={{ position: 'relative' }}>
                        <input type="text" value={icdQuery} onChange={e => handleIcdSearch(e.target.value)}
                          placeholder="Ketik kode / nama diagnosis (min. 2 huruf)..." style={emrField} />
                        {icdQuery.trim().length >= 2 && (
                          <div style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, right: 0, marginTop: 4, maxHeight: 260, overflowY: 'auto', background: 'var(--bg-card)', border: '1px solid var(--border-strong)', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.25)' }}>
                            {icdSearching ? (
                              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Mencari…</div>
                            ) : icdResults.length === 0 ? (
                              <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text-muted)' }}>Tidak ada hasil.</div>
                            ) : icdResults.map(r => {
                              const selected = diag.icd10_codes.some(c => c.code === r.code)
                              return (
                                <div key={r.code} onClick={() => toggleIcd(r.code, r.display)}
                                  style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'baseline', background: selected ? 'rgba(192,57,43,0.18)' : 'transparent' }}>
                                  <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-primary)' }}>{r.code}</span>
                                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>{r.display}</span>
                                  {selected && <span style={{ fontSize: 11, color: 'var(--red)', fontWeight: 700, flexShrink: 0 }}>✓ dipilih</span>}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>

                      {diag.icd10_codes.length > 0 && (
                        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {diag.icd10_codes.map(c => (
                            <div key={c.code} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)' }}>
                              <span style={{ fontWeight: 700, fontFamily: 'monospace', fontSize: 12 }}>{c.code}</span>
                              <span style={{ fontSize: 12, color: 'var(--text-secondary)', flex: 1, minWidth: 0 }}>{c.display}</span>
                              <button type="button" onClick={() => setPrimaryIcd(c.code)} title="Jadikan diagnosis primer"
                                className="badge"
                                style={{ cursor: 'pointer', border: 'none', flexShrink: 0, background: c.is_primary ? 'var(--red)' : 'var(--bg-card)', color: c.is_primary ? '#fff' : 'var(--text-muted)', fontWeight: 700 }}>
                                {c.is_primary ? 'Primer' : 'Set Primer'}
                              </button>
                              <button type="button" onClick={() => toggleIcd(c.code, c.display)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Hapus</button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── Rencana / Plan (SOAP: P) ─────────────────────────────────── */}
                    <div style={{ marginBottom: 14 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{ padding: '2px 10px', borderRadius: 999, background: 'rgba(139,92,246,0.15)', color: '#C4B5FD', fontSize: 12, fontWeight: 700 }}>Rencana (Plan)</span>
                      </label>

                      <label style={emrSubLabel}>Rencana Terapi/Tindakan</label>
                      <textarea
                        value={plan.treatment}
                        onChange={e => patchPlan({ treatment: e.target.value })}
                        placeholder="Rencana tindakan, terapi..."
                        rows={3}
                        style={{ ...emrField, resize: 'vertical' }}
                      />

                      <label style={{ ...emrSubLabel, marginTop: 12 }}>Edukasi &amp; Follow-up</label>
                      <textarea
                        value={plan.education_followup}
                        onChange={e => patchPlan({ education_followup: e.target.value })}
                        placeholder="Edukasi pasien, home exercise, instruksi follow-up..."
                        rows={3}
                        style={{ ...emrField, resize: 'vertical' }}
                      />

                      <label style={{ ...emrSubLabel, marginTop: 12 }}>Status Pulang</label>
                      <select
                        value={plan.discharge_status ?? ''}
                        onChange={e => patchPlan({ discharge_status: e.target.value === '' ? null : (e.target.value as DischargeStatus) })}
                        style={emrField}
                      >
                        <option value="">— Pilih —</option>
                        {DISCHARGE_STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>

                      <label style={{ ...emrSubLabel, marginTop: 12 }}>Tanggal Follow-up (opsional)</label>
                      <input
                        type="date"
                        value={assessment.follow_up_date}
                        onChange={e => setAssessment(prev => ({ ...prev, follow_up_date: e.target.value }))}
                        style={emrField}
                      />
                      <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0 0' }}>
                        Catatan internal untuk dokter — bukan membuat janji/booking baru. Untuk menjadwalkan
                        kunjungan follow-up pasien, gunakan alur Close Bill di Kasir.
                      </p>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Ditangani oleh</label>
                      <div style={{
                        padding: '10px 12px',
                        background: 'var(--bg-elevated)',
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        fontSize: 14,
                        color: 'var(--text-secondary)',
                        fontWeight: 500,
                      }}>
                        {assessment.handled_by || user?.full_name || '-'}
                      </div>
                    </div>

                    <div style={{ marginBottom: 14 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>Catatan Tambahan</label>
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

              {/* TAB RIWAYAT - read only */}
              {modalTab === 'riwayat' && (
                <div style={{ padding: '16px 0' }}>
                  {historyLoading ? (
                    <div style={{ textAlign: 'center', padding: 40, color: '#9CA3AF' }}>Memuat riwayat...</div>
                  ) : medicalHistory.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 40 }}>
                      <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
                      <div style={{ color: '#9CA3AF', fontSize: 13 }}>Belum ada riwayat kunjungan sebelumnya</div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                      {medicalHistory.map((h, i) => (
                        <div key={h.visit_id} style={{
                          background: 'var(--bg-card)',
                          border: '1px solid var(--border)',
                          borderRadius: 12,
                          overflow: 'hidden',
                        }}>
                          {/* Header kunjungan */}
                          <div style={{
                            background: 'var(--bg-deep)', padding: '10px 16px',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                          }}>
                            <div>
                              <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 11, color: '#9CA3AF', letterSpacing: 1, textTransform: 'uppercase' }}>
                                Kunjungan #{medicalHistory.length - i}
                              </div>
                              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
                                {new Date(h.visit_date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                                {h.visit_time && ` · ${h.visit_time.slice(0, 5)}`}
                              </div>
                            </div>
                            {h.assessment?.handled_by && (
                              <div style={{ fontSize: 11, color: '#9CA3AF' }}>{h.assessment.handled_by}</div>
                            )}
                          </div>

                          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {/* Keluhan */}
                            {h.chief_complaint && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 4 }}>Keluhan</div>
                                <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{h.chief_complaint}</div>
                              </div>
                            )}

                            {/* Layanan */}
                            {h.services.length > 0 && (
                              <div>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 4 }}>Layanan</div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                  {h.services.map(s => (
                                    <span key={s.service_name} style={{
                                      padding: '3px 10px', borderRadius: 999,
                                      background: 'var(--bg-elevated)', fontSize: 12, color: 'var(--text-secondary)',
                                      fontWeight: 500,
                                    }}>
                                      {s.service_name}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Assessment dokter */}
                            {h.assessment && (
                              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '10px 12px' }}>
                                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: '#9CA3AF', marginBottom: 8 }}>Kesimpulan Dokter</div>

                                {h.assessment.diagnosis && (() => {
                                  const d = h.assessment.diagnosis
                                  const txt = typeof d === 'string'
                                    ? d
                                    : [d.text, (d.icd10_codes ?? []).map(c => c.code).join(', ')].filter(Boolean).join(' — ')
                                  return txt ? (
                                    <div style={{ marginBottom: 6 }}>
                                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--red)' }}>Diagnosis: </span>
                                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{txt}</span>
                                    </div>
                                  ) : null
                                })()}
                                {h.assessment.assessment && (
                                  <div style={{ marginBottom: 6 }}>
                                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Assessment: </span>
                                    <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{h.assessment.assessment}</span>
                                  </div>
                                )}
                                {h.assessment.plan && (() => {
                                  const p = h.assessment.plan
                                  const txt = typeof p === 'string'
                                    ? p
                                    : [p.treatment, p.education_followup].filter(Boolean).join(' — ')
                                  return txt ? (
                                    <div>
                                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)' }}>Plan: </span>
                                      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{txt}</span>
                                    </div>
                                  ) : null
                                })()}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
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
                </div>
              )}
            </div>
          </div>
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

  // Muat daftar default (pasien terurut kunjungan terakhir) — dipakai saat tab dibuka
  // dan saat kotak pencarian dikosongkan lagi.
  const loadDefault = useCallback(async () => {
    setSearching(true)
    try {
      setResults(await fetchRecentPatients())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat daftar pasien')
    } finally {
      setSearching(false)
    }
  }, [])

  // Tab Riwayat Pasien dibuka → langsung tampilkan daftar default (tanpa perlu ngetik).
  useEffect(() => { loadDefault() }, [loadDefault])

  const handleQuery = (val: string) => {
    setQuery(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (!val.trim()) { loadDefault(); return }
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
            <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>{query.trim() ? 'Tidak ada pasien ditemukan.' : 'Belum ada pasien dengan riwayat kunjungan.'}</p>
          ) : results.map(p => (
            <div key={p.id} onClick={() => selectPatient(p)}
              style={{
                background: selectedPatient?.id === p.id ? 'rgba(192,57,43,0.12)' : 'var(--bg-card)',
                border: '1px solid var(--border)', borderLeft: selectedPatient?.id === p.id ? '4px solid var(--red)' : '1px solid var(--border)',
                borderRadius: 10, padding: 12, marginBottom: 8, cursor: 'pointer',
              }}>
              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{p.full_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
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
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{selectedPatient.full_name}</div>
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
                <div key={v.id} style={{ borderTop: '1px solid var(--border)', padding: '10px 0', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
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
