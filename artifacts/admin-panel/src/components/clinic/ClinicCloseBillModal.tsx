import React, { useState, useEffect } from 'react'
import { fmtRp } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { createTransaction, completeVisitPayment, type ClinicTransaction } from '../../lib/clinicBilling'
import {
  lockRecord, listPackages, listPatientActivePackages, purchasePatientPackage, usePackageSession,
  listServices,
  type ClinicPackage, type ClinicPatientPackage,
} from '../../lib/clinic'

interface Props {
  visitId: string
  patientId: string
  patientName: string
  patientCode: string
  patientPhone: string
  services: { service_id: string; service_name: string; price: number }[]
  paidOnline?: boolean
  paidWithVoucher?: boolean
  onClose: () => void
  onSuccess: (transaction: ClinicTransaction) => void
}

const METHODS = ['cash', 'transfer', 'qris', 'debit', 'kredit'] as const
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', qris: 'QRIS', debit: 'Debit', kredit: 'Kredit' }

export default function ClinicCloseBillModal({
  visitId, patientId, patientName, patientCode, patientPhone, services, paidOnline, paidWithVoucher, onClose, onSuccess,
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

  // Jadwalkan kunjungan berikutnya (opsional)
  const [scheduleFollowUp, setScheduleFollowUp] = useState(false)
  const [followUpDate, setFollowUpDate] = useState('')
  const [followUpTime, setFollowUpTime] = useState('')
  const [followUpServices, setFollowUpServices] = useState<{
    service_id: string; service_name: string; price: number
  }[]>([])
  const [allServices, setAllServices] = useState<any[]>([])

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

  useEffect(() => {
    listServices().then(setAllServices).catch(() => {})
  }, [])

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
    if (paidOnline) return false // pembayaran online: tanpa coverage paket (bayar penuh)
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
    if (!paidOnline && !paidWithVoucher && !method) { setError('Pilih metode pembayaran.'); return }
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

      // Booking sudah dibayar online (Mayar) → metode 'mayar', total penuh.
      // Booking dibayar voucher 100% → metode 'voucher', total 0, diskon penuh.
      const finalPaymentMethod = paidOnline ? 'mayar' : paidWithVoucher ? 'voucher' : method
      const finalTotal = paidOnline
        ? services.reduce((sum, s) => sum + s.price, 0)
        : paidWithVoucher
          ? (buyingPackage ? packageSubtotal : 0)
          : grandTotal
      const finalDiscount = paidWithVoucher
        ? services.reduce((sum, s) => sum + s.price, 0)
        : paidOnline ? 0 : (Number(discount) || 0)

      const trx = await createTransaction({
        visit_id: visitId,
        patient_id: patientId,
        service_id: services[0]?.service_id ?? undefined,
        service_name: serviceName,
        service_price: visitSubtotal + packageSubtotal,
        discount: finalDiscount,
        total_amount: finalTotal,
        payment_method: finalPaymentMethod,
        payment_detail,
        notes: notes.trim() || undefined,
        cashier_name: cashierName.trim() || undefined,
      })
      if (user) await lockRecord('clinic_transactions', trx.id, user.full_name)
      await completeVisitPayment(visitId, finalPaymentMethod, finalTotal)

      // 1. Potong sesi paket aktif yang meng-cover layanan kunjungan ini (1 sesi per paket).
      //    Lewati jika dibayar voucher 100% — jangan potong sesi paket.
      if (!paidWithVoucher && activePerformancePackage && coveredServices.some(s => isPerformanceService(s.service_name))) {
        await usePackageSession(activePerformancePackage.id)
      }
      if (!paidWithVoucher && activeMedicPackage && coveredServices.some(s => isMedicService(s.service_name))) {
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

      // Jadwalkan kunjungan berikutnya (best-effort — pembayaran di atas sudah committed).
      if (scheduleFollowUp && followUpDate && followUpServices.length > 0) {
        try {
          const { data: newVisit, error: followUpVisitErr } = await supabase
            .from('clinic_visits')
            .insert({
              patient_id: patientId,
              visit_date: followUpDate,
              visit_time: followUpTime || null,
              status: 'scheduled',
              payment_status: 'unpaid',
              chief_complaint: 'Follow-up visit',
              created_by: cashierName || 'Kasir',
            })
            .select('id')
            .single()
          if (followUpVisitErr) throw followUpVisitErr

          const { error: followUpSvcErr } = await supabase
            .from('clinic_visit_services')
            .insert(followUpServices.map((s, i) => ({
              visit_id: newVisit.id,
              service_id: s.service_id,
              service_name: s.service_name,
              price: s.price,
              sort_order: i,
            })))
          if (followUpSvcErr) throw followUpSvcErr

          // Cari slot yang cocok untuk follow-up dan increment booked_count
          let matchSlot: { id: string } | null = null
          if (followUpTime) {
            const { data } = await supabase
              .from('clinic_slots')
              .select('id')
              .eq('slot_date', followUpDate)
              .eq('start_time', followUpTime + ':00')
              .eq('is_active', true)
              .maybeSingle()
            matchSlot = data as { id: string } | null

            if (matchSlot) {
              await supabase
                .from('clinic_visits')
                .update({ slot_id: matchSlot.id })
                .eq('id', newVisit.id)

              await supabase.rpc('increment_clinic_slot_booked', { p_slot_id: matchSlot.id })
            }
          }

          // Buat clinic_bookings untuk follow-up agar pasien bisa check-in (dengan / tanpa slot)
          console.log('[FollowUp Debug]', {
            scheduleFollowUp,
            followUpDate,
            followUpServicesLength: followUpServices.length,
            followUpServices,
            patientId,
            patientName,
            patientPhone,
          })
          const followUpServiceId = followUpServices[0]?.service_id ?? null
          if (followUpServiceId) {
            // Generate booking code dulu
            const { data: codeData } = await supabase
              .rpc('generate_clinic_booking_code')

            const { data: newBooking, error: bookingErr } = await supabase
              .from('clinic_bookings')
              .insert({
                booking_code: codeData as string,
                patient_id: patientId,
                service_id: followUpServiceId,
                slot_id: matchSlot?.id ?? null,
                full_name: patientName,
                phone: patientPhone,
                status: 'confirmed',
                price: 0,
                payment_method: 'follow_up',
                visit_id: newVisit.id,
              })
              .select('id, booking_code')
              .single()

            if (bookingErr) {
              console.error('Gagal buat booking follow-up:', bookingErr)
            } else {
              console.log('Follow-up booking created:', newBooking)
            }
          }
        } catch (followUpErr) {
          // Pembayaran sudah berhasil — jangan blokir/biarkan retry (risiko double-charge).
          // Log saja; kunjungan berikutnya bisa dijadwalkan manual jika gagal.
          console.error('Gagal menjadwalkan kunjungan berikutnya:', followUpErr)
        }
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
      <div className="modal-box" style={{ maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto', background: '#1a2740', color: '#F0F4FF' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Close Bill</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}>×</button>
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        {/* Visit header */}
        <div style={{ background: '#243352', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: '#F0F4FF' }}>{patientName}</div>
          <div style={{ fontSize: 12, color: '#A8B8D8', fontFamily: 'monospace' }}>{patientCode}</div>
        </div>

        {/* Info paket aktif (jika ada) */}
        {patientPackages.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: 'rgba(5,150,105,0.1)', borderRadius: 10, border: '1px solid rgba(5,150,105,0.2)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#34D399', marginBottom: 6 }}>✓ Paket Aktif Pasien</div>
            {patientPackages.map(pp => (
              <div key={pp.id} style={{ fontSize: 12, color: '#F0F4FF', marginBottom: 2 }}>
                {pp.package?.name} — Sisa {pp.remaining_sessions} sesi
              </div>
            ))}
          </div>
        )}

        {/* Rincian biaya */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Rincian Biaya</div>

          {paidWithVoucher ? (
            services.map(s => (
              <div key={s.service_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
                <span style={{ textDecoration: 'line-through', color: '#6B7A99' }}>
                  {s.service_name} — Rp {s.price.toLocaleString('id-ID')}
                </span>
                <span style={{ color: '#FCD34D', fontWeight: 600 }}>VOUCHER</span>
              </div>
            ))
          ) : (
            <>
              {coveredServices.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 11, color: '#34D399', fontWeight: 600, marginBottom: 4 }}>✓ Ter-cover Paket</div>
                  {coveredServices.map(s => (
                    <div key={s.service_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#A8B8D8', textDecoration: 'line-through' }}>
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
            </>
          )}

          {selectedNewPkg && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: '#93C5FD' }}>
              <span>📦 {selectedNewPkg.name}</span>
              <span>{fmtRp(selectedNewPkg.package_price)}</span>
            </div>
          )}

          {discount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: '#FC8181', marginBottom: 4 }}>
              <span>Diskon</span>
              <span>-{fmtRp(discount)}</span>
            </div>
          )}

          {paidWithVoucher ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8, marginTop: 4 }}>
              <span>Total</span>
              <div style={{ textAlign: 'right' }}>
                <div style={{ textDecoration: 'line-through', color: '#6B7A99', fontSize: 12 }}>
                  Rp {services.reduce((s, i) => s + i.price, 0).toLocaleString('id-ID')}
                </div>
                <div style={{ color: '#FCD34D', fontSize: 16 }}>{fmtRp(buyingPackage ? packageSubtotal : 0)}</div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8, marginTop: 4 }}>
              <span>Total</span>
              <span style={{ color: '#C0392B' }}>{fmtRp(grandTotal)}</span>
            </div>
          )}
        </div>

        {/* Section beli paket baru — disembunyikan untuk pembayaran online */}
        {!paidOnline && (
        <div style={{ marginBottom: 16, padding: 14, background: '#243352', borderRadius: 10, border: '1px solid rgba(255,255,255,0.1)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input type="checkbox" id="buyPkg" checked={buyingPackage} onChange={e => setBuyingPackage(e.target.checked)} />
            <label htmlFor="buyPkg" style={{ fontSize: 13, fontWeight: 600, color: '#F0F4FF', cursor: 'pointer' }}>
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
                <div style={{ fontSize: 12, color: '#93C5FD', background: 'rgba(59,130,246,0.1)', padding: '8px 12px', borderRadius: 8, marginBottom: 8 }}>
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
        )}

        {/* Banner: sudah dibayar online */}
        {paidOnline && (
          <div style={{ padding: '12px 14px', borderRadius: 10,
            background: 'rgba(5,150,105,0.1)', border: '1px solid rgba(5,150,105,0.2)',
            marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#34D399' }}>
                Sudah Dibayar Online
              </div>
              <div style={{ fontSize: 11, color: '#A8B8D8' }}>
                Pembayaran via Mayar sudah terkonfirmasi
              </div>
            </div>
          </div>
        )}

        {/* Banner: sudah dibayar dengan voucher */}
        {paidWithVoucher && (
          <div style={{ padding: '12px 14px', borderRadius: 10,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>🎟️</span>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#FCD34D' }}>
                Sudah Dibayar dengan Voucher
              </div>
              <div style={{ fontSize: 11, color: '#A8B8D8' }}>
                Pasien menggunakan voucher 100% — tidak ada biaya tambahan
              </div>
            </div>
          </div>
        )}

        {/* Discount */}
        {!paidOnline && !paidWithVoucher && (
          <div className="form-group">
            <label>Diskon (Rp)</label>
            <input type="number" min={0} value={discount} onChange={e => setDiscount(Math.max(0, Number(e.target.value)))} />
          </div>
        )}

        {/* Payment method */}
        {!paidOnline && !paidWithVoucher && (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 8, color: '#A8B8D8', textTransform: 'uppercase', letterSpacing: 1 }}>Metode Pembayaran</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {METHODS.map(m => {
                const on = method === m
                return (
                  <button key={m} type="button" onClick={() => setMethod(m)}
                    style={on ? {
                      flex: '1 1 80px', padding: '8px 14px', borderRadius: 8,
                      border: '1px solid #C0392B', background: 'rgba(192,57,43,0.15)',
                      color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    } : {
                      flex: '1 1 80px', padding: '8px 14px', borderRadius: 8,
                      border: '1px solid rgba(255,255,255,0.12)', background: '#243352',
                      color: '#A8B8D8', cursor: 'pointer', fontWeight: 500, fontSize: 13, transition: 'all 0.15s',
                    }}>{METHOD_LABEL[m]}</button>
                )
              })}
            </div>
          </>
        )}

        {method === 'cash' && (
          <>
            <div className="form-group">
              <label>Jumlah Diterima (Rp)</label>
              <input type="number" min={0} value={cashReceived} onChange={e => setCashReceived(Math.max(0, Number(e.target.value)))} />
            </div>
            {cashReceived > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 12 }}>
                <span style={{ color: 'var(--text-muted)' }}>Kembalian</span>
                <span style={{ fontWeight: 700, color: '#34D399' }}>{fmtRp(change)}</span>
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

        {/* Jadwalkan Kunjungan Berikutnya */}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={scheduleFollowUp}
              onChange={e => setScheduleFollowUp(e.target.checked)}
              style={{ accentColor: '#C0392B', width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: '#F0F4FF' }}>
              📅 Jadwalkan Kunjungan Berikutnya
            </span>
          </label>

          {scheduleFollowUp && (
            <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 10,
              background: '#152034', border: '1px solid rgba(255,255,255,0.1)' }}>

              {/* Tanggal & Jam */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: '#A8B8D8', textTransform: 'uppercase',
                    letterSpacing: 1, display: 'block', marginBottom: 4 }}>Tanggal *</label>
                  <input type="date" value={followUpDate}
                    onChange={e => setFollowUpDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: '#0f1923', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#F0F4FF', fontSize: 13, boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: '#A8B8D8', textTransform: 'uppercase',
                    letterSpacing: 1, display: 'block', marginBottom: 4 }}>Jam</label>
                  <input type="time" value={followUpTime}
                    onChange={e => setFollowUpTime(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: '#0f1923', border: '1px solid rgba(255,255,255,0.12)',
                      color: '#F0F4FF', fontSize: 13, boxSizing: 'border-box' as const }} />
                </div>
              </div>

              {/* Pilih Layanan */}
              <div>
                <label style={{ fontSize: 11, color: '#A8B8D8', textTransform: 'uppercase',
                  letterSpacing: 1, display: 'block', marginBottom: 6 }}>Layanan *</label>
                <select
                  onChange={e => {
                    const svc = allServices?.find((s: any) => s.id === e.target.value)
                    if (svc && !followUpServices.some(fs => fs.service_id === svc.id)) {
                      setFollowUpServices(prev => [...prev, {
                        service_id: svc.id,
                        service_name: svc.name,
                        price: svc.price,
                      }])
                    }
                    e.target.value = ''
                  }}
                  style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                    background: '#0f1923', border: '1px solid rgba(255,255,255,0.12)',
                    color: '#F0F4FF', fontSize: 13 }}
                >
                  <option value="">— Pilih layanan —</option>
                  {allServices?.filter((s: any) => !followUpServices.some(fs => fs.service_id === s.id))
                    .map((s: any) => (
                      <option key={s.id} value={s.id}>
                        {s.name} — Rp {s.price.toLocaleString('id-ID')}
                      </option>
                    ))}
                </select>

                {followUpServices.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {followUpServices.map(s => (
                      <span key={s.service_id} style={{
                        padding: '3px 10px', borderRadius: 999,
                        background: '#243352', border: '1px solid rgba(255,255,255,0.1)',
                        color: '#F0F4FF', fontSize: 12,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        {s.service_name}
                        <button
                          onClick={() => setFollowUpServices(prev =>
                            prev.filter(fs => fs.service_id !== s.service_id))}
                          style={{ background: 'none', border: 'none', color: '#FC8181',
                            cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Batal</button>
          <button className="btn-primary" onClick={handleConfirm} disabled={saving || (!paidOnline && !paidWithVoucher && !method)}>
            {saving ? 'Memproses...' : (paidOnline ? 'Konfirmasi & Selesai →' : paidWithVoucher ? 'Konfirmasi Voucher & Selesai →' : 'Konfirmasi Pembayaran →')}
          </button>
        </div>
      </div>
    </div>
  )
}
