import React, { useState, useEffect, useCallback, useRef, useImperativeHandle, forwardRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtTime, fmtDateTime } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { useIsMobile } from '../../hooks/use-mobile'
import {
  getScreeningByVisit, upsertScreening,
  getConsentsByVisit, upsertConsent,
  lockRecord,
  type ClinicConsent, type ClinicVitalSigns,
} from '../../lib/clinic'
import LockBadge from '../../components/clinic/LockBadge'

// ─── Narrow shapes used by the screening/consent forms ───────────────────────────
interface PatientInfo {
  full_name: string
  id_type?: string | null
  id_number?: string | null
  date_of_birth: string | null
  gender: string | null
  address?: string | null
  phone: string
  email?: string | null
  occupation?: string | null
  emergency_contact_name?: string | null
  emergency_contact_phone?: string | null
}
interface VisitRef {
  id: string
  patient_id: string | null
  patient?: { full_name: string } | null
}

// ─── Constants ──────────────────────────────────────────────────────────────────
const SERVICES = [
  'Doctor Consultation', 'Corrective Therapy by Doctor', 'GEA Laser Therapy',
  'Physiotherapy', 'Sport Massage', 'EMS', 'Personal Trainer Session',
]

const PAR_Q = [
  'Apakah dokter pernah menyatakan Anda menderita penyakit jantung ATAU penyakit tekanan darah tinggi?',
  'Apakah Anda pernah merasakan nyeri dada pada saat istirahat, pada waktu melakukan aktivitas sehari-hari ATAU pada waktu melakukan aktivitas fisik?',
  'Dalam 12 bulan terakhir, apakah Anda pernah kehilangan keseimbangan karena pusing ATAU mengalami pingsan?',
  'Apakah dokter pernah mendiagnosis Anda menderita penyakit kronis lain? (selain penyakit jantung atau tekanan darah tinggi)',
  'Apakah Anda saat ini sedang mengonsumsi obat yang diresepkan untuk penyakit kronis?',
  'Apakah Anda saat ini mempunyai masalah tulang, persendian, atau jaringan lunak yang bertambah parah dengan melakukan aktivitas fisik?',
  'Apakah dokter pernah menyatakan Anda hanya boleh melakukan aktivitas fisik yang diawasi secara medis?',
]

const MSK_LOCATION = [
  'Leher', 'Bahu kanan', 'Bahu kiri', 'Punggung atas', 'Punggung bawah', 'Pinggul kanan',
  'Pinggul kiri', 'Lutut kanan', 'Lutut kiri', 'Pergelangan kaki kanan', 'Pergelangan kaki kiri',
  'Siku kanan', 'Siku kiri', 'Pergelangan tangan kanan', 'Pergelangan tangan kiri',
  'Otot paha/hamstring/betis', 'Lainnya',
]
const MSK_CHARACTER = ['Nyeri otot (pegal/kaku)', 'Nyeri sendi/tulang', 'Nyeri menjalar', 'Rasa kebas/kesemutan', 'Rasa lemah/hilang kekuatan']
const MSK_TIMING = ['Setelah olahraga (DOMS)', 'Saat gerakan tertentu', 'Saat istirahat', 'Saat malam hari', 'Setelah trauma', 'Bertahap tanpa trauma']
const MSK_FUNCTION = ['Bisa gerakan penuh tanpa keluhan', 'Bisa gerakan penuh dengan nyeri', 'Terbatas pada gerakan tertentu', 'Tidak bisa menopang beban', 'Aktivitas sehari-hari terganggu']
const MSK_ADDITIONAL = ['Bengkak/memar', 'Panas/kemerahan', 'Bunyi klik/pop', 'Sendi terkunci', 'Tidak ada gejala tambahan']
const MSK_HISTORY = ['Belum pernah diobati', 'Pernah ke dokter umum', 'Dokter spesialis', 'Fisioterapi di tempat lain', 'Pernah MRI/X-Ray/USG', 'Pernah operasi']

const HEALTH_CARDIOVASCULAR = ['Hipertensi', 'Penyakit jantung koroner', 'Gagal jantung', 'Aritmia/gangguan irama jantung', 'Riwayat serangan jantung', 'Riwayat stroke', 'Kolesterol tinggi', 'Tidak ada']
const HEALTH_METABOLIC = ['Diabetes tipe 1', 'Diabetes tipe 2', 'Gangguan tiroid', 'Obesitas', 'Asam urat', 'Tidak ada']
const HEALTH_RESPIRATORY = ['Asma', 'PPOK', 'Sesak napas saat aktivitas', 'Epilepsi/kejang', 'Vertigo', 'Migrain', 'Tidak ada']
const HEALTH_MUSCULOSKELETAL = ['Osteoporosis', 'Osteoarthritis', 'Rheumatoid arthritis', 'Hernia/HNP', 'Skoliosis', 'Cedera ligamen/otot kronis', 'Tidak ada']
const HEALTH_SPECIAL = ['Pacemaker/implan logam', 'Kanker/sedang kemoterapi', 'Gangguan pembekuan darah', 'Penyakit kulit di area treatment', 'Baru selesai operasi (< 3 bulan)', 'Tidak ada']
const HEALTH_FEMALE = ['Sedang hamil', 'Sedang menstruasi', 'Menyusui', 'Menggunakan KB hormonal', 'Tidak ada']
const HEALTH_ALLERGIES = ['Obat-obatan', 'Makanan', 'Latex', 'Plester/perekat', 'Antiseptik', 'Tidak ada']
const ACTIVITY_LEVELS = ['Rendah', 'Sedang', 'Tinggi', 'Atlet']

const CONSENT_TITLE: Record<string, string> = {
  general: 'PERSETUJUAN TINDAKAN MEDIS UMUM',
  data_privacy: 'PERSETUJUAN PENGELOLAAN DATA PRIBADI',
  gea_laser: 'PERSETUJUAN KHUSUS TINDAKAN BERISIKO — GEA Laser Therapy',
  physiotherapy: 'PERSETUJUAN KHUSUS — Physiotherapy (Manual Therapy, Mobilization, Modalitas)',
  sport_massage: 'PERSETUJUAN KHUSUS — Sport Massage',
  ems: 'PERSETUJUAN KHUSUS TINDAKAN BERISIKO — Electro Muscle Stimulation (EMS)',
}

// Structured consent content (headings + bullet/numbered lists) rendered as JSX.
function CSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontWeight: 700, fontSize: 12, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6B7280', marginBottom: 5 }}>{title}</div>
      {children}
    </div>
  )
}
function CPara({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 8px', color: '#374151' }}>{children}</p>
}
function CList({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  if (ordered) {
    return (
      <ol style={{ margin: '4px 0 0', paddingLeft: 20, fontSize: 13, lineHeight: 1.6, color: '#374151' }}>
        {items.map((it, i) => <li key={i} style={{ marginBottom: 3 }}>{it}</li>)}
      </ol>
    )
  }
  return (
    <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, fontSize: 13, lineHeight: 1.6, color: '#374151' }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, marginBottom: 3 }}>
          <span style={{ color: '#C0392B', flexShrink: 0, marginTop: 1, fontSize: 9 }}>●</span>
          <span>{it}</span>
        </li>
      ))}
    </ul>
  )
}

