import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { fmtDate, fmtTime } from '../../lib/format'
import {
  listDoctorAssessments, getMedicalResumeBundle,
  type ClinicPatient, type DoctorAssessmentListItem, type MedicalResumeBundle,
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

export default function MedicalResumeModal({ patient, onClose }: {
  patient: ClinicPatient
  onClose: () => void
}) {
  const [list, setList] = useState<DoctorAssessmentListItem[] | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [bundle, setBundle] = useState<MedicalResumeBundle | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    listDoctorAssessments(patient.id)
      .then(rows => {
        setList(rows)
        if (rows.length > 0) setSelectedId(rows[0].assessment_id)
      })
      .catch(e => setError(e instanceof Error ? e.message : 'Gagal memuat daftar assessment'))
  }, [patient.id])

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

  const sel = list?.find(l => l.assessment_id === selectedId)

  return (
    <div className="modal-overlay resume-no-print-overlay" onClick={onClose}
      style={{ overflowY: 'auto', alignItems: 'flex-start', padding: '24px 12px' }}>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .resume-sheet, .resume-sheet * { visibility: visible; }
          .resume-sheet { position: absolute; left: 0; top: 0; width: 100%; max-width: none; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
          .resume-no-print, .resume-no-print-overlay > *:not(.resume-wrap) { display: none !important; }
          .resume-no-print-overlay { position: static !important; overflow: visible !important; padding: 0 !important; background: none !important; }
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
            {bodyPoints.length === 0 && bundle.postureScans.length > 0 && (
              <>
                <div style={{ fontWeight: 700, margin: '8px 0 2px' }}>Analisis Postur (Scan)</div>
                {bundle.postureScans.map((s, i) => (
                  <Row key={i}
                    label={`Tampak ${s.view.charAt(0).toUpperCase() + s.view.slice(1)}`}
                    value={`Bahu ${s.angles.shoulder_tilt_deg ?? '-'}° · Pinggul ${s.angles.hip_tilt_deg ?? '-'}° · Deviasi Lateral ${s.angles.lateral_deviation_deg ?? '-'}°${s.general_note ? ` — ${s.general_note}` : ''}`} />
                ))}
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
            <Row label="Rencana Terapi" value={plan?.treatment || '-'} />
            <Row label="Edukasi & Follow-up" value={plan?.education_followup || '-'} />
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
    </div>
  )
}
