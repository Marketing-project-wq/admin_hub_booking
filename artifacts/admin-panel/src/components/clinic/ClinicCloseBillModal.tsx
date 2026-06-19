import React, { useState } from 'react'
import { fmtRp } from '../../lib/format'
import { useAuth } from '../../context/AuthContext'
import { createTransaction, completeVisitPayment, type ClinicTransaction } from '../../lib/clinicBilling'
import { lockRecord } from '../../lib/clinic'

interface Props {
  visitId: string
  patientId: string
  patientName: string
  patientCode: string
  services: { service_id: string; service_name: string; price: number }[]
  onClose: () => void
  onSuccess: (transaction: ClinicTransaction) => void
}

const METHODS = ['cash', 'transfer', 'qris', 'debit', 'kredit'] as const
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', qris: 'QRIS', debit: 'Debit', kredit: 'Kredit' }

export default function ClinicCloseBillModal({
  visitId, patientId, patientName, patientCode, services, onClose, onSuccess,
}: Props) {
  const { user } = useAuth()
  const [discount, setDiscount] = useState(0)
  const [method, setMethod] = useState('')
  const [cashReceived, setCashReceived] = useState(0)
  const [transferRef, setTransferRef] = useState('')
  const [cardLast4, setCardLast4] = useState('')
  const [bankName, setBankName] = useState('')
  const [cashierName, setCashierName] = useState(user?.full_name ?? '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const servicesTotal = services.reduce((sum, s) => sum + (Number(s.price) || 0), 0)
  const total = Math.max(0, servicesTotal - (Number(discount) || 0))
  const change = method === 'cash' && cashReceived > total ? cashReceived - total : 0
  const isCard = method === 'debit' || method === 'kredit'

  const handleConfirm = async () => {
    setError('')
    if (!method) { setError('Pilih metode pembayaran.'); return }
    setSaving(true)
    try {
      const payment_detail: Record<string, string> = {}
      if (method === 'transfer' && transferRef.trim()) payment_detail.transfer_ref = transferRef.trim()
      if (isCard) {
        if (cardLast4.trim()) payment_detail.card_last4 = cardLast4.trim()
        if (bankName.trim()) payment_detail.bank_name = bankName.trim()
      }
      const trx = await createTransaction({
        visit_id: visitId,
        patient_id: patientId,
        service_id: services[0]?.service_id ?? undefined,
        service_name: services.map(s => s.service_name).join(', ') || '-',
        service_price: servicesTotal,
        discount: Number(discount) || 0,
        total_amount: total,
        payment_method: method,
        payment_detail,
        notes: notes.trim() || undefined,
        cashier_name: cashierName.trim() || undefined,
      })
      if (user) await lockRecord('clinic_transactions', trx.id, user.full_name)
      await completeVisitPayment(visitId, method, total)
      onSuccess(trx)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memproses pembayaran')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Close Bill</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        {/* Visit summary */}
        <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{patientName}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace', marginBottom: 8 }}>{patientCode}</div>
          {services.length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Tidak ada layanan</div>
          ) : services.map(s => (
            <div key={s.service_id} style={{ fontSize: 13, marginBottom: 2 }}>
              <span>{s.service_name}</span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 700, borderTop: '1px solid var(--border, #E5E7EB)', marginTop: 6, paddingTop: 6 }}>
            <span>Subtotal</span>
            <span>{fmtRp(servicesTotal)}</span>
          </div>
        </div>

        {/* Discount */}
        <div className="form-group">
          <label>Diskon (Rp)</label>
          <input type="number" min={0} value={discount} onChange={e => setDiscount(Math.max(0, Number(e.target.value)))} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 14, fontWeight: 700, margin: '4px 0 16px' }}>
          <span>Total setelah diskon</span>
          <span style={{ color: 'var(--red)' }}>{fmtRp(total)}</span>
        </div>

        {/* Payment method */}
        <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 8 }}>Metode Pembayaran</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {METHODS.map(m => {
            const on = method === m
            return (
              <button key={m} type="button" onClick={() => setMethod(m)}
                style={{
                  flex: '1 1 80px', padding: '10px 8px', borderRadius: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                  border: '1px solid', borderColor: on ? '#C0392B' : 'var(--border, #E5E7EB)',
                  background: on ? '#FFF5F5' : '#fff', color: on ? '#C0392B' : 'var(--text-primary)',
                }}>{METHOD_LABEL[m]}</button>
            )
          })}
        </div>

        {method === 'cash' && (
          <>
            <div className="form-group">
              <label>Jumlah Diterima (Rp)</label>
              <input type="number" min={0} value={cashReceived} onChange={e => setCashReceived(Math.max(0, Number(e.target.value)))} />
            </div>
            {cashReceived > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Kembalian</span>
                <span style={{ fontWeight: 700, color: '#065F46' }}>{fmtRp(change)}</span>
              </div>
            )}
          </>
        )}

        {method === 'transfer' && (
          <div className="form-group">
            <label>Nomor Referensi Transfer (opsional)</label>
            <input type="text" value={transferRef} onChange={e => setTransferRef(e.target.value)} />
          </div>
        )}

        {isCard && (
          <div className="form-row">
            <div className="form-group">
              <label>4 Digit Terakhir Kartu</label>
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={4} value={cardLast4}
                onChange={e => setCardLast4(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </div>
            <div className="form-group">
              <label>Nama Bank</label>
              <input type="text" value={bankName} onChange={e => setBankName(e.target.value)} />
            </div>
          </div>
        )}

        <div className="form-group">
          <label>Nama Kasir</label>
          <input type="text" value={cashierName} onChange={e => setCashierName(e.target.value)} />
        </div>
        <div className="form-group">
          <label>Catatan (opsional)</label>
          <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={handleConfirm} disabled={saving || !method}>
            {saving ? 'Memproses...' : 'Konfirmasi Pembayaran'}
          </button>
        </div>
      </div>
    </div>
  )
}
