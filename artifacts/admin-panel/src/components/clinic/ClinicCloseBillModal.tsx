import React, { useState, useEffect } from 'react'
import { ArrowRight, X } from 'lucide-react'
import { fmtRp } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { type ClinicTransaction } from '../../lib/clinicBilling'
import {
  listPackages, listPatientActivePackages,
  listServices, listClinicStaffOptions, logAssignmentChange,
  getScreeningByVisit, getConsentsByVisit,
  type ClinicPackage, type ClinicPatientPackage, type ClinicStaffOption, type AssignmentChange,
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
  // service_id dari booking online — voucher HANYA menutup baris servis ini (bug fix:
  // sebelumnya voucher meng-gratiskan SEMUA servis di visit, termasuk tambahan on-site).
  bookingServiceId?: string | null
  onClose: () => void
  onSuccess: (transaction: ClinicTransaction) => void
}

const ADMIN_FEE = 50000
const METHODS = ['cash', 'transfer', 'qris', 'debit', 'kredit'] as const
const METHOD_LABEL: Record<string, string> = { cash: 'Cash', transfer: 'Transfer', qris: 'QRIS', debit: 'Debit', kredit: 'Kredit' }

export default function ClinicCloseBillModal({
  visitId, patientId, patientName, patientCode, patientPhone, services, paidOnline, paidWithVoucher, bookingServiceId, onClose, onSuccess,
}: Props) {
  const { user } = useAuth()
  const [discount, setDiscount] = useState(0)
  const [addAdminFee, setAddAdminFee] = useState(false)
  const [method, setMethod] = useState('')
  const [cashReceived, setCashReceived] = useState(0)
  const [transferRef, setTransferRef] = useState('')
  const [cardLast4, setCardLast4] = useState('')
  const [bankName, setBankName] = useState('')
  const [cashierName, setCashierName] = useState(user?.full_name ?? '')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // ── Guard kelengkapan klinis sebelum Close Bill ──────────────────────────────
  // Wajib: Screening + Consent (semua visit) + Assessment Dokter (khusus layanan
  // requires_doctor). Kalau belum lengkap → tombol Close Bill dikunci dan bagian
  // yang belum diisi ditandai. Fail-open kalau cek gagal (jangan jebak kasir).
  const [checkingCompleteness, setCheckingCompleteness] = useState(true)
  const [missingSections, setMissingSections] = useState<string[]>([])

  // Terapis & dokter penanggung jawab — Close Bill adalah penentu final assignment
  // kunjungan ini. Otomatis terisi dari assigned_*_id yang sudah ada. Yang boleh
  // mengubah: super_admin, admin, dan dokter (yang punya akses). Setiap perubahan
  // dicatat ke clinic_audit_logs.
  const [staffOptions, setStaffOptions] = useState<ClinicStaffOption[]>([])
  const [therapistId, setTherapistId] = useState('')
  const [doctorId, setDoctorId] = useState('')
  // Nilai awal (dari kunjungan) untuk mendeteksi perubahan + isi log "dari".
  const [origTherapistId, setOrigTherapistId] = useState('')
  const [origDoctorId, setOrigDoctorId] = useState('')
  const therapistOptions = staffOptions.filter(o => o.role === 'therapist')
  const doctorOptions = staffOptions.filter(o => o.role === 'dokter')
  const canEditAssignment = ['super_admin', 'admin', 'dokter'].includes(user?.role ?? '')
  const staffName = (id: string) => staffOptions.find(o => o.id === id)?.full_name ?? null

  // Paket
  const [packages, setPackages] = useState<ClinicPackage[]>([])
  const [patientPackages, setPatientPackages] = useState<ClinicPatientPackage[]>([])
  const [serviceCategoryMap, setServiceCategoryMap] = useState<Record<string, string>>({})
  const [buyingPackage, setBuyingPackage] = useState(false)
  // Multiselect: 1 pasien bisa beli >1 paket sekaligus dalam satu Close Bill.
  const [selectedNewPackageIds, setSelectedNewPackageIds] = useState<string[]>([])
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

  // Muat daftar staf + assignment (dokter & terapis) yang sudah ada untuk pre-fill.
  useEffect(() => {
    listClinicStaffOptions().then(setStaffOptions).catch(() => {})
    supabase.from('clinic_visits').select('assigned_therapist_id, assigned_doctor_id').eq('id', visitId).maybeSingle()
      .then(({ data }) => {
        const row = data as { assigned_therapist_id: string | null; assigned_doctor_id: string | null } | null
        const t = row?.assigned_therapist_id ?? ''
        const d = row?.assigned_doctor_id ?? ''
        setTherapistId(t); setOrigTherapistId(t)
        setDoctorId(d); setOrigDoctorId(d)
      })
  }, [visitId])

  // Cek kelengkapan Screening / Consent / Assessment untuk visit ini.
  useEffect(() => {
    let active = true
    setCheckingCompleteness(true)
    ;(async () => {
      try {
        const serviceIds = services.map(s => s.service_id).filter(Boolean)
        const [scr, con, asmtRes, svcRes] = await Promise.all([
          getScreeningByVisit(visitId),
          getConsentsByVisit(visitId),
          supabase.from('clinic_assessments').select('assessment_type').eq('visit_id', visitId),
          serviceIds.length
            ? supabase.from('clinic_services').select('id, requires_doctor').in('id', serviceIds)
            : Promise.resolve({ data: [] as { id: string; requires_doctor: boolean | null }[] }),
        ])
        const assessmentRows = (asmtRes.data ?? []) as { assessment_type: string | null }[]
        // Assessment dokter = baris bertipe 'doctor' (baris legacy tanpa tipe juga dihitung).
        const hasDoctorAssessment = assessmentRows.some(a => a.assessment_type === 'doctor' || a.assessment_type == null)
        const requiresDoctor = ((svcRes.data ?? []) as { requires_doctor: boolean | null }[]).some(s => s.requires_doctor === true)

        const miss: string[] = []
        if (!scr) miss.push('Screening')
        if (con.length === 0) miss.push('Consent')
        if (requiresDoctor && !hasDoctorAssessment) miss.push('Assessment Dokter')
        if (active) setMissingSections(miss)
      } catch (e) {
        // Fail-open: jangan jebak kasir kalau cek gagal (mis. jaringan) — cukup log.
        console.error('[CloseBill] cek kelengkapan gagal:', e)
        if (active) setMissingSections([])
      } finally {
        if (active) setCheckingCompleteness(false)
      }
    })()
    return () => { active = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visitId])

  // Kategorisasi layanan berdasarkan package_category dari database.
  const isPerformanceService = (name: string) => serviceCategoryMap[name] === 'performance'
  const isMedicService = (name: string) => serviceCategoryMap[name] === 'medic'
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isNoCoverageService = (name: string) => !serviceCategoryMap[name] || serviceCategoryMap[name] === 'none'

  // Paket aktif pasien per kategori.
  const activePerformancePackage = patientPackages.find(pp => pp.package?.category === 'Performance') ?? null
  const activeMedicPackage = patientPackages.find(pp => pp.package?.category === 'Medic') ?? null

  // ── Voucher (bug fix) ───────────────────────────────────────────────────────
  // Voucher HANYA menutup SATU baris servis yang service_id-nya cocok dengan booking —
  // BUKAN seluruh visit. Duplikat service_id: hanya kemunculan pertama yang ditutup.
  const voucherService = paidWithVoucher && bookingServiceId
    ? services.find(s => s.service_id === bookingServiceId) ?? null
    : null
  // Voucher aktif tapi servis booking tidak ada di visit (mis. terhapus saat edit visit)
  // → JANGAN diam-diam apply ke servis lain / diam-diam skip: tampilkan warning eksplisit
  // dan hitung SEMUA servis bayar normal (kasir cek manual).
  const voucherMissing = !!paidWithVoucher && !voucherService
  const voucherAmount = voucherService?.price ?? 0

  // Layanan yang ter-cover paket aktif vs yang bayar normal.
  const coveredServices = services.filter(s => {
    if (paidOnline) return false // pembayaran online: tanpa coverage paket (bayar penuh)
    if (voucherService && s === voucherService) return false // sudah ditutup voucher
    if (activePerformancePackage && isPerformanceService(s.service_name)) return true
    if (activeMedicPackage && isMedicService(s.service_name)) return true
    return false
  })
  const uncoveredServices = services.filter(s => !coveredServices.includes(s))
  // Baris yang benar-benar ditagih = uncovered minus baris yang ditutup voucher.
  const payableServices = uncoveredServices.filter(s => s !== voucherService)

  const visitSubtotal = payableServices.reduce((sum, s) => sum + (Number(s.price) || 0), 0)
  // Paket yang dipilih untuk dibeli (bisa lebih dari satu). Urutan mengikuti daftar
  // master `packages` agar rincian biaya tampil rapi & konsisten.
  const selectedNewPkgs = buyingPackage
    ? packages.filter(p => selectedNewPackageIds.includes(p.id))
    : []
  const packageSubtotal = selectedNewPkgs.reduce((sum, p) => sum + p.package_price, 0)
  // Biaya admin opsional — tidak berlaku untuk pembayaran online (sudah settle di Mayar).
  // Ditambahkan SETELAH max(0, ...) supaya tidak bisa dimakan diskon.
  const adminFee = !paidOnline && addAdminFee ? ADMIN_FEE : 0
  const grandTotal = Math.max(0, visitSubtotal + packageSubtotal - (Number(discount) || 0)) + adminFee
  // Batas atas diskon = harga layanan + paket (sama dengan p_service_price di RPC, yang
  // menolak discount > service_price) — biaya admin TIDAK ikut (tidak boleh didiskon).
  const maxDiscount = visitSubtotal + packageSubtotal
  const change = method === 'cash' && cashReceived > grandTotal ? cashReceived - grandTotal : 0
  const isCard = method === 'debit' || method === 'kredit'

  // Voucher menutup segalanya (tak ada sisa tagihan & tak beli paket) → metode 'voucher'
  // tanpa pilih metode. Selain itu — termasuk voucherMissing — metode pembayaran wajib.
  const voucherFullyCovers = !!voucherService && grandTotal === 0 && !buyingPackage
  const needsMethod = !paidOnline && !voucherFullyCovers

  const handleConfirm = async () => {
    setError('')
    if (missingSections.length > 0) { setError(`Lengkapi dulu: ${missingSections.join(', ')}`); return }
    if (needsMethod && !method) { setError('Pilih metode pembayaran.'); return }
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
        selectedNewPkgs.length ? `Paket ${selectedNewPkgs.map(p => p.name).join(', ')}` : null,
      ].filter(Boolean).join(' + ') || '-'

      // Booking online (Mayar) → metode 'mayar', total penuh.
      // Voucher → HANYA baris servis booking yang ditutup (voucherAmount masuk diskon);
      // sisa servis dibayar normal (grandTotal). Metode 'voucher' hanya saat voucher
      // menutup semuanya tanpa sisa & tanpa beli paket.
      const finalPaymentMethod = paidOnline
        ? 'mayar'
        : voucherFullyCovers
          ? 'voucher'
          : method
      const finalTotal = paidOnline
        ? services.reduce((sum, s) => sum + s.price, 0)
        : grandTotal
      const finalDiscount = paidOnline ? 0 : (Number(discount) || 0) + voucherAmount

      // Sesi paket yang dipotong: 1 per kategori ter-cover (Performance & Medic), maks 2.
      // coveredServices sudah mengecualikan baris voucher, jadi coverage paket untuk
      // servis lain tetap berjalan normal walau visit memakai voucher.
      const usePackageIds: string[] = []
      if (activePerformancePackage && coveredServices.some(s => isPerformanceService(s.service_name))) {
        usePackageIds.push(activePerformancePackage.id)
      }
      if (activeMedicPackage && coveredServices.some(s => isMedicService(s.service_name))) {
        usePackageIds.push(activeMedicPackage.id)
      }

      const doPurchase = buyingPackage && selectedNewPkgs.length > 0

      // Satu RPC atomik menggantikan createTransaction + lockRecord + completeVisitPayment
      // + usePackageSession(×2) + purchasePatientPackage — semua rollback bersama jika ada
      // langkah gagal, dan menolak re-close visit yang sudah paid (anti transaksi ganda).
      const { data: trxData, error: rpcErr } = await supabase.rpc('close_clinic_bill', {
        p_visit_id: visitId,
        p_patient_id: patientId,
        p_service_id: services[0]?.service_id ?? null,
        p_service_name: serviceName,
        // Gross termasuk baris voucher — voucherAmount tercatat sebagai diskon, dan
        // guard RPC (discount <= service_price) tetap terpenuhi.
        p_service_price: visitSubtotal + voucherAmount + packageSubtotal,
        p_discount: finalDiscount,
        p_admin_fee: adminFee,
        p_total_amount: finalTotal,
        p_payment_method: finalPaymentMethod,
        p_payment_detail: payment_detail,
        p_notes: notes.trim() || null,
        p_cashier_name: cashierName.trim() || null,
        p_locked_by: user?.full_name ?? null,
        p_use_package_ids: usePackageIds,
        // Multiselect paket → kirim array. Param single lama dibiarkan default
        // (RPC memprioritaskan p_purchase_packages bila diisi). Catatan dibagikan
        // ke semua paket yang dibeli di transaksi ini.
        p_purchase_packages: doPurchase
          ? selectedNewPkgs.map(p => ({
              id: p.id,
              sessions: p.sessions,
              notes: packageNotes.trim() || null,
            }))
          : null,
      })
      if (rpcErr) throw rpcErr
      const trx = trxData as unknown as ClinicTransaction

      // Close Bill = penentu final assignment kunjungan ini. Best-effort: pembayaran
      // di atas sudah committed, jadi kegagalan update assignment tidak membatalkan bill.
      // Hanya role berwenang yang boleh mengubah; setiap perubahan dicatat ke audit log.
      if (canEditAssignment && (therapistId !== origTherapistId || doctorId !== origDoctorId)) {
        try {
          await supabase.from('clinic_visits')
            .update({
              assigned_therapist_id: therapistId || null,
              assigned_doctor_id: doctorId || null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', visitId)

          const changes: AssignmentChange[] = []
          if (doctorId !== origDoctorId) changes.push({ field: 'doctor', from: staffName(origDoctorId), to: staffName(doctorId) })
          if (therapistId !== origTherapistId) changes.push({ field: 'therapist', from: staffName(origTherapistId), to: staffName(therapistId) })
          await logAssignmentChange(visitId, user?.full_name ?? '-', user?.role ?? null, changes)
        } catch (assignErr) { console.error('Gagal simpan/log assignment penanggung jawab:', assignErr) }
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

              // Hanya visit follow-up yang meng-claim slot; booking yang dibuat di bawah TIDAK ikut claim.
              await supabase.rpc('claim_clinic_slot', {
                p_slot_id: matchSlot.id, p_claimed_by_type: 'visit', p_claimed_by_id: newVisit.id,
              })
            }
          }

          // Buat clinic_bookings untuk follow-up agar pasien bisa check-in (dengan / tanpa slot)
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
    // No onClick here: an accidental click on the backdrop must not discard
    // unsaved close-bill / package purchase / assignment input. Closing goes through the X button only.
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto', background: 'var(--bg-card)', color: 'var(--text-primary)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Close Bill</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: 'var(--text-muted)', lineHeight: 1 }}><X size={18} /></button>
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        {/* Guard kelengkapan klinis — blokir Close Bill sampai bagian wajib terisi */}
        {!checkingCompleteness && missingSections.length > 0 && (
          <div style={{ padding: '12px 14px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)', marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--red)', marginBottom: 4 }}>
              Belum bisa Close Bill
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              Bagian ini belum diisi: <strong>{missingSections.join(', ')}</strong>. Lengkapi dulu di Triase/EMR sebelum menutup tagihan.
            </div>
          </div>
        )}

        {/* Visit header */}
        <div style={{ background: 'var(--bg-elevated)', borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{patientName}</div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'monospace' }}>{patientCode}</div>
        </div>

        {/* Info paket aktif (jika ada) */}
        {patientPackages.length > 0 && (
          <div style={{ marginBottom: 16, padding: 12, background: 'rgba(5,150,105,0.1)', borderRadius: 10, border: '1px solid rgba(5,150,105,0.2)' }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--green)', marginBottom: 6 }}>Paket Aktif Pasien</div>
            {patientPackages.map(pp => (
              <div key={pp.id} style={{ fontSize: 12, color: 'var(--text-primary)', marginBottom: 2 }}>
                {pp.package?.name} — Sisa {pp.remaining_sessions} sesi
              </div>
            ))}
          </div>
        )}

        {/* Rincian biaya */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Rincian Biaya</div>

          {/* Baris yang ditutup voucher — HANYA servis yang cocok dengan booking */}
          {voucherService && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
              <span style={{ textDecoration: 'line-through', color: 'var(--text-muted)' }}>
                {voucherService.service_name} — Rp {voucherService.price.toLocaleString('id-ID')}
              </span>
              <span style={{ color: 'var(--amber)', fontWeight: 600 }}>VOUCHER</span>
            </div>
          )}

          {coveredServices.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600, marginBottom: 4 }}>Ter-cover Paket</div>
              {coveredServices.map(s => (
                <div key={s.service_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-secondary)', textDecoration: 'line-through' }}>
                  <span>{s.service_name}</span>
                  <span>{fmtRp(s.price)}</span>
                </div>
              ))}
            </div>
          )}

          {payableServices.map(s => (
            <div key={s.service_name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 }}>
              <span>{s.service_name}</span>
              <span>{fmtRp(s.price)}</span>
            </div>
          ))}

          {selectedNewPkgs.map(p => (
            <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: 'var(--blue)' }}>
              <span>{p.name}</span>
              <span>{fmtRp(p.package_price)}</span>
            </div>
          ))}

          {discount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--red)', marginBottom: 4 }}>
              <span>Diskon</span>
              <span>-{fmtRp(discount)}</span>
            </div>
          )}

          {voucherAmount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--amber)', marginBottom: 4 }}>
              <span>Voucher ({voucherService!.service_name})</span>
              <span>-{fmtRp(voucherAmount)}</span>
            </div>
          )}

          {/* Biaya admin opsional — disembunyikan untuk pembayaran online (sudah settle). */}
          {!paidOnline && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, marginBottom: 4 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', color: 'var(--text-primary)' }}>
                <input type="checkbox" checked={addAdminFee} onChange={e => setAddAdminFee(e.target.checked)} style={{ width: 'auto' }} />
                Tambahkan Biaya Admin (Rp 50.000)
              </label>
              {addAdminFee && <span>{fmtRp(ADMIN_FEE)}</span>}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 15, borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
            <span>Total</span>
            <span style={{ color: voucherFullyCovers ? 'var(--amber)' : 'var(--red)' }}>{fmtRp(grandTotal)}</span>
          </div>
        </div>

        {/* Section beli paket baru — disembunyikan untuk pembayaran online */}
        {!paidOnline && (
        <div style={{ marginBottom: 16, padding: 14, background: 'var(--bg-elevated)', borderRadius: 10, border: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <input type="checkbox" id="buyPkg" checked={buyingPackage} onChange={e => setBuyingPackage(e.target.checked)} />
            <label htmlFor="buyPkg" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', cursor: 'pointer' }}>
              Tambah pembelian paket
            </label>
          </div>

          {buyingPackage && (
            <>
              {/* Multiselect via add-then-chip: pilih paket → masuk daftar; pilih lagi
                  untuk menambah paket kedua, dst. Paket yang sudah dipilih disaring
                  dari dropdown agar tidak dobel. */}
              <select
                value=""
                onChange={e => {
                  const id = e.target.value
                  if (id && !selectedNewPackageIds.includes(id)) {
                    setSelectedNewPackageIds(prev => [...prev, id])
                  }
                  e.target.value = ''
                }}
                style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13, marginBottom: 8 }}
              >
                <option value="">— Tambah Paket —</option>
                {[...new Set(packages.map(p => p.category))].map(cat => {
                  const opts = packages.filter(p => p.category === cat && !selectedNewPackageIds.includes(p.id))
                  if (opts.length === 0) return null
                  return (
                    <optgroup key={cat} label={`${cat} Package`}>
                      {opts.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {fmtRp(p.package_price)} ({p.sessions}x sesi, hemat {p.discount_percent}%)
                        </option>
                      ))}
                    </optgroup>
                  )
                })}
              </select>

              {selectedNewPkgs.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
                  {selectedNewPkgs.map(p => (
                    <div key={p.id} style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      padding: '8px 12px', borderRadius: 8,
                      background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)',
                    }}>
                      <div style={{ fontSize: 12, color: 'var(--blue)' }}>
                        <strong>{p.name}</strong> — {fmtRp(p.package_price)} untuk {p.sessions} sesi
                        {' '}(hemat {fmtRp(p.retail_price - p.package_price)})
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedNewPackageIds(prev => prev.filter(id => id !== p.id))}
                        style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer', padding: 0, lineHeight: 1, flexShrink: 0 }}
                        title="Hapus paket"
                      ><X size={16} /></button>
                    </div>
                  ))}
                </div>
              )}

              {selectedNewPkgs.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, paddingTop: 4, borderTop: '1px dashed var(--border)' }}>
                  <span>Subtotal paket ({selectedNewPkgs.length})</span>
                  <span style={{ fontWeight: 600, color: 'var(--blue)' }}>{fmtRp(packageSubtotal)}</span>
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
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)' }}>
                Sudah Dibayar Online
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                Pembayaran via Mayar sudah terkonfirmasi
              </div>
            </div>
          </div>
        )}

        {/* Banner voucher — 3 varian: servis booking hilang (warning), voucher parsial, voucher menutup semua */}
        {voucherMissing && (
          <div style={{ padding: '12px 14px', borderRadius: 10,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.4)',
            marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#FC8181' }}>
                Servis booking asli tidak ditemukan di visit ini
              </div>
              <div style={{ fontSize: 11, color: '#A8B8D8' }}>
                Booking memakai voucher, tapi servis yang di-booking sudah tidak ada di daftar layanan —
                voucher TIDAK diterapkan otomatis. Cek manual sebelum menagih.
              </div>
            </div>
          </div>
        )}
        {voucherService && (
          <div style={{ padding: '12px 14px', borderRadius: 10,
            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
            marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--amber)' }}>
                {voucherFullyCovers ? 'Sudah Dibayar dengan Voucher' : 'Voucher Menutup Sebagian'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                {voucherFullyCovers
                  ? `Voucher menutup ${voucherService.service_name} — tidak ada biaya tambahan`
                  : `Voucher hanya menutup ${voucherService.service_name} (${fmtRp(voucherAmount)}) — layanan lain dibayar normal`}
              </div>
            </div>
          </div>
        )}

        {/* Discount */}
        {!paidOnline && !voucherFullyCovers && (
          <div className="form-group">
            <label>Diskon (Rp)</label>
            {/* type=text + inputMode=numeric: keyboard angka di HP tanpa spinner; select()
                saat fokus supaya ketikan menimpa nilai lama (bukan nempel di belakang "0"). */}
            <input
              type="text" inputMode="numeric" pattern="[0-9]*"
              value={discount}
              onFocus={e => e.currentTarget.select()}
              onChange={e => {
                const n = Number(e.target.value.replace(/[^0-9]/g, '')) || 0
                setDiscount(Math.max(0, Math.min(n, maxDiscount)))
              }}
            />
          </div>
        )}

        {/* Payment method */}
        {needsMethod && (
          <>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 8, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1 }}>Metode Pembayaran</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
              {METHODS.map(m => {
                const on = method === m
                return (
                  <button key={m} type="button" onClick={() => setMethod(m)}
                    style={on ? {
                      flex: '1 1 80px', padding: '8px 14px', borderRadius: 8,
                      border: '1px solid var(--red)', background: 'var(--red)',
                      color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    } : {
                      flex: '1 1 80px', padding: '8px 14px', borderRadius: 8,
                      border: '1px solid var(--border-strong)', background: 'var(--bg-elevated)',
                      color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 500, fontSize: 13, transition: 'all 0.15s',
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
                <span style={{ fontWeight: 700, color: 'var(--green)' }}>{fmtRp(change)}</span>
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
          <label>Dokter Penanggung Jawab</label>
          <select value={doctorId} onChange={e => setDoctorId(e.target.value)} disabled={!canEditAssignment} style={{ width: '100%' }}>
            <option value="">— Belum di-assign —</option>
            {doctorOptions.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            {doctorId && !doctorOptions.some(o => o.id === doctorId) && (
              <option value={doctorId}>(staf nonaktif)</option>
            )}
          </select>
        </div>
        <div className="form-group">
          <label>Terapis Penanggung Jawab</label>
          <select value={therapistId} onChange={e => setTherapistId(e.target.value)} disabled={!canEditAssignment} style={{ width: '100%' }}>
            <option value="">— Belum di-assign —</option>
            {therapistOptions.map(o => <option key={o.id} value={o.id}>{o.full_name}</option>)}
            {therapistId && !therapistOptions.some(o => o.id === therapistId) && (
              <option value={therapistId}>(staf nonaktif)</option>
            )}
          </select>
        </div>
        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {canEditAssignment
            ? 'Terisi otomatis dari assignment yang ada — pilihan di sini menjadi penentu final. Setiap perubahan dicatat di log.'
            : 'Hanya admin, super admin, dan dokter berwenang yang dapat mengubah assignment ini.'}
        </p>

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
              style={{ accentColor: 'var(--red)', width: 16, height: 16 }}
            />
            <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
              Jadwalkan Kunjungan Berikutnya
            </span>
          </label>

          {scheduleFollowUp && (
            <div style={{ marginTop: 12, padding: '14px 16px', borderRadius: 10,
              background: 'var(--bg-input)', border: '1px solid var(--border)' }}>

              {/* Tanggal & Jam */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                    letterSpacing: 1, display: 'block', marginBottom: 4 }}>Tanggal *</label>
                  <input type="date" value={followUpDate}
                    onChange={e => setFollowUpDate(e.target.value)}
                    min={new Date().toISOString().slice(0, 10)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'var(--bg-page)', border: '1px solid var(--border-strong)',
                      color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' as const }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                    letterSpacing: 1, display: 'block', marginBottom: 4 }}>Jam</label>
                  <input type="time" value={followUpTime}
                    onChange={e => setFollowUpTime(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', borderRadius: 8,
                      background: 'var(--bg-page)', border: '1px solid var(--border-strong)',
                      color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' as const }} />
                </div>
              </div>

              {/* Pilih Layanan */}
              <div>
                <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
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
                    background: 'var(--bg-page)', border: '1px solid var(--border-strong)',
                    color: 'var(--text-primary)', fontSize: 13 }}
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
                        background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                        color: 'var(--text-primary)', fontSize: 12,
                        display: 'flex', alignItems: 'center', gap: 6,
                      }}>
                        {s.service_name}
                        <button
                          onClick={() => setFollowUpServices(prev =>
                            prev.filter(fs => fs.service_id !== s.service_id))}
                          style={{ background: 'none', border: 'none', color: 'var(--red)',
                            cursor: 'pointer', padding: 0, fontSize: 14, lineHeight: 1 }}
                        ><X size={18} /></button>
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
          <button
            className="btn-primary"
            onClick={handleConfirm}
            disabled={saving || checkingCompleteness || missingSections.length > 0 || (needsMethod && !method)}
            title={missingSections.length > 0 ? `Lengkapi dulu: ${missingSections.join(', ')}` : undefined}
          >
            {saving ? 'Memproses...' : checkingCompleteness ? 'Memeriksa kelengkapan…' : <>{paidOnline ? 'Konfirmasi & Selesai' : voucherFullyCovers ? 'Konfirmasi Voucher & Selesai' : 'Konfirmasi Pembayaran'} <ArrowRight size={14} style={{ verticalAlign: -2 }} /></>}
          </button>
        </div>
      </div>
    </div>
  )
}
