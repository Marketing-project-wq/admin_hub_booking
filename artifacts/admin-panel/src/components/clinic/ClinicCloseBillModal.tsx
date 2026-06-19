import React, { useState, useEffect } from 'react'
import { fmtRp } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { createTransaction, completeVisitPayment, type ClinicTransaction } from '../../lib/clinicBilling'
import {
  lockRecord, listPackages, listPatientActivePackages, purchasePatientPackage, usePackageSession,
  type ClinicPackage, type ClinicPatientPackage,
} from '../../lib/clinic'

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

  // Paket
  const [packages, setPackages] = useState<ClinicPackage[]>([])
  const [patientPackages, setPatientPackages] = useState<ClinicPatientPackage[]>([])
  const [serviceCategoryMap, setServiceCategoryMap] = useState<Record<string, string>>({})
  const [buyingPackage, setBuyingPackage] = useState(false)
  const [selectedNewPackageId, setSelectedNewPackageId] = useState('')
  const [packageNotes, setPackageNotes] = useState('')

  useEffect(() => {
    Promise.all([
      listPackages(),
      listPatientActivePackages(patientId),
      supabase.from('clinic_services').select('name, package_category'),
    ]).then(([pkgs, patPkgs, svcRes]) => {
      setPackages(pkgs)
      setPatientPackages(patPkgs)
      const map: Record<string, string> = {}
      ;(svcRes.data as { name: string; package_category: string | null }[] | null ?? [])
        .forEach(s => { if (s.package_category) map[s.name] = s.package_category })
      setServiceCategoryMap(map)
    }).catch(() => {})
  }, [patientId])

  // Kategorisasi layanan berdasarkan package_category dari database.
  const isPerformanceService = (name: string) => serviceCategoryMap[name] === 'performance'
  const isMedicService = (name: string) => serviceCategoryMap[name] === 'medic'
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isNoCoverageService = (name: string) => !serviceCategoryMap[name] || serviceCategoryMap[name] === 'none'

  // Paket aktif pasien per kategori.
  const activePerformancePackage = patientPackages.find(pp => pp.package?.category === 'Performance') ?? null
  const activeMedicPackage = patientPackages.find(pp => pp.package?.category === 'Medic') ?? null

  // Layanan yang ter-cover paket aktif vs yang bayar normal.
  const coveredServices = services.filter(s => {
    if (activePerformancePackage && isPerformanceService(s.service_name)) return true
    if (activeMedicPackage && isMedicService(s.service_name)) return true
    return false
  })
  const uncoveredServices = services.filter(s => !coveredServices.includes(s))

  const visitSubtotal = uncoveredServices.reduce((sum, s) => sum + (Number(s.price) || 0), 0)
  const selectedNewPkg = buyingPackage && selectedNewPackageId
    ? packages.find(p => p.id === selectedNewPackageId) ?? null
    : null
  const packageSubtotal = selectedNewPkg ? selectedNewPkg.package_price : 0
  const grandTotal = Math.max(0, visitSubtotal + packageSubtotal - (Number(discount) || 0))
  const change = method === 'cash' && cashReceived > grandTotal ? cashReceived - grandTotal : 0
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
      const serviceName = [
        services.map(s => s.service_name).join(', ') || null,
        selectedNewPkg ? `Paket ${selectedNewPkg.name}` : null,
      ].filter(Boolean).join(' + ') || '-'

      const trx = await createTransaction({
        visit_id: visitId,
        patient_id: patientId,
        service_id: services[0]?.service_id ?? undefined,
        service_name: serviceName,
        service_price: visitSubtotal + packageSubtotal,
        discount: Number(discount) || 0,
        total_amount: grandTotal,
        payment_method: method,
        payment_detail,
        notes: notes.trim() || undefined,
        cashier_name: cashierName.trim() || undefined,
      })
      if (user) await lockRecord('clinic_transactions', trx.id, user.full_name)
      await completeVisitPayment(visitId, method, grandTotal)

      // 1. Potong sesi paket aktif yang meng-cover layanan kunjungan ini (1 sesi per paket).
      if (activePerformancePackage && coveredServices.some(s => isPerformanceService(s.service_name))) {
        await usePackageSession(activePerformancePackage.id)
      }
      if (activeMedicPackage && coveredServices.some(s => isMedicService(s.service_name))) {
        await usePackageSession(activeMedicPackage.id)
      }

      // 2. Pembelian paket baru (jika dicentang).
      if (buyingPackage && selectedNewPackageId && selectedNewPkg) {
        await purchasePatientPackage({
          patient_id: patientId,
          package_id: selectedNewPackageId,
          total_sessions: selectedNewPkg.sessions,
          notes: packageNotes.trim() || undefined,
        })
      }

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

        {/* Visit header */}
        <div style={{ background: '#F9FAFB', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: 700 }}>{patientName}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{patientCode}</div>
        </div>

        {/* Info paket aktif (jika ada) */}
        {patientPackages.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: '#F0FFF4', borderRadius: 10, border: '1px solid #6EE7B7' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#065F46', marginBottom: 6 }}>✓ Paket Aktif Pasien</div>
            {patientPackages.map(pp => (
              <div key={pp.id} style={{ fontSize: 12, color: '#374151', marginBottom: 2 }}>
                {pp.package?.name} — Sisa {pp.remaining_sessions} sesi
              </div>
            ))}
          </div>
        )}

        {/* Rincian biaya */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Rincian Biaya</div>

          {coveredServices.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: '#059669', fontWeight: 600, marginBottom: 4 }}>✓ Ter-cover Paket</div>
              {coveredServices.map(s => (
                <div key={s.service_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#6B7280', textDecoration: 'line-through' }}>
                  <span>{s.service_name}</span>
                  <span>{fmtRp(s.price)}</span>
                </div>
              ))}
            </div>
          )}

          {uncoveredServices.map(s => (
            <div key={s.service_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>{s.service_name}</span>
              <span>{fmtRp(s.price)}</span>
            </div>
          ))}

          {selectedNewPkg && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: '#1D4ED8' }}>
              <span>📦 {selectedNewPkg.name}</span>
              <span>{fmtRp(selectedNewPkg.package_price)}</span>
            </div>
          )}

          {discount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#DC2626', marginBottom: 4 }}>
              <span>Diskon</span>
              <span>-{fmtRp(discount)}</span>
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, borderTop: '1px solid #E5E7EB', paddingTop: 8, marginTop: 4 }}>
            <span>Total</span>
            <span style={{ color: '#C0392B' }}>{fmtRp(grandTotal)}</span>
          </div>
        </div>

        {/* Section beli paket baru */}
        <div style={{ marginBottom: 16, padding: 14, background: '#F0F9FF', borderRadius: 10, border: '1px solid #BAE6FD' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input type="checkbox" id="buyPkg" checked={buyingPackage} onChange={e => setBuyingPackage(e.target.checked)} />
            <label htmlFor="buyPkg" style={{ fontSize: 13, fontWeight: 600, color: '#0369A1', cursor: 'pointer' }}>
              📦 Tambah pembelian paket
            </label>
          </div>

          {buyingPackage && (
            <>
              <select
                value={selectedNewPackageId}
                onChange={e => setSelectedNewPackageId(e.target.value)}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, marginBottom: 8 }}
              >
                <option value="">— Pilih Paket —</option>
                {['Performance', 'Medic'].map(cat => (
                  <optgroup key={cat} label={`${cat} Package`}>
                    {packages.filter(p => p.category === cat).map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {fmtRp(p.package_price)} ({p.sessions}x sesi, hemat {p.discount_percent}%)
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {selectedNewPkg && (
                <div style={{ fontSize: 12, color: '#0369A1', background: '#E0F2FE', padding: '8px 12px', borderRadius: 8, marginBottom: 8 }}>
                  Harga paket: <strong>{fmtRp(selectedNewPkg.package_price)}</strong> untuk {selectedNewPkg.sessions} sesi
                  (hemat {fmtRp(selectedNewPkg.retail_price - selectedNewPkg.package_price)})
                </div>
              )}

              <textarea
                value={packageNotes}
                onChange={e => setPackageNotes(e.target.value)}
                placeholder="Catatan paket (opsional)..."
                rows={2}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, fontFamily: 'inherit', resize: 'none', boxSizing: 'border-box' }}
              />
            </>
          )}
        </div>

        {/* Discount */}
        <div className="form-group">
          <label>Diskon (Rp)</label>
          <input type="number" min={0} value={discount} onChange={e => setDiscount(Math.max(0, Number(e.target.value)))} />
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
