import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDateTime } from '../../lib/format'
import MedicalResumeModal from './MedicalResumeModal'
import { getPatient, type ClinicPatient } from '../../lib/clinic'

// Riwayat Rekam Medis pasien — komponen display MURNI READ-ONLY (tidak ada satu
// pun kontrol tulis). Dipakai tab "Riwayat Rekam Medis" di modal EMR ClinicDokter
// dan modal Triase (akses read-only terapis). Fetch + render dipindahkan verbatim
// dari ClinicDokter (ekstraksi, bukan penulisan ulang).
//
// Tipe longgar & toleran-legacy — cukup untuk kebutuhan render (jsonb baru /
// string legacy / null), sengaja tidak mengimpor tipe SOAP dari ClinicDokter.
interface HistoryDiagnosis { text?: string | null; icd10_codes?: { code: string }[] | null }
interface HistoryPlan { treatment?: string | null; education_followup?: string | null }
interface MedicalHistoryRow {
  visit_id: string
  visit_date: string
  visit_time: string | null
  chief_complaint: string | null
  services: { service_name: string; price: number }[]
  assessment: {
    diagnosis: HistoryDiagnosis | string | null
    plan: HistoryPlan | string | null
    assessment: string | null
    handled_by: string | null
    updated_at: string | null
    locked_by: string | null
  } | null
}

export default function MedicalHistoryPanel({ patientId, currentVisitId }: {
  patientId: string | null
  currentVisitId: string
}) {
  const [history, setHistory] = useState<MedicalHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  // Resume Medis lengkap (tombol "Lihat Detail" per kunjungan). Pasien di-fetch
  // penuh sekali lalu di-cache; resumeVisitId sekaligus jadi penanda modal terbuka.
  const [resumePatient, setResumePatient] = useState<ClinicPatient | null>(null)
  const [resumeVisitId, setResumeVisitId] = useState<string | null>(null)
  const [resumeLoadingId, setResumeLoadingId] = useState<string | null>(null)

  useEffect(() => {
    if (!patientId) { setHistory([]); return }

    const fetchHistory = async () => {
      setLoading(true)
      try {
        // Fetch riwayat kunjungan pasien untuk Riwayat Rekam Medis. Kunjungan
        // saat ini SENGAJA disertakan (tidak di-neq lagi) supaya assessment yang
        // baru disimpan langsung muncul di sini — sesuai permintaan. Selain
        // kunjungan yang sudah paid, kunjungan saat ini selalu ikut (via .or)
        // walau pembayarannya belum diproses di Kasir.
        const { data: visits } = await supabase
          .from('clinic_visits')
          .select(`
            id, visit_date, visit_time, chief_complaint,
            services:clinic_visit_services(service_name, price),
            assessment:clinic_assessments(
              diagnosis, plan, subjective, objective, assessment, handled_by,
              updated_at, locked_by, assessment_type
            )
          `)
          .eq('patient_id', patientId)
          .or(`payment_status.eq.paid,id.eq.${currentVisitId}`)
          .order('visit_date', { ascending: false })
          .order('visit_time', { ascending: false, nullsFirst: false })
          .limit(10)

        const rows: MedicalHistoryRow[] = (visits ?? []).map((v: any) => ({
          visit_id: v.id,
          visit_date: v.visit_date,
          visit_time: v.visit_time,
          chief_complaint: v.chief_complaint,
          services: v.services ?? [],
          assessment: Array.isArray(v.assessment)
            ? (v.assessment.find((a: any) => a?.assessment_type === 'doctor') ?? null)
            : v.assessment,
        }))

        setHistory(rows)
      } catch (e) {
        console.error(e)
      } finally {
        setLoading(false)
      }
    }

    fetchHistory()
  }, [patientId, currentVisitId])

  const openResume = async (visitId: string) => {
    if (!patientId) return
    setResumeLoadingId(visitId)
    try {
      const p = resumePatient ?? await getPatient(patientId)
      setResumePatient(p)
      setResumeVisitId(visitId)
    } catch (e) {
      console.error(e)
    } finally {
      setResumeLoadingId(null)
    }
  }

  return (
    <div style={{ padding: '16px 0' }}>
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>Memuat riwayat...</div>
      ) : history.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Belum ada riwayat kunjungan sebelumnya</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {history.map((h, i) => (
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
                  <div style={{ fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 900, fontStyle: 'italic', fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1, textTransform: 'uppercase' }}>
                    Kunjungan #{history.length - i}
                  </div>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 }}>
                    {new Date(h.visit_date).toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                    {h.visit_time && ` · ${h.visit_time.slice(0, 5)}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {h.assessment?.handled_by && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{h.assessment.handled_by}</div>
                  )}
                  <button
                    className="btn-secondary"
                    onClick={() => openResume(h.visit_id)}
                    disabled={resumeLoadingId === h.visit_id}
                    style={{ width: 'auto', padding: '4px 12px', fontSize: 11, whiteSpace: 'nowrap' }}
                  >
                    {resumeLoadingId === h.visit_id ? 'Memuat…' : 'Lihat Detail'}
                  </button>
                </div>
              </div>

              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* Keluhan */}
                {h.chief_complaint && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Keluhan</div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{h.chief_complaint}</div>
                  </div>
                )}

                {/* Layanan */}
                {h.services.length > 0 && (
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Layanan</div>
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

                {/* Kesimpulan Dokter — tiap bagian jadi blok berlabel sendiri,
                    nilai di baris baru, whiteSpace pre-wrap supaya baris/enter
                    tersimpan tampil rapi (bukan satu paragraf padat). */}
                {h.assessment && (() => {
                  const a = h.assessment!
                  const diagTxt = !a.diagnosis
                    ? ''
                    : typeof a.diagnosis === 'string'
                      ? a.diagnosis
                      : [a.diagnosis.text, (a.diagnosis.icd10_codes ?? []).map(c => c.code).join(', ')].filter(Boolean).join(' — ')
                  const planTxt = !a.plan
                    ? ''
                    : typeof a.plan === 'string'
                      ? a.plan
                      : [a.plan.treatment, a.plan.education_followup].filter(Boolean).join('\n\n')
                  const assessmentTxt = a.assessment ?? ''
                  if (!diagTxt && !assessmentTxt && !planTxt) return null
                  return (
                    <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '12px 14px' }}>
                      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 10 }}>Kesimpulan Dokter</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {diagTxt && <AssessmentField label="Diagnosis" value={diagTxt} accent />}
                        {assessmentTxt && <AssessmentField label="Assessment" value={assessmentTxt} />}
                        {planTxt && <AssessmentField label="Plan" value={planTxt} />}
                      </div>
                      {a.updated_at && (
                        <div style={{ marginTop: 12, paddingTop: 8, borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--text-muted)' }}>
                          Disimpan {fmtDateTime(a.updated_at)}
                          {(a.handled_by || a.locked_by) && ` · oleh ${a.handled_by || a.locked_by}`}
                        </div>
                      )}
                    </div>
                  )
                })()}
              </div>
            </div>
          ))}
        </div>
      )}

      {resumePatient && resumeVisitId && (
        <MedicalResumeModal
          patient={resumePatient}
          initialVisitId={resumeVisitId}
          onClose={() => setResumeVisitId(null)}
        />
      )}
    </div>
  )
}

// Satu bagian Kesimpulan (Diagnosis / Assessment / Plan): label kecil di atas,
// nilai di bawahnya dengan pre-wrap supaya multi-baris terbaca rapi.
function AssessmentField({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: accent ? 'var(--red)' : 'var(--text-muted)', marginBottom: 3 }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{value}</div>
    </div>
  )
}
