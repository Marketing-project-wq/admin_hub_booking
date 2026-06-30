import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fmtDate, fmtTime, fmtRp } from '@workspace/admin-shared'
import { useIsMobile } from '@workspace/admin-shared'
import {
  getVisit, getPatient,
  type ClinicVisit, type ClinicPatient,
} from '../../lib/clinic'
import { getTransactionByVisit, type ClinicTransaction } from '../../lib/clinicBilling'
import ClinicCloseBillModal from '../../components/clinic/ClinicCloseBillModal'
import ClinicReceiptModal from '../../components/clinic/ClinicReceiptModal'

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

const TABS = ['info'] as const
type Tab = typeof TABS[number]
const TAB_LABEL: Record<Tab, string> = { info: 'Info' }

// ═══════════════════════════════════════════════════════════════════════════════
export default function ClinicVisitDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isMobile = useIsMobile()
  const isDesktop = !isMobile

  const [visit, setVisit] = useState<ClinicVisit | null>(null)
  const [patient, setPatient] = useState<ClinicPatient | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState<Tab>('info')
  const [showCloseBill, setShowCloseBill] = useState(false)
  const [showReceipt, setShowReceipt] = useState(false)
  const [currentTransaction, setCurrentTransaction] = useState<ClinicTransaction | null>(null)

  const loadCore = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const v = await getVisit(id)
      setVisit(v)
      if (v.patient_id) setPatient(await getPatient(v.patient_id))
      setCurrentTransaction(await getTransactionByVisit(id))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data kunjungan')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { loadCore() }, [loadCore])

  if (loading) return <p style={{ color: 'var(--text-muted)', padding: 16 }}>Memuat data...</p>
  if (error) return <p style={{ color: 'var(--red)', padding: 16 }}>{error}</p>
  if (!visit || !id) return <p style={{ padding: 16 }}>Kunjungan tidak ditemukan.</p>

  const tabBarStyle: React.CSSProperties = isDesktop
    ? { display: 'flex', gap: 4, borderBottom: '1px solid var(--border, #E5E7EB)', marginBottom: 20 }
    : {
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 20,
        display: 'flex', background: 'var(--bg-card, #fff)', borderTop: '1px solid var(--border, #E5E7EB)',
        boxShadow: '0 -2px 8px rgba(0,0,0,.06)',
      }

  return (
    <div style={isDesktop ? undefined : { paddingBottom: 64 }}>
      {/* Header — compact, single row */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
        padding: '2px 0 14px', marginBottom: 18, borderBottom: '1px solid var(--border, #E5E7EB)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-secondary" style={{ width: 'auto', padding: '6px 12px' }} onClick={() => navigate('/clinic/visits')}>← Kembali</button>
          <span style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{visit.visit_code}</span>
          <span style={{ color: 'var(--border, #D1D5DB)' }}>|</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{visit.patient?.full_name || patient?.full_name || '-'}</span>
          <StatusBadge status={visit.status} />
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{fmtDate(visit.visit_date)}{visit.visit_time ? ` · ${fmtTime(visit.visit_time)}` : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {visit.payment_status !== 'paid' && (
            <button className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => navigate(`/clinic/visits?edit=${visit.id}`)}>✏️ Edit Kunjungan</button>
          )}
          {visit.payment_status !== 'paid' && (
            <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px', background: '#065F46' }} onClick={() => setShowCloseBill(true)}>💳 Close Bill</button>
          )}
        </div>
      </div>

      {/* Tab bar (top on desktop) */}
      {isDesktop && (
        <div style={tabBarStyle}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: '10px 18px', border: 'none', background: 'none', cursor: 'pointer',
                fontWeight: tab === t ? 700 : 500, fontSize: 14,
                color: tab === t ? 'var(--red)' : 'var(--text-muted)',
                borderBottom: tab === t ? '2px solid var(--red)' : '2px solid transparent',
              }}>{TAB_LABEL[t]}</button>
          ))}
        </div>
      )}

      {/* Tab content */}
      {tab === 'info' && (
        <InfoTab
          visit={visit} patient={patient}
          transaction={currentTransaction}
          onCloseBill={() => setShowCloseBill(true)}
          onViewReceipt={() => setShowReceipt(true)}
        />
      )}

      {/* Tab bar (bottom on mobile) */}
      {!isDesktop && (
        <div style={tabBarStyle}>
          {TABS.map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                flex: 1, padding: '12px 4px', border: 'none', background: 'none', cursor: 'pointer',
                fontWeight: tab === t ? 700 : 500, fontSize: 12,
                color: tab === t ? 'var(--red)' : 'var(--text-muted)',
                borderTop: tab === t ? '2px solid var(--red)' : '2px solid transparent',
              }}>{TAB_LABEL[t]}</button>
          ))}
        </div>
      )}

      {showCloseBill && (
        <ClinicCloseBillModal
          visitId={visit.id}
          patientId={visit.patient_id!}
          patientName={visit.patient?.full_name || patient?.full_name || '-'}
          patientCode={visit.patient?.patient_code || patient?.patient_code || '-'}
          patientPhone={visit.patient?.phone || patient?.phone || ''}
          services={visit.services.map(s => ({ service_id: s.service_id, service_name: s.service_name, price: s.price }))}
          onClose={() => setShowCloseBill(false)}
          onSuccess={(trx) => { setCurrentTransaction(trx); setShowCloseBill(false); setShowReceipt(true); loadCore() }}
        />
      )}
      {showReceipt && currentTransaction && (
        <ClinicReceiptModal transaction={currentTransaction} onClose={() => setShowReceipt(false)} />
      )}
    </div>
  )
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={{ color: '#6B7A99', fontSize: 10, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ color: '#F0F4FF', fontWeight: 500, fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  )
}