function ConsentContent({ type }: { type: string }) {
  switch (type) {
    case 'gea_laser':
      return (
        <>
          <CSection title="Prosedur">
            <CPara>Terapi menggunakan laser berintensitas tinggi yang diarahkan ke area target untuk pengurangan nyeri, stimulasi perbaikan jaringan, dan pengurangan inflamasi. Durasi 10–20 menit per sesi.</CPara>
          </CSection>
          <CSection title="Manfaat yang diharapkan">
            <CList items={[
              'Pengurangan nyeri dan inflamasi pada area target',
              'Stimulasi penyembuhan jaringan',
              'Peningkatan sirkulasi lokal',
            ]} />
          </CSection>
          <CSection title="Risiko & Efek Samping">
            <CList items={[
              'Rasa hangat atau sensasi ringan pada area terapi (umum, normal)',
              'Kemerahan sementara di kulit (umum, hilang dalam beberapa jam)',
              'Risiko rare: luka bakar ringan (dimitigasi oleh operator dokter terlatih + parameter laser yang terkontrol)',
              'Risiko mata: kerusakan retina jika laser mengenai mata (dimitigasi dengan kacamata pelindung wajib)',
            ]} />
          </CSection>
          <CSection title="Kontraindikasi (Anda TIDAK BOLEH menjalani laser jika):">
            <CList items={[
              'Sedang hamil',
              'Memiliki kanker aktif di area target atau riwayat kanker di area tersebut',
              'Memiliki implan logam di area target',
              'Memiliki kondisi fotosensitif atau sedang mengonsumsi obat fotosensitif',
              'Memiliki infeksi aktif di kulit area target',
              'Epilepsi tidak terkontrol',
            ]} />
          </CSection>
        </>
      )
    case 'ems':
      return (
        <>
          <CSection title="Prosedur">
            <CPara>Stimulasi otot menggunakan impuls listrik frekuensi rendah-menengah melalui elektroda di kulit. Durasi 20–30 menit per sesi.</CPara>
          </CSection>
          <CSection title="Manfaat yang diharapkan">
            <CList items={[
              'Aktivasi otot yang lebih efisien',
              'Perbaikan kekuatan dan endurance otot',
              'Recovery dan conditioning',
            ]} />
          </CSection>
          <CSection title="Risiko & Efek Samping">
            <CList items={[
              'Sensasi geli, kesemutan, atau kontraksi otot yang tidak nyaman (umum, normal)',
              'Iritasi kulit ringan di area elektroda (umum)',
              'Kelelahan otot atau soreness pasca-sesi',
              'Risiko rare: rhabdomyolysis pada intensitas terlalu tinggi (dihindari dengan protokol bertahap)',
            ]} />
          </CSection>
          <CSection title="Kontraindikasi">
            <CList items={[
              'Memiliki pacemaker atau alat medis elektronik tanam lainnya',
              'Sedang hamil',
              'Epilepsi / riwayat kejang',
              'Gangguan kardiovaskular berat',
              'Infeksi akut atau demam',
              'Thrombosis vena dalam / gangguan pembekuan darah',
              'Luka terbuka / iritasi kulit parah di area elektroda',
            ]} />
          </CSection>
        </>
      )
    case 'physiotherapy':
      return (
        <>
          <CSection title="Prosedur">
            <CPara>Fisioterapi mencakup: manual therapy (mobilisasi sendi, soft tissue release), modalitas (TENS, Ultrasound Therapy), exercise therapy, dan edukasi postural.</CPara>
          </CSection>
          <CSection title="Manfaat yang diharapkan">
            <CList items={[
              'Peningkatan range of motion sendi',
              'Pengurangan nyeri dan kekakuan',
              'Perbaikan kekuatan dan stabilitas',
              'Recovery dari cedera dan pencegahan re-injury',
            ]} />
          </CSection>
          <CSection title="Risiko & Efek Samping">
            <CList items={[
              'Nyeri ringan atau soreness pasca-terapi (umum, 1–2 hari)',
              'Memar di area manipulasi atau mobilisasi',
              'Perburukan sementara gejala (treatment reaction)',
              'Risiko rare: cedera ligamen, saraf, atau diseksi arteri pada manipulasi leher (dimitigasi oleh assessment pre-treatment dan pemilihan teknik sesuai kondisi)',
            ]} />
          </CSection>
          <CSection title="Kontraindikasi">
            <CList items={[
              'Osteoporosis berat',
              'Fraktur yang belum sembuh',
              'Infeksi tulang / sendi aktif',
              'Konsumsi pengencer darah dengan risiko perdarahan tinggi',
              'Hipermobilitas sendi ekstrem',
              'Diseksi arteri vertebral (untuk manipulasi leher)',
            ]} />
          </CSection>
        </>
      )
    case 'sport_massage':
      return (
        <>
          <CSection title="Prosedur">
            <CPara>Teknik massage recovery dengan tekanan sedang-dalam pada otot dan jaringan lunak. Durasi 60 atau 90 menit.</CPara>
          </CSection>
          <CSection title="Risiko & Efek Samping">
            <CList items={[
              'Soreness ringan pasca-massage (umum)',
              'Memar di area dengan tekanan tinggi',
              'Reaksi kulit terhadap massage oil (sampaikan alergi Anda sebelumnya)',
            ]} />
          </CSection>
          <CSection title="Kontraindikasi">
            <CList items={[
              'Luka terbuka / infeksi kulit di area target',
              'Demam / infeksi sistemik',
              'Thrombosis vena dalam',
              'Kondisi kulit menular (scabies, jamur, dll)',
              'Trauma akut yang belum dievaluasi (bengkak, memar baru)',
            ]} />
          </CSection>
        </>
      )
    case 'general':
      return (
        <>
          <CPara>Saya yang bertanda tangan di bawah ini, setelah mendapatkan penjelasan dari dokter / physiotherapist / tim medis 20FIT Sports Clinic mengenai:</CPara>
          <CList ordered items={[
            'Diagnosis atau dugaan diagnosis kondisi saya',
            'Tindakan medis / fisioterapi / treatment yang akan dilakukan',
            'Tujuan dan manfaat yang diharapkan',
            'Tata cara dan durasi tindakan',
            'Risiko, efek samping, dan komplikasi yang mungkin terjadi',
            'Alternatif tindakan yang tersedia',
            'Risiko jika tindakan tidak dilakukan',
            'Prognosis / perkiraan hasil',
            'Perkiraan biaya tindakan',
          ]} />
          <div style={{ height: 10 }} />
          <CSection title="Pernyataan Saya:">
            <CList items={[
              'Semua informasi yang saya berikan di formulir ini adalah benar, lengkap, dan sesuai kondisi saya.',
              'Saya memahami bahwa aktivitas olahraga dan tindakan medis memiliki risiko inheren, dan saya berpartisipasi secara sukarela.',
              'Saya memberikan izin kepada tim 20FIT Sports Clinic untuk melakukan program latihan, terapi, assessment, atau tindakan medis sesuai kebutuhan klinis.',
              'Saya memahami bahwa hasil tindakan tidak selalu 100% dapat diprediksi; setiap tubuh merespons treatment secara berbeda.',
              'Saya dapat MENARIK PERSETUJUAN ini kapan saja sebelum atau selama tindakan.',
              'Saya memahami bahwa kelalaian dalam memberikan informasi kesehatan yang akurat dapat meningkatkan risiko komplikasi.',
            ]} />
          </CSection>
        </>
      )
    case 'data_privacy':
      return (
        <>
          <CSection title="Data yang Dikelola:">
            <CList items={[
              'Data identitas: Nama, NIK, Tanggal Lahir, Alamat, Nomor HP, Email',
              'Data rekam medis: anamnesis, pemeriksaan, diagnosis, tindakan, progress',
              'Data pembayaran dan riwayat transaksi',
            ]} />
          </CSection>
          <CSection title="Tujuan Pengelolaan Data:">
            <CList items={[
              'Penyelenggaraan pelayanan medis dan perawatan berkelanjutan',
              'Administrasi billing dan pembayaran',
              'Komunikasi terkait booking, reminder, dan follow-up treatment',
              'Kewajiban pelaporan sesuai regulasi kesehatan',
              'Peningkatan mutu pelayanan',
            ]} />
          </CSection>
          <CSection title="Hak Anda atas Data Pribadi:">
            <CList items={[
              'Hak mengakses data pribadi Anda',
              'Hak meminta pembetulan data yang tidak akurat',
              'Hak meminta penghapusan data (dengan ketentuan regulasi rekam medis)',
              'Hak menarik persetujuan kapan saja',
              'Hak mengajukan keberatan atas penggunaan data untuk tujuan tertentu',
            ]} />
          </CSection>
          <CSection title="Pihak yang Dapat Mengakses Data:">
            <CList items={[
              'Tim medis 20FIT yang terlibat dalam perawatan Anda',
              'Tim administrasi',
              'Pihak asuransi (hanya jika Anda mengajukan klaim, dengan persetujuan terpisah)',
              'Instansi regulator kesehatan sesuai kewajiban hukum',
              'Rumah sakit / dokter rujukan (hanya jika ada rujukan dan dengan persetujuan Anda)',
            ]} />
          </CSection>
        </>
      )
    default:
      return null
  }
}

