import React from 'react'
import { fmtRp, fmtDateTime } from '../../lib/format'
import type { ClinicTransaction } from '../../lib/clinicBilling'

interface Props {
  transaction: ClinicTransaction
  onClose: () => void
}

const Divider = () => <div style={{ borderTop: '1px dashed #9CA3AF', margin: '10px 0' }} />

const Row = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 12, marginBottom: 3 }}>
    <span style={{ color: '#374151' }}>{label}</span>
    <span style={{ fontWeight: 600, textAlign: 'right' }}>{value}</span>
  </div>
)

export default function ClinicReceiptModal({ transaction: t, onClose }: Props) {
  const patientName = t.patient?.full_name ?? '-'
  const patientCode = t.patient?.patient_code ?? '-'
  const method = (t.payment_method || '').toLowerCase()
  const isCard = method === 'debit' || method === 'kredit'

  return (
    <div className="modal-overlay receipt-no-print" onClick={onClose}>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .receipt-print-area, .receipt-print-area * { visibility: visible !important; }
          .receipt-print-area { position: absolute !important; left: 0; top: 0; width: 80mm; box-shadow: none !important; margin: 0 !important; padding: 8mm 6mm !important; max-height: none !important; overflow: visible !important; }
          .receipt-no-print { display: none !important; }
        }
      `}</style>

      <div
        className="modal-box receipt-print-area"
        style={{ maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto', fontFamily: 'Georgia, "Times New Roman", serif' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Controls — hidden on print */}
        <div className="receipt-no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <button className="btn-primary" style={{ width: 'auto', padding: '8px 16px' }} onClick={() => window.print()}>🖨 Print Kwitansi</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {/* ── Receipt content ── */}
        {/* Header */}
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800, letterSpacing: 1 }}>20FIT</div>
          <div style={{ fontSize: 12, letterSpacing: 3, color: '#374151', marginTop: -2 }}>SPORTS CLINIC</div>
          <div style={{ fontSize: 11, color: '#6B7280', marginTop: 6 }}>Jl. Sinabung No. 9, Jakarta Selatan</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>(021) 20FIT-ID</div>
        </div>
        <Divider />

        {/* Transaction meta */}
        <Row label="ID TRANSAKSI" value={<span style={{ fontFamily: 'monospace' }}>{t.transaction_code}</span>} />
        <Row label="TANGGAL" value={fmtDateTime(t.created_at)} />
        <Row label="KASIR" value={t.cashier_name || '-'} />
        <Divider />

        {/* Patient */}
        <Row label="PASIEN" value={patientName} />
        <Row label="NO. REKAM MEDIS" value={<span style={{ fontFamily: 'monospace' }}>{patientCode}</span>} />
        <Divider />

        {/* Services table */}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#6B7280', textTransform: 'uppercase', marginBottom: 4 }}>
          <span>Layanan</span><span>Harga</span>
        </div>
        <Row label={t.service_name} value={fmtRp(t.service_price)} />
        {t.discount > 0 && <Row label="Diskon" value={`-${fmtRp(t.discount)}`} />}
        <div style={{ borderTop: '1px solid #374151', margin: '8px 0' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 800 }}>
          <span>TOTAL</span><span>{fmtRp(t.total_amount)}</span>
        </div>
        <Divider />

        {/* Payment */}
        <Row label="METODE PEMBAYARAN" value={(t.payment_method || '-').toUpperCase()} />
        {isCard && (
          <Row label="Kartu" value={`${t.payment_detail?.bank_name || '-'} · **** ${t.payment_detail?.card_last4 || '----'}`} />
        )}
        {method === 'transfer' && t.payment_detail?.transfer_ref && (
          <Row label="Ref" value={t.payment_detail.transfer_ref} />
        )}
        <Divider />

        {/* Signatures */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginTop: 18, fontSize: 12 }}>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ color: '#374151' }}>Kasir</div>
            <div style={{ borderBottom: '1px solid #9CA3AF', height: 40 }} />
            <div style={{ marginTop: 4, fontWeight: 600 }}>{t.cashier_name || '-'}</div>
          </div>
          <div style={{ flex: 1, textAlign: 'center' }}>
            <div style={{ color: '#374151' }}>Pasien</div>
            <div style={{ borderBottom: '1px solid #9CA3AF', height: 40 }} />
            <div style={{ marginTop: 4, fontWeight: 600 }}>{patientName}</div>
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 10.5, color: '#6B7280', marginTop: 18, lineHeight: 1.6 }}>
          <div>Terima kasih telah mempercayai layanan 20FIT Sports Clinic</div>
          <div>Kwitansi ini sah tanpa tanda tangan basah jika pembayaran dilakukan secara digital</div>
        </div>
      </div>
    </div>
  )
}
