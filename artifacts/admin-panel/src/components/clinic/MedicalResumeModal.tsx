import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { fmtDate, fmtTime } from '../../lib/format'
import {
  listDoctorAssessments, getMedicalResumeBundle,
  type ClinicPatient, type DoctorAssessmentListItem, type MedicalResumeBundle, type ResumePostureScan,
} from '../../lib/clinic'

// Resume Medis — dokumen cetak per assessment dokter. Pola print = ClinicReceiptModal:
// window.print() + @media print (hanya lembar resume yang tercetak; Save as PDF
// bawaan browser = jalur download PDF tanpa library). Lembar SENGAJA putih + teks
// gelap hardcoded (dokumen resmi, tidak ikut dark mode).

// ── Tipe longgar toleran-legacy utk kolom jsonb (pola MedicalHistoryPanel) ──
interface RNote { type?: string; value?: string }
interface RSubjective { chief_complaint?: string | null; additional_notes?: RNote[] | null }
interface RExamItem { part?: string; status?: string; notes?: string }
interface RBodyPoint { view?: string; part_label?: string; notes?: string }
interface RPain { nrs_score?: number | null; locations?: { part?: string; status?: string }[] | null; cause?: string; duration?: string; frequency?: string | null }
interface RObjective {
  consciousness?: string | null
  physical_exam?: RExamItem[] | null
  pain_assessment?: RPain | null
  body_points?: RBodyPoint[] | null
  fall_risk?: { test_seconds?: number | null; risk_level?: string | null } | null
  legacy_text?: string
}
interface RDiagnosis { text?: string | null; icd10_codes?: { code?: string; display?: string; is_primary?: boolean }[] | null }
interface RPlan { treatment?: string | null; education_followup?: string | null; discharge_status?: string | null }
interface RLegacyVitals { temperature?: number | null; systolic?: number | null; diastolic?: number | null; pulse?: number | null; respiratory_rate?: number | null }

const obj = <T,>(raw: unknown): T | null => (raw && typeof raw === 'object' ? (raw as T) : null)

function ageFromDob(dob: string | null): string {
  if (!dob) return '-'
  const b = new Date(dob), now = new Date()
  let y = now.getFullYear() - b.getFullYear()
  const m = now.getMonth() - b.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) y--
  return `${y} tahun`
}

const GENDER_LABEL: Record<string, string> = { male: 'Laki-laki', female: 'Perempuan' }