function consentTypesFor(services: string[]): string[] {
  const set = new Set<string>()
  if (services.includes('GEA Laser Therapy')) set.add('gea_laser')
  if (services.includes('EMS')) set.add('ems')
  if (services.includes('Physiotherapy')) set.add('physiotherapy')
  if (services.includes('Sport Massage')) set.add('sport_massage')
  if (services.length) { set.add('general'); set.add('data_privacy') }
  return ['gea_laser', 'ems', 'physiotherapy', 'sport_massage', 'general', 'data_privacy'].filter(t => set.has(t))
}

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

const ageFromDob = (dob: string | null): string => {
  if (!dob) return '-'
  const d = new Date(dob)
  if (isNaN(d.getTime())) return '-'
  const now = new Date()
  let age = now.getFullYear() - d.getFullYear()
  const mo = now.getMonth() - d.getMonth()
  if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) age--
  return `${age} th`
}

// ─── Reusable bits ────────────────────────────────────────────────────────────
function NoAccess({ children }: { children: React.ReactNode }) {
  return (
    <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
      🔒 {children}
    </div>
  )
}

function Collapsible({ title, defaultOpen = false, children }: { title: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div style={{ background: '#fff', borderLeft: '3px solid #C0392B', borderRadius: 8, padding: 16, marginBottom: 12, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
      <div onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <span style={{ color: '#C0392B', fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase' }}>{title}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ marginTop: 14 }}>{children}</div>}
    </div>
  )
}

function MultiCheck({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) => onChange(value.includes(opt) ? value.filter(o => o !== opt) : [...value, opt])
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
      {options.map(opt => (
        <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={value.includes(opt)} onChange={() => toggle(opt)} style={{ width: 'auto', accentColor: '#C0392B' }} />
          {opt}
        </label>
      ))}
    </div>
  )
}

function ChipSelect({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (opt: string) => onChange(value.includes(opt) ? value.filter(o => o !== opt) : [...value, opt])
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map(opt => {
        const on = value.includes(opt)
        return (
          <button type="button" key={opt} onClick={() => toggle(opt)}
            style={{
              padding: '5px 12px', borderRadius: 999, cursor: 'pointer', fontSize: 12.5, border: '1px solid',
              borderColor: on ? '#C0392B' : 'var(--border, #E5E7EB)',
              background: on ? '#FEE2E2' : '#F3F4F6', color: on ? '#C0392B' : '#6B7280', fontWeight: on ? 600 : 400,
            }}>{opt}</button>
        )
      })}
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: 'var(--text-muted)', fontSize: 10.5, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontWeight: 600, fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  )
}
function Sub({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ marginBottom: 12, border: '1px solid var(--border, #E5E7EB)', borderRadius: 8, padding: 12 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{label}</span>
        <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  )
}

function VitalField({ label, suffix, children }: { label: string; suffix?: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #E5E7EB', borderRadius: 8, padding: '8px 10px', background: '#fff' }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>{label}</div>
      <div style={{ position: 'relative' }}>
        {children}
        {suffix && <span style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', fontSize: 11, color: 'var(--text-muted)', pointerEvents: 'none' }}>{suffix}</span>}
      </div>
    </div>
  )
}
const VITAL_INPUT_STYLE: React.CSSProperties = { width: '100%', paddingRight: 34, border: 'none', borderBottom: '1px solid #E5E7EB', borderRadius: 0, padding: '4px 34px 4px 0', fontSize: 14 }

// ─── Screening ──────────────────────────────────────────────────────────────────
interface ScreeningForm {
  selected_services: string[]
  chief_complaint: string
  vital_signs: ClinicVitalSigns
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
  health_medications: string
  health_allergies: string[]
  health_surgeries: string
  physical_activity_level: string
  physical_activity_type: string
}

const emptyScreening = (): ScreeningForm => ({
  selected_services: [], chief_complaint: '', vital_signs: {}, par_q: {},
  msk_location: [], msk_character: [], msk_timing: [], msk_intensity: null,
  msk_function: [], msk_additional: [], msk_history: [],
  health_cardiovascular: [], health_metabolic: [], health_respiratory: [], health_musculoskeletal: [],
  health_special: [], health_female: [], health_medications: '', health_allergies: [], health_surgeries: '',
  physical_activity_level: '', physical_activity_type: '',
})

function intensityColor(v: number): string {
  if (v <= 2) return '#16A34A'
  if (v <= 5) return '#CA8A04'
  if (v <= 7) return '#EA580C'
  return '#DC2626'
}

function ScreeningTab({ visit, patient, onToast, onSaved, isLocked, recordId, lockedAt, lockedBy, onUnlocked, onRelocked, defaultServices }: {
  visit: VisitRef; patient: PatientInfo | null; onToast: (m: string) => void; onSaved?: () => void
  isLocked: boolean; recordId: string | null; lockedAt: string | null; lockedBy: string | null
  onUnlocked: () => void; onRelocked: () => void; defaultServices?: string[]
}) {
  const { hasPermission, user } = useAuth()
  const navigate = useNavigate()
  const [form, setForm] = useState<ScreeningForm>(emptyScreening())
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const draftKey = `screening_draft_${visit.id}`

  const set = <K extends keyof ScreeningForm>(key: K, val: ScreeningForm[K]) => setForm(prev => ({ ...prev, [key]: val }))
  const setVital = <K extends keyof ClinicVitalSigns>(k: K, v: ClinicVitalSigns[K]) =>
    setForm(prev => ({ ...prev, vital_signs: { ...prev.vital_signs, [k]: v } }))
  const vnum = (s: string): number | undefined => (s === '' ? undefined : Number(s))

  useEffect(() => {
    let active = true
    getScreeningByVisit(visit.id).then(async data => {
      if (!active) return
      if (data) {
        setForm({
          selected_services: data.selected_services ?? [],
          chief_complaint: data.chief_complaint ?? '',
          vital_signs: data.vital_signs ?? {},
          par_q: data.par_q ?? {},
          msk_location: data.msk_location ?? [], msk_character: data.msk_character ?? [],
          msk_timing: data.msk_timing ?? [], msk_intensity: data.msk_intensity ?? null,
          msk_function: data.msk_function ?? [], msk_additional: data.msk_additional ?? [],
          msk_history: data.msk_history ?? [],
          health_cardiovascular: data.health_cardiovascular ?? [], health_metabolic: data.health_metabolic ?? [],
          health_respiratory: data.health_respiratory ?? [], health_musculoskeletal: data.health_musculoskeletal ?? [],
          health_special: data.health_special ?? [], health_female: data.health_female ?? [],
          health_medications: data.health_medications ?? '', health_allergies: data.health_allergies ?? [],
          health_surgeries: data.health_surgeries ?? '',
          physical_activity_level: data.physical_activity_level ?? '',
          physical_activity_type: data.physical_activity_type ?? '',
        })
      } else {
        const draft = localStorage.getItem(draftKey)
        if (draft) {
          try { setForm({ ...emptyScreening(), ...JSON.parse(draft) }) } catch { /* ignore */ }
        } else if (defaultServices && defaultServices.length > 0) {
          // Pre-fill layanan dari visit.services untuk screening baru.
          setForm({ ...emptyScreening(), selected_services: defaultServices })
        }
      }

      // Pre-fill keluhan dari clinic_visits.chief_complaint — hanya jika masih kosong (tidak override isian yang sudah ada).
      try {
        const { data: visitData } = await supabase
          .from('clinic_visits')
          .select('chief_complaint')
          .eq('id', visit.id)
          .single()
        if (active && visitData?.chief_complaint) {
          setForm(prev => (prev.chief_complaint ? prev : { ...prev, chief_complaint: visitData.chief_complaint }))
        }
      } catch { /* silent fail */ }

      if (active) setLoaded(true)
    }).catch(() => setLoaded(true))
    return () => { active = false }
  }, [visit.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-save draft to localStorage every 30s.
  useEffect(() => {
    if (!loaded) return
    const t = window.setInterval(() => {
      localStorage.setItem(draftKey, JSON.stringify(form))
    }, 30000)
    return () => window.clearInterval(t)
  }, [form, loaded, draftKey])

  if (!hasPermission('can_screening')) return <NoAccess>Anda tidak memiliki akses untuk mengisi screening.</NoAccess>

  const services = form.selected_services
  const showMSK = !(services.length > 0 && services.every(s => s === 'Personal Trainer Session'))
  const showHealth = !(services.length > 0 && services.every(s => s === 'Personal Trainer Session' || s === 'Sport Massage'))
  const parQFlags = PAR_Q.map((_, i) => form.par_q[`q${i + 1}`] === true)
  const anyParQYes = parQFlags.some(Boolean)
  const intensity = form.msk_intensity

  const handleSave = async () => {
    setSaving(true); setError('')
    try {
      await upsertScreening({
        visit_id: visit.id,
        patient_id: visit.patient_id!,
        selected_services: form.selected_services,
        chief_complaint: form.chief_complaint || null,
        vital_signs: form.vital_signs,
        par_q: form.par_q,
        msk_location: form.msk_location, msk_character: form.msk_character, msk_timing: form.msk_timing,
        msk_intensity: form.msk_intensity, msk_function: form.msk_function,
        msk_additional: form.msk_additional, msk_history: form.msk_history,
        health_cardiovascular: form.health_cardiovascular, health_metabolic: form.health_metabolic,
        health_respiratory: form.health_respiratory, health_musculoskeletal: form.health_musculoskeletal,
        health_special: form.health_special, health_female: form.health_female,
        health_medications: form.health_medications || null, health_allergies: form.health_allergies,
        health_surgeries: form.health_surgeries || null,
        physical_activity_level: form.physical_activity_level || null,
        physical_activity_type: form.physical_activity_type || null,
      })
      const saved = await getScreeningByVisit(visit.id)
      if (saved?.id && user) await lockRecord('clinic_screenings', saved.id, user.full_name)
      localStorage.removeItem(draftKey)
      onToast('Screening tersimpan')
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan screening')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {recordId && (
        <div style={{ marginBottom: 12 }}>
          <LockBadge isLocked={isLocked} lockedAt={lockedAt} lockedBy={lockedBy} recordId={recordId} table="clinic_screenings" onUnlocked={onUnlocked} onRelocked={onRelocked} />
        </div>
      )}

      <fieldset disabled={isLocked} style={{ border: 'none', padding: 0, margin: 0 }}>

      {/* Section A — Identitas */}
      <Collapsible title="A. Identitas Pasien" defaultOpen>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => navigate('/clinic/patients')}>Edit Pasien</button>
        </div>
        {patient ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px 20px', fontSize: 13 }}>
            <Info label="Nama" value={patient.full_name} />
            <Info label="No. Identitas" value={`${patient.id_type || '-'} · ${patient.id_number || '-'}`} />
            <Info label="Tanggal Lahir" value={`${fmtDate(patient.date_of_birth)} (${ageFromDob(patient.date_of_birth)})`} />
            <Info label="Jenis Kelamin" value={patient.gender || '-'} />
            <Info label="Alamat" value={patient.address || '-'} />
            <Info label="Telepon" value={patient.phone} />
            <Info label="Email" value={patient.email || '-'} />
            <Info label="Pekerjaan" value={patient.occupation || '-'} />
            <Info label="Kontak Darurat" value={patient.emergency_contact_name ? `${patient.emergency_contact_name} (${patient.emergency_contact_phone || '-'})` : '-'} />
          </div>
        ) : <p style={{ color: 'var(--text-muted)' }}>Data pasien tidak tersedia.</p>}
      </Collapsible>

      {/* Section Vital Signs */}
      <Collapsible title="VITAL SIGNS" defaultOpen>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
          <VitalField label="Tekanan Darah"><input type="text" placeholder="120/80" value={form.vital_signs.blood_pressure ?? ''} onChange={e => setVital('blood_pressure', e.target.value)} style={VITAL_INPUT_STYLE} /></VitalField>
          <VitalField label="Heart Rate (bpm)"><input type="number" placeholder="80" value={form.vital_signs.heart_rate ?? ''} onChange={e => setVital('heart_rate', vnum(e.target.value))} style={VITAL_INPUT_STYLE} /></VitalField>
          <VitalField label="Suhu (°C)"><input type="number" step="0.1" placeholder="36.5" value={form.vital_signs.temperature ?? ''} onChange={e => setVital('temperature', vnum(e.target.value))} style={VITAL_INPUT_STYLE} /></VitalField>
          <VitalField label="SpO2 (%)"><input type="number" placeholder="98" value={form.vital_signs.spo2 ?? ''} onChange={e => setVital('spo2', vnum(e.target.value))} style={VITAL_INPUT_STYLE} /></VitalField>
          <VitalField label="Resp. Rate (x/menit)"><input type="number" placeholder="16" value={form.vital_signs.respiratory_rate ?? ''} onChange={e => setVital('respiratory_rate', vnum(e.target.value))} style={VITAL_INPUT_STYLE} /></VitalField>
          <VitalField label="Berat Badan (kg)"><input type="number" step="0.1" placeholder="70" value={form.vital_signs.weight ?? ''} onChange={e => setVital('weight', vnum(e.target.value))} style={VITAL_INPUT_STYLE} /></VitalField>
          <VitalField label="Tinggi Badan (cm)"><input type="number" placeholder="170" value={form.vital_signs.height ?? ''} onChange={e => setVital('height', vnum(e.target.value))} style={VITAL_INPUT_STYLE} /></VitalField>
        </div>
      </Collapsible>

      {/* Section B — Layanan */}
      <Collapsible title="B. Layanan yang Dipilih" defaultOpen>
        <MultiCheck options={SERVICES} value={form.selected_services} onChange={v => set('selected_services', v)} />
        <div className="form-group" style={{ marginTop: 14 }}>
          <label>Keluhan / Tujuan Utama</label>
          <textarea value={form.chief_complaint} onChange={e => set('chief_complaint', e.target.value)} rows={3} />
        </div>
      </Collapsible>

      {/* Section C — PAR-Q */}
      <Collapsible title="C. PAR-Q" defaultOpen>
        {PAR_Q.map((q, i) => {
          const key = `q${i + 1}`
          const val = form.par_q[key] === true
          const answered = form.par_q[key] !== undefined
          return (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border, #F3F4F6)' }}>
              <span style={{ fontSize: 13, flex: 1 }}>{i + 1}. {q}</span>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button type="button" onClick={() => set('par_q', { ...form.par_q, [key]: true })}
                  style={{ padding: '5px 16px', borderRadius: 6, border: '1px solid', cursor: 'pointer',
                    borderColor: val ? '#C0392B' : 'var(--border, #E5E7EB)', background: val ? '#C0392B' : 'transparent', color: val ? '#fff' : 'var(--text-muted)', fontWeight: val ? 700 : 400 }}>Ya</button>
                <button type="button" onClick={() => set('par_q', { ...form.par_q, [key]: false })}
                  style={{ padding: '5px 16px', borderRadius: 6, border: '1px solid', cursor: 'pointer',
                    borderColor: answered && !val ? '#374151' : 'var(--border, #E5E7EB)', background: answered && !val ? '#374151' : 'transparent', color: answered && !val ? '#fff' : 'var(--text-muted)', fontWeight: answered && !val ? 700 : 400 }}>Tidak</button>
              </div>
            </div>
          )
        })}
        {anyParQYes && (
          <div style={{ marginTop: 12, padding: 12, background: '#FEE2E2', border: '1px solid #DC2626', borderRadius: 8, color: '#991B1B', fontSize: 13 }}>
            ⚠ Terdapat jawaban "Ya" pada PAR-Q. Pasien disarankan berkonsultasi dengan dokter sebelum melakukan aktivitas fisik.
          </div>
        )}
      </Collapsible>

      {/* Section D — MSK */}
      {showMSK && (
        <Collapsible title="D. MSK Screening" defaultOpen>
          <Sub label="D.1 Lokasi Nyeri"><ChipSelect options={MSK_LOCATION} value={form.msk_location} onChange={v => set('msk_location', v)} /></Sub>
          <Sub label="D.2 Karakter Nyeri"><ChipSelect options={MSK_CHARACTER} value={form.msk_character} onChange={v => set('msk_character', v)} /></Sub>
          <Sub label="D.3 Waktu Timbul"><ChipSelect options={MSK_TIMING} value={form.msk_timing} onChange={v => set('msk_timing', v)} /></Sub>
          <Sub label="D.4 Intensitas Nyeri (0–10)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <input type="range" min={0} max={10} value={intensity ?? 0} onChange={e => set('msk_intensity', Number(e.target.value))}
                style={{ flex: 1, accentColor: intensity != null ? intensityColor(intensity) : '#9CA3AF' }} />
              <span style={{ minWidth: 40, textAlign: 'center', fontWeight: 700, fontSize: 16, color: intensity != null ? intensityColor(intensity) : 'var(--text-muted)' }}>{intensity ?? '-'}</span>
            </div>
            <div style={{ height: 6, borderRadius: 4, marginTop: 6, background: 'linear-gradient(to right, #16A34A, #CA8A04, #EA580C, #DC2626)' }} />
            {intensity != null && intensity >= 8 && (
              <div style={{ marginTop: 8, padding: 10, background: '#FEE2E2', border: '1px solid #DC2626', borderRadius: 8, color: '#991B1B', fontSize: 13 }}>
                ⚠ Intensitas nyeri sangat berat — wajib konsultasi dokter.
              </div>
            )}
          </Sub>
          <Sub label="D.5 Fungsi & Mobilitas"><ChipSelect options={MSK_FUNCTION} value={form.msk_function} onChange={v => set('msk_function', v)} /></Sub>
          <Sub label="D.6 Gejala Tambahan"><ChipSelect options={MSK_ADDITIONAL} value={form.msk_additional} onChange={v => set('msk_additional', v)} /></Sub>
          <Sub label="D.7 Riwayat Treatment"><ChipSelect options={MSK_HISTORY} value={form.msk_history} onChange={v => set('msk_history', v)} /></Sub>
        </Collapsible>
      )}

      {/* Section E — Riwayat Kesehatan */}
      {showHealth && (
        <Collapsible title="E. Riwayat Kesehatan">
          <Sub label="E.1 Kardiovaskular"><ChipSelect options={HEALTH_CARDIOVASCULAR} value={form.health_cardiovascular} onChange={v => set('health_cardiovascular', v)} /></Sub>
          <Sub label="E.2 Metabolik"><ChipSelect options={HEALTH_METABOLIC} value={form.health_metabolic} onChange={v => set('health_metabolic', v)} /></Sub>
          <Sub label="E.3 Pernapasan & Neurologi"><ChipSelect options={HEALTH_RESPIRATORY} value={form.health_respiratory} onChange={v => set('health_respiratory', v)} /></Sub>
          <Sub label="E.4 Muskuloskeletal"><ChipSelect options={HEALTH_MUSCULOSKELETAL} value={form.health_musculoskeletal} onChange={v => set('health_musculoskeletal', v)} /></Sub>
          <Sub label="E.5 Kondisi Khusus"><ChipSelect options={HEALTH_SPECIAL} value={form.health_special} onChange={v => set('health_special', v)} /></Sub>
          {patient?.gender === 'female' && (
            <Sub label="E.6 Khusus Perempuan"><ChipSelect options={HEALTH_FEMALE} value={form.health_female} onChange={v => set('health_female', v)} /></Sub>
          )}
          <Sub label="E.7 Obat yang Dikonsumsi">
            <textarea value={form.health_medications} onChange={e => set('health_medications', e.target.value)} rows={2} style={{ width: '100%' }} />
          </Sub>
          <Sub label="E.8 Alergi">
            <ChipSelect options={HEALTH_ALLERGIES} value={form.health_allergies} onChange={v => set('health_allergies', v)} />
          </Sub>
          <Sub label="E.9 Riwayat Operasi">
            <textarea value={form.health_surgeries} onChange={e => set('health_surgeries', e.target.value)} rows={2} style={{ width: '100%' }} />
          </Sub>
          <Sub label="E.10 Tingkat Aktivitas Fisik">
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
              {ACTIVITY_LEVELS.map(lvl => (
                <label key={lvl} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input type="radio" name="activity_level" checked={form.physical_activity_level === lvl} onChange={() => set('physical_activity_level', lvl)} style={{ width: 'auto', accentColor: '#C0392B' }} />
                  {lvl}
                </label>
              ))}
            </div>
            <textarea placeholder="Jenis olahraga / aktivitas" value={form.physical_activity_type} onChange={e => set('physical_activity_type', e.target.value)} rows={2} style={{ width: '100%' }} />
          </Sub>
        </Collapsible>
      )}

      </fieldset>

      {/* Sticky footer */}
      {!isLocked && (
        <div style={{
          position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'flex-end', gap: 8,
          padding: '12px 0 4px', marginTop: 16, background: 'var(--bg-card, #fff)', borderTop: '1px solid var(--border, #E5E7EB)',
        }}>
          <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handleSave} disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Screening'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Consent ────────────────────────────────────────────────────────────────────
function ConsentTab({ visit, onToast, onSaved, isLocked, recordId, lockedAt, lockedBy, onUnlocked, onRelocked }: {
  visit: VisitRef; onToast: (m: string) => void; onSaved?: () => void
  isLocked: boolean; recordId: string | null; lockedAt: string | null; lockedBy: string | null
  onUnlocked: () => void; onRelocked: () => void
}) {
  const { hasPermission, user } = useAuth()
  const [services, setServices] = useState<string[]>([])
  const [consents, setConsents] = useState<ClinicConsent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const padRef = useRef<SignaturePadHandle>(null)
  const [agreed, setAgreed] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [reSigning, setReSigning] = useState(false)

  const reload = useCallback(async () => {
    try {
      const [scr, cons] = await Promise.all([getScreeningByVisit(visit.id), getConsentsByVisit(visit.id)])
      setServices(scr?.selected_services ?? [])
      setConsents(cons)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat consent')
    } finally {
      setLoading(false)
    }
  }, [visit.id])

  useEffect(() => { reload() }, [reload])

  useEffect(() => {
    const prev = consents.find(c => c.signed_by_name)?.signed_by_name
    setName(prev || visit.patient?.full_name || '')
  }, [consents, visit.patient])

  if (!hasPermission('can_consent')) return <NoAccess>Anda tidak memiliki akses untuk mengisi consent.</NoAccess>
  if (loading) return <p style={{ color: 'var(--text-muted)' }}>Memuat data...</p>

  const types = consentTypesFor(services)
  const existingSigned = consents.find(c => c.signature_data && c.signed_at) ?? null

  const handleSaveAll = async () => {
    setError('')
    if (types.length === 0) { setError('Belum ada layanan yang dipilih di Screening.'); return }
    if (!agreed) { setError('Centang persetujuan terlebih dahulu.'); return }
    if (!name.trim()) { setError('Nama penandatangan wajib diisi.'); return }
    const sig = padRef.current
    const signature = sig && !sig.isEmpty() ? sig.toDataURL() : (existingSigned?.signature_data ?? null)
    if (!signature) { setError('Tanda tangan wajib diisi.'); return }
    setSaving(true)
    try {
      const signedAt = new Date().toISOString()
      for (const type of types) {
        await upsertConsent({
          visit_id: visit.id, patient_id: visit.patient_id!, consent_type: type,
          is_agreed: true, signature_data: signature, signed_by_name: name.trim(), signed_at: signedAt,
        })
      }
      const saved = await getConsentsByVisit(visit.id)
      if (user) { for (const c of saved) await lockRecord('clinic_consents', c.id, user.full_name) }
      onToast('Semua consent tersimpan')
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menyimpan consent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {types.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)' }}>
          Pilih layanan terlebih dahulu di Screening untuk menampilkan formulir consent.
        </div>
      ) : (
        <>
          {types.map(type => <ConsentCard key={type} type={type} />)}

          <div style={{ background: '#F0FFF4', border: '1px solid #6EE7B7', borderRadius: 10, padding: 20, marginBottom: 16 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 700 }}>✍ Tanda Tangan Persetujuan</h3>
            <p style={{ fontSize: 13, lineHeight: 1.6, marginTop: 0, color: '#374151' }}>
              Dengan menandatangani di bawah ini, saya menyatakan telah membaca dan menyetujui seluruh persetujuan di atas.
            </p>

            {recordId && (
              <div style={{ marginBottom: 12 }}>
                <LockBadge isLocked={isLocked} lockedAt={lockedAt} lockedBy={lockedBy} recordId={recordId} table="clinic_consents" onUnlocked={onUnlocked} onRelocked={onRelocked} />
              </div>
            )}

            {existingSigned && !reSigning ? (
              <div>
                <div style={{ fontSize: 13, color: '#065F46', fontWeight: 600, marginBottom: 8 }}>
                  ✓ Ditandatangani oleh {existingSigned.signed_by_name} pada {fmtDateTime(existingSigned.signed_at)}
                </div>
                {existingSigned.signature_data && (
                  <img src={existingSigned.signature_data} alt="signature" style={{ display: 'block', marginBottom: 12, border: '2px solid #6EE7B7', borderRadius: 8, background: '#fff', maxWidth: 300 }} />
                )}
                {!isLocked && (
                  <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => { setReSigning(true); padRef.current?.clear() }}>Tanda Tangan Ulang</button>
                )}
              </div>
            ) : (
              <>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }}>
                  <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} disabled={isLocked} style={{ width: 'auto', accentColor: '#065F46' }} />
                  Saya telah membaca dan menyetujui seluruh persetujuan di atas
                </label>

                <div className="form-group">
                  <label>Tanda Tangan</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start', pointerEvents: isLocked ? 'none' : 'auto', opacity: isLocked ? 0.6 : 1 }}>
                    <SignaturePad ref={padRef} initial={reSigning ? null : (existingSigned?.signature_data ?? null)} />
                    <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => padRef.current?.clear()}>Clear</button>
                  </div>
                </div>

                <div className="form-group">
                  <label>Nama Penandatangan</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} disabled={isLocked} />
                </div>
              </>
            )}
          </div>

          <div style={{
            position: 'sticky', bottom: 0, display: 'flex', justifyContent: 'flex-end', gap: 8,
            padding: '12px 0 4px', background: 'var(--bg-card, #fff)', borderTop: '1px solid var(--border, #E5E7EB)',
          }}>
            {(!existingSigned || reSigning) && !isLocked && (
              <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handleSaveAll} disabled={saving}>
                {saving ? 'Menyimpan...' : 'Simpan Semua Consent'}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}

interface SignaturePadHandle { toDataURL: () => string; clear: () => void; isEmpty: () => boolean }
const SignaturePad = forwardRef<SignaturePadHandle, { initial?: string | null }>(({ initial }, ref) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const dirty = useRef(false)

  useImperativeHandle(ref, () => ({
    toDataURL: () => canvasRef.current?.toDataURL('image/png') ?? '',
    clear: () => {
      const c = canvasRef.current
      if (!c) return
      const ctx = c.getContext('2d')
      if (ctx) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height) }
      dirty.current = false
    },
    isEmpty: () => !dirty.current,
  }))

  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
    ctx.strokeStyle = '#111'; ctx.lineWidth = 2; ctx.lineCap = 'round'
    if (initial) {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, 0, 0, c.width, c.height); dirty.current = true }
      img.src = initial
    }
  }, [initial])

  const pos = (e: React.MouseEvent | React.TouchEvent) => {
    const c = canvasRef.current!
    const rect = c.getBoundingClientRect()
    const p = 'touches' in e ? e.touches[0] : e
    return { x: (p.clientX - rect.left) * (c.width / rect.width), y: (p.clientY - rect.top) * (c.height / rect.height) }
  }
  const start = (e: React.MouseEvent | React.TouchEvent) => {
    drawing.current = true; dirty.current = true
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.beginPath(); ctx.moveTo(x, y)
  }
  const move = (e: React.MouseEvent | React.TouchEvent) => {
    if (!drawing.current) return
    if ('touches' in e) e.preventDefault()
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = pos(e)
    ctx.lineTo(x, y); ctx.stroke()
  }
  const end = () => { drawing.current = false }

  return (
    <canvas
      ref={canvasRef} width={300} height={150}
      style={{ border: '2px dashed #D1D5DB', borderRadius: 8, background: '#fff', touchAction: 'none', maxWidth: '100%' }}
      onMouseDown={start} onMouseMove={move} onMouseUp={end} onMouseLeave={end}
      onTouchStart={start} onTouchMove={move} onTouchEnd={end}
    />
  )
})
SignaturePad.displayName = 'SignaturePad'