// ─── Tab Info ───────────────────────────────────────────────────────────────────
function InfoTab({ visit, patient, transaction, onCloseBill, onViewReceipt }: {
  visit: ClinicVisit; patient: ClinicPatient | null
  transaction: ClinicTransaction | null; onCloseBill: () => void; onViewReceipt: () => void
}) {
  const navigate = useNavigate()

  return (
    <div>
      {/* Ringkasan Kunjungan */}
      <h3 style={{ margin: '0 0 10px', fontSize: 15, fontWeight: 700 }}>Ringkasan Kunjungan</h3>
      <div style={{ background: '#1a2740', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '16px 20px' }}>
          <Info label="Visit Code" value={<span style={{ fontFamily: 'monospace' }}>{visit.visit_code}</span>} />
          <Info label="Tanggal" value={fmtDate(visit.visit_date)} />
          <Info label="Waktu" value={fmtTime(visit.visit_time)} />
          <Info label="Status" value={<StatusBadge status={visit.status} />} />
          <Info label="Pasien" value={visit.patient?.full_name || patient?.full_name || '-'} />
          <Info label="Telepon" value={visit.patient?.phone || patient?.phone || '-'} />
          <Info label="Kode Pasien" value={visit.patient?.patient_code || patient?.patient_code || '-'} />
          <Info label="Layanan" value={visit.services.length
            ? <span style={{ whiteSpace: 'pre-line' }}>{visit.services.map(s => s.service_name).join('\n')}</span>
            : '-'} />
          <Info label="Total Layanan" value={fmtRp(visit.services.reduce((sum, s) => sum + s.price, 0))} />
          <Info label="Ditangani oleh" value={visit.handled_by || '-'} />
          <Info label="Metode Bayar" value={visit.payment_method || '-'} />
          <Info label="Jumlah Bayar" value={fmtRp(visit.payment_amount ?? 0)} />
          <Info label="Status Bayar" value={visit.payment_status || '-'} />
        </div>
      </div>

      {/* Billing */}
      {visit.payment_status === 'paid' ? (
        <div style={{ background: 'rgba(5,150,105,0.1)', border: '1px solid rgba(5,150,105,0.2)', borderRadius: 10, padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, color: '#34D399', fontSize: 15 }}>✓ Lunas</div>
            <div style={{ fontSize: 13, color: '#A8B8D8', marginTop: 4 }}>
              {fmtRp(transaction?.total_amount ?? visit.payment_amount ?? 0)} · {(transaction?.payment_method || visit.payment_method || '-').toUpperCase()}
            </div>
          </div>
          {transaction && (
            <button className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={onViewReceipt}>Lihat Kwitansi</button>
          )}
        </div>
      ) : (
        <div style={{ background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.2)', borderRadius: 10, padding: 16, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ fontSize: 13, color: '#FC8181' }}>Pembayaran belum diselesaikan.</div>
          <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={onCloseBill}>💳 Close Bill</button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        <button className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => navigate('/clinic/visits')}>Kembali ke Visits</button>
        <button className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => alert('Fitur segera hadir')}>Export PDF</button>
      </div>
    </div>
  )
}