// ── Foto & analisis postur (read-only, untuk cetak) ──────────────────────────
// Gambar ulang garis bahu/pinggul/plumb + titik/garis anotasi dokter DI ATAS foto,
// mengikuti panel Scan Postur tapi tanpa interaksi. viewBox = dimensi asli foto
// (ditangkap saat <img> load); preserveAspectRatio none aman karena container ikut
// rasio foto (width 100% + height auto) → skala x=y, lingkaran tetap bulat & garis pas.
const POSTURE_LM = { LSH: 11, RSH: 12, LHIP: 23, RHIP: 24, LANK: 27, RANK: 28 }
const fmtDegResume = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}°`
// Paksa cetak grafis latar (swatch warna & bg foto) — stroke/fill SVG sudah tercetak default.
const printExact = { WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties

function PostureShot({ scan, muted, textColor }: { scan: ResumePostureScan; muted: string; textColor: string }) {
  const [dim, setDim] = useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = useState(false)

  const label = scan.view === 'belakang' ? 'Tampak Belakang' : scan.view === 'depan' ? 'Tampak Depan' : `Tampak ${scan.view}`
  const lm = scan.landmarks
  const hasAuto = !scan.is_diagram && lm.length >= 29
  const hidden = new Set(scan.hidden_auto_lines)
  const a = scan.angles
  const idxOf = (id: string) => scan.points.findIndex(p => p.id === id) + 1

  // Label pendek (Bahu/Pinggul/Plumb) — foto resume kecil, biar tiap baris ringkasan
  // sudut muat 1 baris tanpa wrap (nama sama dengan panel Scan Postur).
  const angleRows = hasAuto
    ? [
        { color: '#ef4444', label: 'Bahu', deg: a.shoulder_tilt_deg },
        { color: '#3b82f6', label: 'Pinggul', deg: a.hip_tilt_deg },
        { color: '#22c55e', label: 'Plumb', deg: a.lateral_deviation_deg },
      ].filter(r => typeof r.deg === 'number')
    : []

  const noteItems: string[] = []
  scan.points.forEach((p, i) => { if (p.note) noteItems.push(`Titik ${i + 1}: ${p.note}`) })
  scan.lines.forEach(l => { noteItems.push(`Garis ${idxOf(l.point_a_id)}–${idxOf(l.point_b_id)}: ${fmtDegResume(l.angle_deg)}${l.note ? ` — ${l.note}` : ''}`) })

  return (
    <div style={{ breakInside: 'avoid', border: '1px solid #E5E7EB', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
      <div style={{ fontWeight: 700, fontSize: 11.5, padding: '6px 8px', borderBottom: '1px solid #E5E7EB', color: textColor }}>{label}</div>
      <div style={{ position: 'relative', background: '#000', ...printExact }}>
        {scan.image_url && !failed ? (
          <img src={scan.image_url} alt={`Postur ${label}`}
            onLoad={e => setDim({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
            onError={() => setFailed(true)}
            style={{ width: '100%', display: 'block' }} />
        ) : (
          <div style={{ padding: '28px 8px', textAlign: 'center', color: '#9CA3AF', fontSize: 11, background: '#F3F4F6' }}>Foto tidak tersedia</div>
        )}
        {dim && (hasAuto || scan.points.length > 0) && (() => {
          const w = dim.w, h = dim.h, S = Math.max(w, h), sw = S / 260, r = sw * 1.4
          const P = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h })
          const byId = (id: string) => scan.points.find(p => p.id === id)
          const nodes: React.ReactNode[] = []
          if (hasAuto) {
            const lsh = P(POSTURE_LM.LSH), rsh = P(POSTURE_LM.RSH), lhip = P(POSTURE_LM.LHIP), rhip = P(POSTURE_LM.RHIP), lank = P(POSTURE_LM.LANK), rank = P(POSTURE_LM.RANK)
            const msh = { x: (lsh.x + rsh.x) / 2, y: (lsh.y + rsh.y) / 2 }, mank = { x: (lank.x + rank.x) / 2, y: (lank.y + rank.y) / 2 }
            if (!hidden.has('shoulder')) nodes.push(<line key="sh" x1={lsh.x} y1={lsh.y} x2={rsh.x} y2={rsh.y} stroke="#ef4444" strokeWidth={sw} />)
            if (!hidden.has('hip')) nodes.push(<line key="hp" x1={lhip.x} y1={lhip.y} x2={rhip.x} y2={rhip.y} stroke="#3b82f6" strokeWidth={sw} />)
            if (!hidden.has('plumb')) nodes.push(<line key="pl" x1={msh.x} y1={msh.y} x2={mank.x} y2={mank.y} stroke="#22c55e" strokeWidth={sw} />)
            ;[lsh, rsh, lhip, rhip, lank, rank].forEach((p, i) => nodes.push(
              <circle key={`d${i}`} cx={p.x} cy={p.y} r={r} fill="#fff" stroke="#111" strokeWidth={sw * 0.4} />))
          }
          scan.lines.forEach((l, i) => {
            const pa = byId(l.point_a_id), pb = byId(l.point_b_id)
            if (!pa || !pb) return
            nodes.push(<line key={`ml${i}`} x1={pa.x * w} y1={pa.y * h} x2={pb.x * w} y2={pb.y * h}
              stroke="#f97316" strokeWidth={sw} strokeDasharray={`${S / 60} ${S / 90}`} />)
          })
          scan.points.forEach((p, i) => {
            const rr = S / 70
            nodes.push(<circle key={`mp${i}`} cx={p.x * w} cy={p.y * h} r={rr} fill="#e879f9" stroke="#111" strokeWidth={rr / 4} />)
            nodes.push(<text key={`mt${i}`} x={p.x * w} y={p.y * h - rr * 1.8} textAnchor="middle"
              fontSize={S / 28} fontWeight={700} fill="#e879f9" stroke="#000" strokeWidth={S / 340} paintOrder="stroke">{i + 1}</text>)
          })
          return (
            <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none"
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
              {nodes}
            </svg>
          )
        })()}
      </div>
      {(angleRows.length > 0 || noteItems.length > 0 || scan.general_note) && (
        <div style={{ padding: '6px 8px', fontSize: 11, lineHeight: 1.5 }}>
          {angleRows.map(row => (
            <div key={row.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 12, height: 3, background: row.color, borderRadius: 2, flexShrink: 0, ...printExact }} />
              <span style={{ flex: 1, color: muted }}>{row.label}</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: textColor }}>{fmtDegResume(row.deg)}</span>
            </div>
          ))}
          {scan.general_note && <div style={{ marginTop: angleRows.length ? 4 : 0, color: textColor }}>Catatan: {scan.general_note}</div>}
          {noteItems.map((t, i) => <div key={i} style={{ color: muted }}>{t}</div>)}
        </div>
      )}
    </div>
  )
}

export default function MedicalResumeModal({ patient, initialVisitId, onClose }: {
  patient: ClinicPatient
  initialVisitId?: string
  onClose: () => void
}) {
  const [list, setList] = useState<DoctorAssessmentListItem[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [bundle, setBundle] = useState<MedicalResumeBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Penanda print: selama modal terbuka, #root aplikasi bisa di-display:none saat
  // print (display menghapus RUANG — beda dengan visibility:hidden yang menyisakan
  // ruang kosong dan bikin dokumen "turun" ke tengah/bawah halaman).
  useEffect(() => {
    document.body.classList.add('resume-print-mode')
    return () => document.body.classList.remove('resume-print-mode')
  }, [])

  // Nama file default dialog "Save as PDF" browser mengikuti document.title —
  // set ke "Resume Medis_{Nama}_{Tanggal Kunjungan}" selama data siap. Judul asli
  // ditangkap di awal effect (bukan hardcode) dan dipulihkan di cleanup; React
  // menjalankan cleanup lama SEBELUM effect baru, jadi restore tetap akurat
  // walau user berganti-ganti kunjungan.
  const visitDateForTitle = bundle?.visit?.visit_date ?? null
  useEffect(() => {
    if (!bundle) return
    const originalTitle = document.title
    document.title = `Resume Medis_${patient.full_name}_${fmtDate(visitDateForTitle)}`
      .replace(/[\\/:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
    return () => { document.title = originalTitle }
  }, [bundle, visitDateForTitle, patient.full_name])

  useEffect(() => {
    listDoctorAssessments(patient.id)
      .then(rows => {
        setList(rows)
        if (rows.length > 0) {
          // Kalau dibuka dari kunjungan tertentu (tombol "Lihat Detail" di
          // Riwayat Rekam Medis), preselect assessment kunjungan itu; kalau tidak
          // ada assessment dokter utk kunjungan tsb, fallback ke yang terbaru.
          const match = initialVisitId ? rows.find(r => r.visit_id === initialVisitId) : undefined
          setSelectedId((match ?? rows[0]).assessment_id)
        }
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Gagal memuat daftar assessment'))
  }, [patient.id, initialVisitId])

  useEffect(() => {
    if (!selectedId) { setBundle(null); return }
    let active = true
    setLoading(true)
    getMedicalResumeBundle(selectedId)
      .then(b => { if (active) { setBundle(b); setError('') } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Gagal memuat data resume') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedId])

  const subj = obj<RSubjective>(bundle?.assessment.subjective)
  const o = obj<RObjective>(bundle?.assessment.objective)
  const diag = obj<RDiagnosis>(bundle?.assessment.diagnosis)
  const plan = obj<RPlan>(bundle?.assessment.plan)
  const legacyVitals = obj<RLegacyVitals>(bundle?.assessment.vital_signs)
  const sv = bundle?.screeningVitals ?? null

  // Vital: utamakan screening (sumber terkini sejak migrasi field), fallback legacy dokter.
  const vitalRows: { label: string; value: string }[] = []
  const hasScreeningVitals = !!sv && Object.values(sv).some(v => v !== null && v !== undefined && v !== '')
  if (hasScreeningVitals && sv) {
    if (sv.blood_pressure) vitalRows.push({ label: 'Tekanan Darah', value: `${sv.blood_pressure} mmHg` })
    if (sv.heart_rate != null) vitalRows.push({ label: 'Nadi', value: `${sv.heart_rate} x/menit` })
    if (sv.temperature != null) vitalRows.push({ label: 'Suhu', value: `${sv.temperature} °C` })
    if (sv.spo2 != null) vitalRows.push({ label: 'SpO₂', value: `${sv.spo2} %` })
    if (sv.respiratory_rate != null) vitalRows.push({ label: 'Pernapasan', value: `${sv.respiratory_rate} x/menit` })
    if (sv.weight != null) vitalRows.push({ label: 'Berat Badan', value: `${sv.weight} kg` })
    if (sv.height != null) vitalRows.push({ label: 'Tinggi Badan', value: `${sv.height} cm` })
  } else if (legacyVitals) {
    if (legacyVitals.temperature != null) vitalRows.push({ label: 'Suhu', value: `${legacyVitals.temperature} °C` })
    if (legacyVitals.systolic != null || legacyVitals.diastolic != null)
      vitalRows.push({ label: 'Tekanan Darah', value: `${legacyVitals.systolic ?? '-'}/${legacyVitals.diastolic ?? '-'} mmHg` })
    if (legacyVitals.pulse != null) vitalRows.push({ label: 'Nadi', value: `${legacyVitals.pulse} x/menit` })
    if (legacyVitals.respiratory_rate != null) vitalRows.push({ label: 'Pernapasan', value: `${legacyVitals.respiratory_rate} x/menit` })
  }

  const bodyPoints = (o?.body_points ?? []).filter(p => p && (p.part_label || p.notes))
  const exam = (o?.physical_exam ?? []).filter(e => e && e.part)
  const pain = o?.pain_assessment ?? null
  const painLocs = (pain?.locations ?? []).filter(l => l?.status === 'abnormal').map(l => l.part).filter(Boolean)
  const icd = (diag?.icd10_codes ?? []).filter(c => c && c.code)
  const icdPrimary = icd.find(c => c.is_primary)
  const icdSecondary = icd.filter(c => !c.is_primary)
  const notes = (subj?.additional_notes ?? []).filter(n => n && n.value)

  // Styling lembar — HARDCODE putih/gelap: dokumen resmi tidak ikut tema aplikasi.
  const sheet: React.CSSProperties = { background: '#fff', color: '#111827', maxWidth: 800, width: '100%', margin: '0 auto', padding: '28px 34px', borderRadius: 8, fontSize: 12.5, lineHeight: 1.55 }
  const h: React.CSSProperties = { fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1.5px solid #111827', padding: '10px 0 4px', margin: '14px 0 8px' }
  const lbl: React.CSSProperties = { color: '#4B5563', width: 150, flexShrink: 0 }
  const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div style={{ display: 'flex', gap: 8, padding: '1.5px 0' }}>
      <span style={lbl}>{label}</span>
      <span style={{ flex: 1 }}>: {value ?? '-'}</span>
    </div>
  )
  // Baris untuk teks panjang berbutir (mis. Rencana Terapi yang ditulis "a - b - c"):
  // pecah per baris baru & pemisah " - " jadi daftar rapi; 1 item tampil biasa.
  const ListRow = ({ label, value }: { label: string; value: string | null | undefined }) => {
    const items = (value ?? '').split(/\r?\n|\s+[-–]\s+/).map(s => s.trim()).filter(Boolean)
    return (
      <div style={{ display: 'flex', gap: 8, padding: '1.5px 0', alignItems: 'flex-start' }}>
        <span style={lbl}>{label}</span>
        <span style={{ flex: 1 }}>
          {items.length === 0 ? ': -'
            : items.length === 1 ? `: ${items[0]}`
            : <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}</ul>}
        </span>
      </div>
    )
  }

  const sel = list?.find(l => l.assessment_id === selectedId)

  // PORTAL ke document.body: overlay keluar dari #root DAN dari semua ancestor
  // ber-backdrop-filter/transform (glass styling) yang merusak containing block
  // positioning saat print. Saat print: #root di-display:none (tanpa sisa ruang),
  // overlay direset total jadi flow statis, lembar mengalir dari atas halaman —
  // sekaligus membuat page-break dokumen panjang bekerja normal (posisi absolut
  // pada trik visibility lama bisa memotong konten multi-halaman).
  return createPortal(
    <div className="modal-overlay resume-overlay" onClick={onClose}
      style={{ overflowY: 'auto', padding: '24px 12px' }}>
      <style>{`
        @media print {
          body.resume-print-mode #root { display: none !important; }
          .resume-no-print { display: none !important; }
          .resume-overlay {
            position: static !important; inset: auto !important;
            display: block !important; height: auto !important; min-height: 0 !important;
            overflow: visible !important; padding: 0 !important; background: none !important;
            -webkit-backdrop-filter: none !important; backdrop-filter: none !important;
          }
          .resume-wrap { max-width: none !important; }
          .resume-sheet {
            width: 100% !important; max-width: none !important; margin: 0 !important;
            padding: 0 !important; border-radius: 0 !important; box-shadow: none !important;
          }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>
      <div className="resume-wrap" style={{ width: '100%', maxWidth: 800 }} onClick={e => e.stopPropagation()}>
        {/* Kontrol — tidak ikut tercetak */}
        <div className="resume-no-print" style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            style={{ flex: 1, minWidth: 240, padding: '8px 10px' }}>
            {(list ?? []).map(l => (
              <option key={l.assessment_id} value={l.assessment_id}>
                {fmtDate(l.visit_date)} · {l.visit_code} · {l.handled_by ?? '-'}
              </option>
            ))}
            {list?.length === 0 && <option value="">(tidak ada assessment dokter)</option>}
          </select>
          <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }}
            disabled={!bundle || loading} onClick={() => window.print()}>
            Print / Simpan PDF
          </button>
          <button className="btn-secondary" style={{ width: 'auto', padding: '8px 12px' }} onClick={onClose}>
            <X size={14} style={{ verticalAlign: -2 }} /> Tutup
          </button>
        </div>

        {error && <p className="resume-no-print" style={{ color: 'var(--red)', fontSize: 13 }}>{error}</p>}
        {list !== null && list.length === 0 && (
          <div className="resume-no-print" style={{ background: 'var(--bg-card)', borderRadius: 8, padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
            Pasien ini belum memiliki assessment dokter — resume medis belum bisa dicetak.
          </div>
        )}
        {loading && <p className="resume-no-print" style={{ color: 'var(--text-muted)', fontSize: 13 }}>Memuat data resume…</p>}

        {bundle && !loading && (
          <div className="resume-sheet" style={sheet}>
            {/* Kop surat */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2.5px solid #111827', paddingBottom: 12 }}>
              <img src="/20fit-sports-clinic-black.png" alt="20FIT Sports Clinic" style={{ width: 210, height: 'auto', display: 'block' }} />
              <div style={{ textAlign: 'right', fontSize: 11, color: '#4B5563' }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: '#111827', letterSpacing: 1 }}>RESUME MEDIS</div>
                <div>20FIT Sports Clinic · (021) 20FIT-ID</div>
              </div>
            </div>

            {/* Info Pasien + Pendaftaran */}
            <div style={h}>Informasi Pasien</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24 }}>
              <div>
                <Row label="No. Rekam Medis" value={<span style={{ fontFamily: 'monospace' }}>{patient.patient_code}</span>} />
                <Row label="Nama Lengkap" value={patient.full_name} />
                <Row label="Tanggal Lahir" value={`${fmtDate(patient.date_of_birth)} (${ageFromDob(patient.date_of_birth)})`} />
                <Row label="Jenis Kelamin" value={patient.gender ? (GENDER_LABEL[patient.gender] ?? patient.gender) : '-'} />
              </div>
              <div>
                <Row label="Identitas" value={`${(patient.id_type || '-').toUpperCase()} — ${patient.id_number || '-'}`} />
                <Row label="Telepon" value={patient.phone} />
                <Row label="Alamat" value={patient.address || '-'} />
              </div>
            </div>

            <div style={h}>Informasi Pendaftaran</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24 }}>
              <div>
                <Row label="No. Kunjungan" value={<span style={{ fontFamily: 'monospace' }}>{bundle.visit?.visit_code ?? '-'}</span>} />
                <Row label="Tanggal Kunjungan" value={`${fmtDate(bundle.visit?.visit_date ?? null)}${bundle.visit?.visit_time ? ` · ${fmtTime(bundle.visit.visit_time)}` : ''}`} />
              </div>
              <div>
                <Row label="Layanan" value={bundle.services.map(s => s.service_name).join(', ') || '-'} />
                <Row label="Dokter Pemeriksa" value={bundle.assessment.handled_by ?? '-'} />
              </div>
            </div>

            {/* S */}
            <div style={h}>Subjective</div>
            <Row label="Keluhan Utama" value={subj?.chief_complaint || '-'} />
            {notes.map((n, i) => (
              <Row key={i} label={`Catatan ${n.type ? n.type.charAt(0).toUpperCase() + n.type.slice(1) : 'Tambahan'}`} value={n.value} />
            ))}

            {/* O */}
            <div style={h}>Objective</div>
            {vitalRows.length > 0 ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', columnGap: 24 }}>
                {vitalRows.map(v => <Row key={v.label} label={v.label} value={v.value} />)}
              </div>
            ) : <Row label="Tanda Vital" value="-" />}
            <Row label="Kesadaran" value={o?.consciousness ?? '-'} />
            {o?.legacy_text && <Row label="Catatan Objektif" value={o.legacy_text} />}

            {exam.length > 0 && (
              <>
                <div style={{ fontWeight: 700, margin: '8px 0 2px' }}>Pemeriksaan Fisik</div>
                {exam.map((e, i) => (
                  <Row key={i} label={e.part ?? '-'} value={`${e.status === 'abnormal' ? 'Abnormal' : 'Normal'}${e.notes ? ` — ${e.notes}` : ''}`} />
                ))}
              </>
            )}

            {pain && (pain.nrs_score != null || painLocs.length > 0 || pain.cause || pain.duration) && (
              <>
                <div style={{ fontWeight: 700, margin: '8px 0 2px' }}>Penilaian Nyeri</div>
                {pain.nrs_score != null && <Row label="Skala Nyeri (NRS)" value={`${pain.nrs_score} / 10`} />}
                {painLocs.length > 0 && <Row label="Lokasi Nyeri" value={painLocs.join(', ')} />}
                {pain.cause && <Row label="Penyebab" value={pain.cause} />}
                {pain.duration && <Row label="Durasi" value={pain.duration} />}
                {pain.frequency && <Row label="Frekuensi" value={pain.frequency} />}
              </>
            )}

            {o?.fall_risk?.test_seconds != null && (
              <Row label="Risiko Jatuh (TUG)" value={`${o.fall_risk.test_seconds} detik — ${o.fall_risk.risk_level === 'tinggi' ? 'Risiko Tinggi' : o.fall_risk.risk_level === 'rendah' ? 'Risiko Rendah' : '-'}`} />
            )}

            {/* Anatomi Tubuh: data lama body_points (daftar teks); baru: ringkasan scan postur */}
            {bodyPoints.length > 0 && (
              <>
                <div style={{ fontWeight: 700, margin: '8px 0 2px' }}>Anatomi Tubuh (Titik Perhatian)</div>
                <ol style={{ margin: '2px 0 4px', paddingLeft: 20 }}>
                  {bodyPoints.map((p, i) => (
                    <li key={i}>
                      {p.view === 'back' ? 'Tampak Belakang' : 'Tampak Depan'} · {p.part_label || '(tanpa nama)'}
                      {p.notes ? ` — ${p.notes}` : ''}
                    </li>
                  ))}
                </ol>
              </>
            )}
            {bundle.postureScans.length > 0 && (
              <>
                {/* breakAfter avoid: judul menempel ke baris foto (tidak yatim di bawah halaman).
                    Foto diperkecil (kolom ~120–150px) supaya blok postur muat di sisa halaman —
                    hemat kertas, tidak lagi loncat ke halaman baru dengan banyak ruang kosong. */}
                <div style={{ fontWeight: 700, margin: '10px 0 4px', breakAfter: 'avoid' }}>Foto &amp; Analisis Postur</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 150px))', gap: 10, justifyContent: 'start' }}>
                  {bundle.postureScans.map((s, i) => (
                    <PostureShot key={i} scan={s} muted="#4B5563" textColor="#111827" />
                  ))}
                </div>
              </>
            )}

            {/* A */}
            <div style={h}>Assessment</div>
            <Row label="Diagnosa" value={diag?.text || '-'} />
            {icdPrimary && <Row label="ICD-10 Primer" value={`${icdPrimary.code} — ${icdPrimary.display ?? ''}`} />}
            {icdSecondary.length > 0 && (
              <Row label="ICD-10 Sekunder" value={icdSecondary.map(c => `${c.code} — ${c.display ?? ''}`).join('; ')} />
            )}

            {/* P */}
            <div style={h}>Plan</div>
            <Row label="Layanan / Tindakan" value={bundle.services.map(s => s.service_name).join(', ') || '-'} />
            <ListRow label="Rencana Terapi" value={plan?.treatment} />
            <ListRow label="Edukasi & Follow-up" value={plan?.education_followup} />
            <Row label="Status Pulang" value={plan?.discharge_status || '-'} />

            {/* TTD */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 28 }}>
              <div style={{ textAlign: 'center', minWidth: 220 }}>
                <div style={{ fontSize: 12 }}>Jakarta, {fmtDate(bundle.visit?.visit_date ?? sel?.visit_date ?? null)}</div>
                <div style={{ fontSize: 12 }}>Dokter Pemeriksa,</div>
                <div style={{ height: 64 }} />
                <div style={{ fontWeight: 700, borderTop: '1px solid #111827', paddingTop: 4 }}>
                  {bundle.assessment.handled_by ?? '(………………………………)'}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