function ConsentCard({ type }: { type: string }) {
  return (
    <div style={{ borderLeft: '4px solid #C0392B', background: '#FAFAFA', padding: 16, marginBottom: 12, borderRadius: 8 }}>
      <h3 style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 700, color: '#C0392B' }}>{CONSENT_TITLE[type] || type}</h3>
      <div style={{ color: '#374151', maxHeight: 320, overflowY: 'auto' }}>
        <ConsentContent type={type} />
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
interface TriaseVisit {
  id: string
  visit_code: string
  visit_date: string
  visit_time: string | null
  status: string
  patient: {
    id: string
    full_name: string
    patient_code: string
    phone: string
    date_of_birth: string | null
    gender: string | null
    id_type: string | null
    id_number: string | null
    address: string | null
    occupation: string | null
    emergency_contact_name: string | null
    emergency_contact_phone: string | null
  } | null
  services: { id: string; service_name: string; price: number; service: { requires_doctor: boolean } | null }[]
}

type ModalTab = 'screening' | 'consent'

interface LockInfo { id: string; isLocked: boolean; lockedAt: string | null; lockedBy: string | null }
interface LockRow { id: string; visit_id: string; is_locked: boolean | null; locked_at: string | null; locked_by: string | null }

const TRIASE_SELECT = `
  id, visit_code, visit_date, visit_time, status,
  patient:clinic_patients(id, full_name, patient_code, phone, date_of_birth, gender, id_type, id_number, address, occupation, emergency_contact_name, emergency_contact_phone),
  services:clinic_visit_services(id, service_name, price, service:clinic_services(requires_doctor))
`

type StepState = 'done' | 'active' | 'todo'
function StepChip({ label, state }: { label: string; state: StepState }) {
  const palette: Record<StepState, React.CSSProperties> = {
    done: { background: '#EAF3DE', color: '#3B6D11', border: '1px solid #C0DD97' },
    active: { background: '#E6F1FB', color: '#185FA5', border: '1px solid #B5D4F4' },
    todo: { background: 'var(--color-background-secondary, #F3F4F6)', color: 'var(--color-text-secondary, #6B7280)', border: '1px solid var(--color-border-tertiary, #E5E7EB)' },
  }
  return <span style={{ ...palette[state], fontSize: 11, padding: '3px 10px', borderRadius: 999, fontWeight: 600, whiteSpace: 'nowrap' }}>{label}</span>
}

export default function ClinicTriase() {
  const isMobile = useIsMobile()
  const [visits, setVisits] = useState<TriaseVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [screeningStatus, setScreeningStatus] = useState<Record<string, boolean>>({})
  const [consentStatus, setConsentStatus] = useState<Record<string, boolean>>({})
  const [screeningInfo, setScreeningInfo] = useState<Record<string, LockInfo>>({})
  const [consentInfo, setConsentInfo] = useState<Record<string, LockInfo>>({})
  const [selectedVisit, setSelectedVisit] = useState<TriaseVisit | null>(null)
  const [modalTab, setModalTab] = useState<ModalTab>('screening')
  const [showModal, setShowModal] = useState(false)
  const [toast, setToast] = useState('')

  const showToastMsg = (msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(''), 3000)
  }

  const fetchVisits = useCallback(async (showSpinner = true) => {
    if (showSpinner) setLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await supabase
        .from('clinic_visits')
        .select(TRIASE_SELECT)
        .eq('visit_date', today)
        .in('status', ['scheduled', 'in_progress', 'completed'])
        .order('visit_time', { ascending: true, nullsFirst: false })
      if (error) throw error
      const rows = (data ?? []) as unknown as TriaseVisit[]
      setVisits(rows)

      const ids = rows.map(v => v.id)
      if (ids.length > 0) {
        const [scrRes, conRes] = await Promise.all([
          supabase.from('clinic_screenings').select('id, visit_id, is_locked, locked_at, locked_by').in('visit_id', ids),
          supabase.from('clinic_consents').select('id, visit_id, is_locked, locked_at, locked_by').in('visit_id', ids),
        ])
        const scrMap: Record<string, boolean> = {}
        const conMap: Record<string, boolean> = {}
        const scrInfo: Record<string, LockInfo> = {}
        const conInfo: Record<string, LockInfo> = {}
        ids.forEach(id => { scrMap[id] = false; conMap[id] = false })

        ;(scrRes.data as LockRow[] | null ?? []).forEach(s => {
          scrMap[s.visit_id] = true
          scrInfo[s.visit_id] = { id: s.id, isLocked: !!s.is_locked, lockedAt: s.locked_at, lockedBy: s.locked_by }
        })

        const conByVisit: Record<string, LockRow[]> = {}
        ;(conRes.data as LockRow[] | null ?? []).forEach(c => {
          conMap[c.visit_id] = true
          if (!conByVisit[c.visit_id]) conByVisit[c.visit_id] = []
          conByVisit[c.visit_id].push(c)
        })
        Object.entries(conByVisit).forEach(([vid, rowsForVisit]) => {
          const allLocked = rowsForVisit.length > 0 && rowsForVisit.every(r => !!r.is_locked)
          const first = rowsForVisit[0]
          conInfo[vid] = { id: first.id, isLocked: allLocked, lockedAt: first.locked_at, lockedBy: first.locked_by }
        })

        setScreeningStatus(scrMap)
        setConsentStatus(conMap)
        setScreeningInfo(scrInfo)
        setConsentInfo(conInfo)
      } else {
        setScreeningStatus({})
        setConsentStatus({})
        setScreeningInfo({})
        setConsentInfo({})
      }
    } catch (e) {
      console.error(e)
    } finally {
      if (showSpinner) setLoading(false)
    }
  }, [])

  useEffect(() => { fetchVisits() }, [fetchVisits])

  // Auto-refresh setiap 60 detik (silent).
  useEffect(() => {
    const t = window.setInterval(() => fetchVisits(false), 60000)
    return () => window.clearInterval(t)
  }, [fetchVisits])

  const openModal = (visit: TriaseVisit, tab: ModalTab) => {
    setSelectedVisit(visit)
    setModalTab(tab)
    setShowModal(true)
  }

  const handleScreeningSaved = () => {
    setModalTab('consent')
    showToastMsg('Screening tersimpan')
    fetchVisits(false)
  }

  const handleConsentSaved = async () => {
    if (!selectedVisit) return
    try {
      await supabase
        .from('clinic_visits')
        .update({ status: 'in_progress', updated_at: new Date().toISOString() })
        .eq('id', selectedVisit.id)
    } catch (e) {
      console.error(e)
    }
    setShowModal(false)
    showToastMsg('Consent tersimpan — pasien siap dokter')
    fetchVisits(false)
  }

  const requiresDoctor = (visit: TriaseVisit): boolean => {
    return visit.services?.some(s => s.service?.requires_doctor === true) ?? false
  }

  const handleSelesaiTreatment = async (visitId: string) => {
    try {
      const { error } = await supabase
        .from('clinic_visits')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', visitId)

      if (error) throw error

      showToastMsg('Treatment selesai — pasien siap ke Kasir')
      fetchVisits(false)
    } catch (e) {
      console.error(e)
      showToastMsg('Gagal update status')
    }
  }

  const visitRef = selectedVisit
    ? { id: selectedVisit.id, patient_id: selectedVisit.patient?.id ?? null, patient: selectedVisit.patient }
    : null

  const today = new Date().toISOString().slice(0, 10)
  const readyCount = visits.filter(v => screeningStatus[v.id] && consentStatus[v.id]).length
  const needScreening = visits.filter(v => !screeningStatus[v.id]).length
  const needConsent = visits.filter(v => screeningStatus[v.id] && !consentStatus[v.id]).length

  return (
    <div>
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h2 className="page-title" style={{ margin: 0 }}>Triase</h2>
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{fmtDate(today)}</span>
        </div>
        {!loading && visits.length > 0 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <span className="badge" style={{ background: '#EAF3DE', color: '#3B6D11' }}>{readyCount} siap dokter</span>
            <span className="badge" style={{ background: '#FEE2E2', color: '#C0392B' }}>{needScreening} perlu screening</span>
            <span className="badge" style={{ background: '#E6F1FB', color: '#185FA5' }}>{needConsent} perlu consent</span>
          </div>
        )}
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Memuat data...</p>
      ) : visits.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
          <p>Tidak ada pasien hari ini</p>
        </div>
      ) : (
        <div>
          {visits.map(v => {
            const scr = !!screeningStatus[v.id]
            const con = !!consentStatus[v.id]
            const selected = showModal && selectedVisit?.id === v.id
            return (
              <div key={v.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 14,
                  background: selected ? '#EFF6FF' : 'var(--color-background-primary, #fff)',
                  border: selected ? '1.5px solid #378ADD' : '0.5px solid var(--color-border-tertiary, #E5E7EB)',
                  borderRadius: 12, padding: '14px 16px', marginBottom: 8,
                  opacity: v.status === 'completed' ? 0.7 : 1,
                }}>
                {/* Waktu */}
                <div style={{ width: 56, flexShrink: 0, fontWeight: 700, fontSize: 14, color: '#374151' }}>
                  {v.visit_time ? fmtTime(v.visit_time) : '—'}
                </div>

                {/* Tengah */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700 }}>{v.patient?.full_name || '-'}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v.patient?.patient_code || '-'}</span>
                    {v.services.length > 0 && (
                      <span style={{ fontSize: 11, padding: '1px 8px', borderRadius: 999, background: '#F3F4F6', color: '#374151' }}>{v.services.map(s => s.service_name).join(', ')}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                    <StepChip label="✓ Terdaftar" state="done" />
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <StepChip label={scr ? '✓ Screening' : '○ Screening'} state={scr ? 'done' : 'active'} />
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <StepChip label={con ? '✓ Consent' : '○ Consent'} state={con ? 'done' : (scr ? 'active' : 'todo')} />
                    <span style={{ color: 'var(--text-muted)' }}>→</span>
                    <StepChip label={scr && con ? '✓ Siap Dokter' : '○ Siap Dokter'} state={scr && con ? 'done' : 'todo'} />
                  </div>
                </div>

                {/* Kanan */}
                <div style={{ flexShrink: 0 }}>
                  {!scr ? (
                    <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => openModal(v, 'screening')}>Isi Screening</button>
                  ) : !con ? (
                    <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px', background: '#1D4ED8' }} onClick={() => openModal(v, 'consent')}>Isi Consent</button>
                  ) : requiresDoctor(v) ? (
                    <span className="badge" style={{ background: '#EAF3DE', color: '#3B6D11' }}>✓ Siap Dokter</span>
                  ) : (
                    <button
                      className="btn-primary"
                      style={{ width: 'auto', padding: '8px 16px', background: '#059669' }}
                      onClick={() => handleSelesaiTreatment(v.id)}
                    >
                      ✓ Selesai Treatment
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal */}
      {showModal && selectedVisit && visitRef && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box"
            style={{ maxWidth: 680, width: isMobile ? '95vw' : '100%', maxHeight: '90vh', overflow: 'hidden', display: 'flex', flexDirection: 'column', padding: 0 }}
            onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ background: '#080808', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: 15 }}>
                  {selectedVisit.patient?.full_name} · {selectedVisit.patient?.patient_code}
                </div>
                <div style={{ color: '#888', fontSize: 12, marginTop: 2 }}>
                  {selectedVisit.services.map(s => s.service_name).join(' · ') || '-'} · {selectedVisit.visit_time ? fmtTime(selectedVisit.visit_time) : '—'}
                </div>
              </div>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', color: '#fff', fontSize: 22, cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>

            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '2px solid #E5E7EB', background: '#fff', flexShrink: 0 }}>
              {(['screening', 'consent'] as const).map(t => (
                <button key={t} onClick={() => setModalTab(t)}
                  style={{
                    padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13,
                    fontWeight: modalTab === t ? 700 : 400,
                    color: modalTab === t ? '#C0392B' : '#6B7280',
                    borderBottom: modalTab === t ? '2px solid #C0392B' : '2px solid transparent',
                    marginBottom: -2, textTransform: 'capitalize',
                  }}>{t === 'screening' ? 'Screening' : 'Consent'}</button>
              ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
              {modalTab === 'screening' ? (
                <ScreeningTab
                  key={`scr-${selectedVisit.id}`}
                  visit={visitRef}
                  patient={selectedVisit.patient}
                  onToast={showToastMsg}
                  onSaved={handleScreeningSaved}
                  isLocked={screeningInfo[selectedVisit.id]?.isLocked ?? false}
                  recordId={screeningInfo[selectedVisit.id]?.id ?? null}
                  lockedAt={screeningInfo[selectedVisit.id]?.lockedAt ?? null}
                  lockedBy={screeningInfo[selectedVisit.id]?.lockedBy ?? null}
                  onUnlocked={() => fetchVisits(false)}
                  onRelocked={() => fetchVisits(false)}
                  defaultServices={selectedVisit.services.map(s => s.service_name)}
                />
              ) : (
                <ConsentTab
                  key={`con-${selectedVisit.id}`}
                  visit={visitRef}
                  onToast={showToastMsg}
                  onSaved={handleConsentSaved}
                  isLocked={consentInfo[selectedVisit.id]?.isLocked ?? false}
                  recordId={consentInfo[selectedVisit.id]?.id ?? null}
                  lockedAt={consentInfo[selectedVisit.id]?.lockedAt ?? null}
                  lockedBy={consentInfo[selectedVisit.id]?.lockedBy ?? null}
                  onUnlocked={() => fetchVisits(false)}
                  onRelocked={() => fetchVisits(false)}
                />
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid #E5E7EB', background: '#fff', display: 'flex', justifyContent: 'flex-start', flexShrink: 0 }}>
              <button className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => setShowModal(false)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24,
          background: '#080808', color: '#fff', padding: '12px 20px', borderRadius: 10, zIndex: 1000,
          fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,.2)',
        }}>{toast}</div>
      )}
    </div>
  )
}
