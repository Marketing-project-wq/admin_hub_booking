import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { fmtRp, fmtDate, fmtTime, fmtDateTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import ConfirmModal from '../../components/arena/ConfirmModal'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import {
  getBookings, getAllBookings, confirmBooking, cancelBooking, serviceName,
  todayISO, daysAgoISO, listServices, createManualBooking, createVisitFromBooking, orIlike,
  createPatientForBooking, NeedsPatientInfoError, getAvailableSlots,
  listClinicStaffOptions, updateBookingAssignment,
  type ClinicBooking, type BookingFilters, type ClinicService, type ClinicSlot, type ClinicStaffOption,
} from '../../lib/clinic'
import { normalizePhone } from '../../lib/phone'

const PAGE_SIZE = 20
const RED = 'var(--red)'

const checkinLabelStyle: React.CSSProperties = {
  fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
  letterSpacing: 1, display: 'block', marginBottom: 6,
}
const checkinInputStyle: React.CSSProperties = {
  width: '100%', padding: '10px 12px', borderRadius: 8,
  background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
  color: 'var(--text-primary)', fontSize: 14, boxSizing: 'border-box',
}

export default function ClinicBookings() {
  const { user } = useAuth()
  const [data, setData] = useState<ClinicBooking[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [error, setError] = useState('')

  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState(() => daysAgoISO(30))
  const [dateTo, setDateTo] = useState(todayISO)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [services, setServices] = useState<ClinicService[]>([])
  const [toast, setToast] = useState('')

  // Manual visit modal (3-step)
  const [showManualModal, setShowManualModal] = useState(false)
  const [manualStep, setManualStep] = useState<1 | 2 | 3>(1)
  // Hasil pembuatan booking manual (ditampilkan di step 3).
  const [manualBookingResult, setManualBookingResult] = useState<{ code: string; slotLinked: boolean; needsSlot: boolean } | null>(null)
  // Slot tersedia utk layanan slot-based (Physiotherapy/Sport Massage) di tanggal terpilih.
  const [manualSlots, setManualSlots] = useState<ClinicSlot[]>([])
  const [manualSlotsLoading, setManualSlotsLoading] = useState(false)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualError, setManualError] = useState<string | null>(null)
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<{ id: string; full_name: string; patient_code: string; phone: string }[]>([])
  const [selectedPatient, setSelectedPatient] = useState<{ id: string; full_name: string; patient_code: string; phone: string } | null>(null)
  const [searchLoading, setSearchLoading] = useState(false)
  const [manualServices, setManualServices] = useState<{ service_id: string; service_name: string; price: number }[]>([])
  const [manualDate, setManualDate] = useState(new Date().toISOString().slice(0, 10))
  const [manualTime, setManualTime] = useState('')
  const [manualComplaint, setManualComplaint] = useState('')
  const [manualDoctorId, setManualDoctorId] = useState('')
  const [manualTherapistId, setManualTherapistId] = useState('')
  // Staf klinik aktif (dokter/therapist) untuk dropdown assignment — via RPC.
  const [staffOptions, setStaffOptions] = useState<ClinicStaffOption[]>([])
  const [manualPatientMode, setManualPatientMode] = useState<'search' | 'new'>('search')
  const [newPatientForm, setNewPatientForm] = useState({
    full_name: '', phone: '', gender: 'male', date_of_birth: '',
    id_type: 'nik', id_number: '',
  })
  const [patientActivePackages, setPatientActivePackages] = useState<{
    id: string
    remaining_sessions: number
    package: { id: string; name: string; category: string }
  }[]>([])
  const [usePackageId, setUsePackageId] = useState<string | null>(null)
  const [packageServiceId, setPackageServiceId] = useState<string | null>(null)

  // Check-in pasien (booking status 'arrived')
  const [arrivedBookings, setArrivedBookings] = useState<ClinicBooking[]>([])
  const [showCheckinModal, setShowCheckinModal] = useState(false)
  const [checkinBooking, setCheckinBooking] = useState<ClinicBooking | null>(null)
  const [checkinKtp, setCheckinKtp] = useState('')
  const [checkinLoading, setCheckinLoading] = useState(false)
  const [checkinError, setCheckinError] = useState<string | null>(null)
  // Form identitas pasien — muncul kalau booking belum terhubung ke clinic_patients
  // manapun (patient_id kosong dan phone tidak match). Diisi staff dari KTP asli.
  const [checkinPatientForm, setCheckinPatientForm] = useState<{
    full_name: string; phone: string; email: string
    date_of_birth: string; gender: string
    id_type: 'nik' | 'sim' | 'passport'; id_number: string
  } | null>(null)

  const [selected, setSelected] = useState<ClinicBooking | null>(null)
  const [confirmConfirm, setConfirmConfirm] = useState<ClinicBooking | null>(null)
  const [confirmCancel, setConfirmCancel] = useState<ClinicBooking | null>(null)
  const [acting, setActing] = useState(false)

  const filters: BookingFilters = { status: statusFilter, dateFrom, dateTo, search }

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { data: rows, count } = await getBookings({ status: statusFilter, dateFrom, dateTo, search }, page, PAGE_SIZE)
      setData(rows); setTotal(count); setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, dateFrom, dateTo, search, page])

  const fetchArrivedBookings = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10)
    // LEFT join slot (bukan !inner): booking non-slot (mis. Doctor Consultation via
    // booking manual, slot_id null) juga harus tampil. Filter tanggal di klien:
    // ber-slot -> hanya slot hari ini; non-slot -> tampil selama status 'arrived'
    // (status itu di-set staff saat pasien benar-benar datang, jadi implisit hari ini).
    const { data } = await supabase
      .from('clinic_bookings')
      .select(`
        id, booking_code, full_name, phone, email, patient_id, status, visit_id,
        service:clinic_services(name),
        slot:clinic_slots(slot_date, start_time)
      `)
      .eq('status', 'arrived')
      .order('updated_at', { ascending: true })
    const rows = ((data ?? []) as any[]).filter(b => !b.slot || b.slot.slot_date === today)
    setArrivedBookings(rows as any)
  }, [])

  // Update status booking dari arrived ke checked_in + bereskan state modal
  const finishCheckin = async (booking: ClinicBooking) => {
    await supabase
      .from('clinic_bookings')
      .update({
        status: 'checked_in',
        check_in_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', booking.id)

    setShowCheckinModal(false)
    setCheckinBooking(null)
    setCheckinKtp('')
    setCheckinPatientForm(null)
    setToast(`Check-in berhasil — ${booking.full_name}`)
    fetchArrivedBookings()
    fetchData()
  }

  const handleCheckinConfirm = async () => {
    if (!checkinBooking) return
    setCheckinLoading(true)
    setCheckinError(null)
    try {
      // Update KTP di clinic_patients jika ada patient_id
      if ((checkinBooking as any).patient_id && checkinKtp.trim()) {
        await supabase
          .from('clinic_patients')
          .update({ id_number: checkinKtp.trim(), id_type: 'nik' })
          .eq('id', (checkinBooking as any).patient_id)
      }

      // Buat visit dari booking
      await createVisitFromBooking(checkinBooking.id)
      await finishCheckin(checkinBooking)
    } catch (e) {
      if (e instanceof NeedsPatientInfoError) {
        // Booking online tanpa pasien — minta staff lengkapi identitas asli dulu.
        // NIK yang terlanjur diketik di modal awal ikut terbawa, tidak dibuang.
        setCheckinPatientForm({
          full_name: checkinBooking.full_name ?? '',
          phone: checkinBooking.phone ?? '',
          email: checkinBooking.email ?? '',
          date_of_birth: '',
          gender: '',
          id_type: 'nik',
          id_number: checkinKtp.trim(),
        })
      } else {
        setCheckinError(e instanceof Error ? e.message : 'Check-in gagal')
      }
    } finally {
      setCheckinLoading(false)
    }
  }

  const setCheckinField = (k: keyof NonNullable<typeof checkinPatientForm>, v: string) =>
    setCheckinPatientForm(f => (f ? { ...f, [k]: v } : f))

  const checkinFormValid = !!(checkinPatientForm &&
    checkinPatientForm.full_name.trim() &&
    checkinPatientForm.date_of_birth &&
    checkinPatientForm.gender &&
    checkinPatientForm.id_number.trim())

  const handleCheckinNewPatient = async () => {
    if (!checkinBooking || !checkinPatientForm || !checkinFormValid) return
    setCheckinLoading(true)
    setCheckinError(null)
    try {
      await createPatientForBooking(checkinBooking.id, {
        full_name: checkinPatientForm.full_name.trim(),
        phone: checkinPatientForm.phone.trim() || null,
        email: checkinPatientForm.email.trim() || null,
        date_of_birth: checkinPatientForm.date_of_birth,
        gender: checkinPatientForm.gender as 'male' | 'female',
        id_type: checkinPatientForm.id_type,
        id_number: checkinPatientForm.id_number.trim(),
      })
      await createVisitFromBooking(checkinBooking.id)
      await finishCheckin(checkinBooking)
    } catch (e) {
      setCheckinError(e instanceof Error ? e.message : 'Check-in gagal')
    } finally {
      setCheckinLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
    fetchArrivedBookings()
    // Auto-refresh setiap 30 detik
    const interval = setInterval(fetchArrivedBookings, 30000)
    return () => clearInterval(interval)
  }, [fetchData, fetchArrivedBookings])

  useEffect(() => { listServices().then(setServices).catch(() => {}) }, [])
  useEffect(() => { listClinicStaffOptions().then(setStaffOptions).catch(() => {}) }, [])

  // Auto-clear toast.
  useEffect(() => {
    if (!toast) return
    const t = window.setTimeout(() => setToast(''), 3000)
    return () => window.clearTimeout(t)
  }, [toast])

  // Fetch paket aktif pasien saat selectedPatient berubah.
  useEffect(() => {
    if (!selectedPatient) {
      setPatientActivePackages([])
      setUsePackageId(null)
      setPackageServiceId(null)
      return
    }
    supabase
      .from('clinic_patient_packages')
      .select('id, remaining_sessions, package:clinic_packages(id, name, category)')
      .eq('patient_id', selectedPatient.id)
      .eq('is_active', true)
      .gt('remaining_sessions', 0)
      .then(({ data }) => setPatientActivePackages((data ?? []) as any))
  }, [selectedPatient])

  const searchPatients = async () => {
    if (!patientSearch.trim()) return
    setSearchLoading(true)
    try {
      // Kalau input tampak nomor telepon, cari juga varian ternormalisasi ('+62…'
      // menemukan pasien tersimpan '08…' dan sebaliknya).
      const phoneTerm = normalizePhone(patientSearch)
      const orExpr = phoneTerm.length >= 6 && phoneTerm !== patientSearch.trim()
        ? orIlike(['full_name', 'phone', 'patient_code'], patientSearch) + ',' + orIlike(['phone'], phoneTerm)
        : orIlike(['full_name', 'phone', 'patient_code'], patientSearch)
      const { data } = await supabase
        .from('clinic_patients')
        .select('id, full_name, patient_code, phone')
        .or(orExpr)
        .eq('is_active', true)
        .limit(5)
      setPatientResults(data ?? [])
    } catch { /* ignore */ }
    finally { setSearchLoading(false) }
  }

  const handleManualSubmit = async () => {
    if (!selectedPatient || manualServices.length === 0 && !packageServiceId) return
    if (manualNeedsSlot && !manualTime) { setManualError('Pilih jam dari slot yang tersedia.'); return }
    setManualLoading(true)
    setManualError(null)
    try {
      // Build services list
      const allServices = [
        ...manualServices,
        ...(packageServiceId && !manualServices.some(s => s.service_id === packageServiceId)
          ? [{
              service_id: packageServiceId,
              service_name: services.find(s => s.id === packageServiceId)?.name ?? '',
              price: 0,
            }]
          : []
        ),
      ]

      const { booking_code, slot_linked } = await createManualBooking({
        patient: { id: selectedPatient.id, full_name: selectedPatient.full_name, phone: selectedPatient.phone },
        visit_date: manualDate,
        visit_time: manualTime || null,
        chief_complaint: manualComplaint,
        services: allServices,
        patient_package_id: usePackageId ?? undefined,
        assigned_doctor_id: manualDoctorId || null,
        assigned_therapist_id: manualTherapistId || null,
        created_by: user?.full_name ?? 'Admin',
      })
      setManualBookingResult({ code: booking_code, slotLinked: slot_linked, needsSlot: manualNeedsSlot })
      setManualStep(3)
      setToast(`Booking ${booking_code} berhasil dibuat`)
      fetchData()
    } catch (e) {
      // claimSlot melempar 'Slot penuh' — tampilkan apa adanya biar staff paham.
      setManualError(e instanceof Error && e.message ? e.message : 'Gagal membuat booking. Coba lagi.')
    } finally {
      setManualLoading(false)
    }
  }

  const handleStep1Continue = async () => {
    if (manualPatientMode === 'search') {
      if (!selectedPatient) return
      setManualStep(2)
      return
    }

    // Pasien baru — date_of_birth & id_number NOT NULL di clinic_patients,
    // jadi wajib tervalidasi di sini, bukan mengandalkan penolakan DB.
    if (!newPatientForm.full_name.trim() || !newPatientForm.phone.trim() ||
        !newPatientForm.date_of_birth || !newPatientForm.id_number.trim()) {
      setManualError('Lengkapi semua field wajib (*): nama, nomor HP, tanggal lahir, dan nomor KTP.')
      return
    }
    setManualError(null)
    setManualLoading(true)
    try {
      const { data, error } = await supabase
        .from('clinic_patients')
        .insert({
          full_name: newPatientForm.full_name.trim(),
          phone: newPatientForm.phone.trim(),
          gender: newPatientForm.gender,
          date_of_birth: newPatientForm.date_of_birth,
          id_type: newPatientForm.id_type,
          id_number: newPatientForm.id_number.trim(),
          is_active: true,
        })
        .select('id, full_name, patient_code, phone')
        .single()

      if (error) throw error
      setSelectedPatient(data)
      setManualStep(2)
    } catch {
      setManualError('Gagal membuat pasien baru.')
    } finally {
      setManualLoading(false)
    }
  }

  const step1Ready = manualPatientMode === 'search'
    ? !!selectedPatient
    : !!(newPatientForm.full_name.trim() && newPatientForm.phone.trim() &&
         newPatientForm.date_of_birth && newPatientForm.id_number.trim())

  // Layanan slot-based (is_online_bookable: Physiotherapy/Sport Massage) wajib memilih
  // jam dari clinic_slots yang TERSEDIA (quota belum penuh) — bukan jam bebas.
  // Layanan non-slot (mis. Doctor Consultation) tetap tanggal+jam bebas.
  const slotBookableIds = new Set(services.filter(s => s.is_online_bookable).map(s => s.id))
  const manualNeedsSlot =
    manualServices.some(s => slotBookableIds.has(s.service_id)) ||
    (!!packageServiceId && slotBookableIds.has(packageServiceId))
  const manualReady = (manualServices.length > 0 || !!packageServiceId) && !(manualNeedsSlot && !manualTime)

  // Muat slot tersedia saat tanggal/komposisi layanan berubah; jam yang tidak lagi
  // valid (ganti tanggal, slot penuh) dikosongkan supaya tak lolos submit.
  useEffect(() => {
    if (!showManualModal || !manualNeedsSlot || !manualDate) return
    let cancelled = false
    setManualSlotsLoading(true)
    getAvailableSlots(manualDate)
      .then(s => {
        if (cancelled) return
        setManualSlots(s)
        setManualTime(t => (t && !s.some(sl => sl.start_time.slice(0, 5) === t) ? '' : t))
      })
      .catch(() => { if (!cancelled) setManualSlots([]) })
      .finally(() => { if (!cancelled) setManualSlotsLoading(false) })
    return () => { cancelled = true }
  }, [showManualModal, manualNeedsSlot, manualDate])

  // Ubah assignment dari modal detail booking ("isi belakangan"). Save-on-change;
  // TIDAK menyentuh visit yang sudah dibuat dari booking ini (independen).
  const handleAssignChange = async (
    b: ClinicBooking,
    key: 'assigned_doctor_id' | 'assigned_therapist_id',
    value: string | null,
  ) => {
    try {
      await updateBookingAssignment(b.id, { [key]: value })
      setSelected(prev => (prev && prev.id === b.id ? { ...prev, [key]: value } : prev))
      setToast('Assignment booking diperbarui')
      fetchData()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memperbarui assignment')
    }
  }

  const resetManualModal = () => {
    setManualStep(1)
    setManualBookingResult(null)
    setPatientSearch('')
    setPatientResults([])
    setSelectedPatient(null)
    setManualServices([])
    setManualDate(new Date().toISOString().slice(0, 10))
    setManualTime('')
    setManualComplaint('')
    setManualDoctorId('')
    setManualTherapistId('')
    setManualError(null)
    setManualPatientMode('search')
    setNewPatientForm({ full_name: '', phone: '', gender: 'male',
      date_of_birth: '', id_type: 'nik', id_number: '' })
    setPatientActivePackages([])
    setUsePackageId(null)
    setPackageServiceId(null)
    setShowManualModal(false)
  }

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleConfirm = async (b: ClinicBooking) => {
    setActing(true)
    try {
      await confirmBooking(b.id)
      setConfirmConfirm(null); setSelected(null); fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal konfirmasi')
    } finally { setActing(false) }
  }

  const handleCancel = async (b: ClinicBooking) => {
    setActing(true)
    try {
      await cancelBooking(b.id)
      setConfirmCancel(null); setSelected(null); fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan')
    } finally { setActing(false) }
  }

  const handleExport = async () => {
    try {
      const all = await getAllBookings(filters)
      const flat = all.map(b => ({
        booking_code: b.booking_code,
        service: serviceName(b),
        full_name: b.full_name,
        email: b.email || '',
        phone: b.phone || '',
        slot_date: b.slot_date || '',
        slot_time: b.slot_time || '',
        status: b.status,
        price: b.price,
        payment_method: b.payment_method || '',
        paid_at: b.paid_at || '',
        created_at: b.created_at,
      }))
      exportToCSV(flat as unknown as Record<string, unknown>[], 'clinic_bookings')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal export')
    }
  }

  const hasFilter = !!(search || statusFilter !== 'all' || dateFrom || dateTo)
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Clinic Bookings</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
          <button className="btn-primary" onClick={() => setShowManualModal(true)}>+ Tambah Booking Manual</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* Pasien Menunggu Check-in */}
      {arrivedBookings.length > 0 && (
        <div style={{ marginBottom: 24, padding: '16px 20px',
          background: 'rgba(192,57,43,0.06)',
          border: '1px solid rgba(192,57,43,0.2)',
          borderRadius: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%',
              background: RED, animation: 'pulse 1.5s infinite' }} />
            <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
              Pasien Menunggu Check-in ({arrivedBookings.length})
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {arrivedBookings.map(b => (
              <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', padding: '10px 14px', borderRadius: 10,
                background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>
                    {(b as any).full_name}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    {(b as any).service?.name ?? '-'} · {(b as any).slot?.start_time
                      ? `${(b as any).slot.start_time.slice(0, 5)} WIB`
                      : 'Non-slot'}
                  </div>
                </div>
                <button
                  onClick={() => { setCheckinBooking(b); setShowCheckinModal(true) }}
                  disabled={checkinLoading && checkinBooking?.id === b.id}
                  style={{ padding: '8px 16px', borderRadius: 8, background: RED,
                    color: '#fff', border: 'none',
                    cursor: checkinLoading && checkinBooking?.id === b.id ? 'not-allowed' : 'pointer',
                    opacity: checkinLoading && checkinBooking?.id === b.id ? 0.6 : 1,
                    fontWeight: 600, fontSize: 13, whiteSpace: 'nowrap' }}
                >
                  Check-in <ArrowRight size={13} style={{ verticalAlign: -2 }} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="filter-bar">
        <input
          type="text" placeholder="Cari nama, email, kode booking..."
          value={searchInput} onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="all">Semua Status</option>
          <option value="confirmed">Confirmed</option>
          <option value="pending_payment">Pending Payment</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} title="Dari tanggal" />
        <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>s/d</span>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} title="Sampai tanggal" />
        {hasFilter && (
          <button
            className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setSearchInput(''); setStatusFilter('all'); setDateFrom(''); setDateTo(''); setPage(0) }}
          >
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Booking Code</th><th>Layanan</th><th>Nama</th><th>Telp</th>
              <th>Tgl Slot</th><th>Jam</th><th>Status</th><th>Harga</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">Tidak ada data</td></tr>
            ) : data.map(b => {
              const s = STATUS_LABEL[b.status] || { label: b.status, css: '' }
              return (
                <tr key={b.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(b)}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.booking_code}</td>
                  <td>{serviceName(b)}</td>
                  <td>{b.full_name}</td>
                  <td>{b.phone || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(b.slot_date)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtTime(b.slot_time)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(b.price)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="pagination">
          <span>{total > 0 ? `${from}–${to} dari ${total} hasil` : '0 hasil'}</span>
          <div className="pagination-btns">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}><ArrowLeft size={13} style={{ verticalAlign: -2 }} /> Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
          </div>
        </div>
      </div>

      {/* ── Detail modal ─────────────────────────────────────────────────────── */}
      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Detail Booking</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 10, columnGap: 12, fontSize: 14 }}>
              <Field label="Booking Code" value={<span style={{ fontFamily: 'monospace' }}>{selected.booking_code}</span>} />
              <Field label="Layanan" value={serviceName(selected)} />
              <Field label="Nama" value={selected.full_name} />
              <Field label="Email" value={selected.email || '-'} />
              <Field label="Telp" value={selected.phone || '-'} />
              <Field label="Tgl Slot" value={fmtDate(selected.slot_date)} />
              <Field label="Jam" value={fmtTime(selected.slot_time)} />
              <Field label="Dokter" value={
                <select value={selected.assigned_doctor_id ?? ''}
                  onChange={e => handleAssignChange(selected, 'assigned_doctor_id', e.target.value || null)}
                  style={{ width: '100%', maxWidth: 260, padding: '6px 8px', borderRadius: 6, fontSize: 13 }}>
                  <option value="">— Belum di-assign —</option>
                  {staffOptions.filter(o => o.role === 'dokter').map(o => (
                    <option key={o.id} value={o.id}>{o.full_name}</option>
                  ))}
                  {selected.assigned_doctor_id && !staffOptions.some(o => o.id === selected.assigned_doctor_id) && (
                    <option value={selected.assigned_doctor_id}>(staf nonaktif)</option>
                  )}
                </select>
              } />
              <Field label="Terapis" value={
                <select value={selected.assigned_therapist_id ?? ''}
                  onChange={e => handleAssignChange(selected, 'assigned_therapist_id', e.target.value || null)}
                  style={{ width: '100%', maxWidth: 260, padding: '6px 8px', borderRadius: 6, fontSize: 13 }}>
                  <option value="">— Belum di-assign —</option>
                  {staffOptions.filter(o => o.role === 'therapist').map(o => (
                    <option key={o.id} value={o.id}>{o.full_name}</option>
                  ))}
                  {selected.assigned_therapist_id && !staffOptions.some(o => o.id === selected.assigned_therapist_id) && (
                    <option value={selected.assigned_therapist_id}>(staf nonaktif)</option>
                  )}
                </select>
              } />
              <Field label="Status" value={<span className={`badge ${(STATUS_LABEL[selected.status] || { css: '' }).css}`}>{(STATUS_LABEL[selected.status] || { label: selected.status }).label}</span>} />
              <Field label="Harga" value={fmtRp(selected.price)} />
              <Field label="Pembayaran" value={selected.payment_method || '-'} />
              <Field label="Dibayar" value={selected.paid_at ? fmtDateTime(selected.paid_at) : '-'} />
              <Field label="Dibuat" value={fmtDateTime(selected.created_at)} />
            </div>

            <div className="modal-footer">
              {selected.status === 'pending_payment' && (
                <button className="btn-primary" onClick={() => setConfirmConfirm(selected)}>Confirm</button>
              )}
              {selected.status !== 'cancelled' && (
                <button className="btn-danger" onClick={() => setConfirmCancel(selected)}>Cancel</button>
              )}
              <button className="btn-secondary" onClick={() => setSelected(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}

      {showManualModal && (
        <div className="modal-overlay" onClick={resetManualModal}>
          <div className="modal-box" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>

            {manualStep === 1 && (
              <div>
                <h3 style={{ color: 'var(--text-primary)', marginBottom: 16 }}>Step 1: Pilih Pasien</h3>

                {/* Toggle: Pasien Lama / Baru */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <button
                    onClick={() => setManualPatientMode('search')}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: manualPatientMode === 'search' ? 'var(--red)' : 'var(--bg-elevated)',
                      color: manualPatientMode === 'search' ? '#fff' : 'var(--text-secondary)',
                      border: 'none', cursor: 'pointer',
                    }}
                  >
                    Pasien Lama
                  </button>
                  <button
                    onClick={() => setManualPatientMode('new')}
                    style={{
                      flex: 1, padding: '8px 0', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: manualPatientMode === 'new' ? 'var(--red)' : 'var(--bg-elevated)',
                      color: manualPatientMode === 'new' ? '#fff' : 'var(--text-secondary)',
                      border: 'none', cursor: 'pointer',
                    }}
                  >
                    Pasien Baru
                  </button>
                </div>

                {manualPatientMode === 'search' && (
                  <>
                    <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                      <input
                        value={patientSearch}
                        onChange={e => setPatientSearch(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && searchPatients()}
                        placeholder="Cari nama, HP, atau kode pasien..."
                        style={{ flex: 1, padding: '10px 12px', borderRadius: 8,
                          background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                          color: 'var(--text-primary)', fontSize: 13 }}
                      />
                      <button onClick={searchPatients} disabled={searchLoading}
                        style={{ padding: '10px 16px', borderRadius: 8, background: 'var(--red)',
                          color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                        {searchLoading ? '...' : 'Cari'}
                      </button>
                    </div>

                    {patientResults.length > 0 && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                        {patientResults.map(p => (
                          <div key={p.id}
                            onClick={() => { setSelectedPatient(p); setPatientResults([]) }}
                            style={{
                              padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                              background: selectedPatient?.id === p.id ? 'rgba(192,57,43,0.15)' : 'var(--bg-elevated)',
                              border: `1px solid ${selectedPatient?.id === p.id ? 'var(--red)' : 'var(--border)'}`,
                            }}
                          >
                            <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 13 }}>{p.full_name}</div>
                            <div style={{ color: 'var(--text-secondary)', fontSize: 11 }}>{p.patient_code} · {p.phone}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {manualPatientMode === 'new' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                    {[
                      { key: 'full_name', label: 'Nama Lengkap *', type: 'text', placeholder: 'Nama lengkap' },
                      { key: 'phone', label: 'Nomor HP *', type: 'text', placeholder: '08xx' },
                      { key: 'date_of_birth', label: 'Tanggal Lahir *', type: 'date', placeholder: '' },
                      { key: 'id_number', label: 'Nomor KTP *', type: 'text', placeholder: '16 digit' },
                    ].map(field => (
                      <div key={field.key}>
                        <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>
                          {field.label}
                        </label>
                        <input
                          type={field.type}
                          placeholder={field.placeholder}
                          value={newPatientForm[field.key as keyof typeof newPatientForm]}
                          onChange={e => setNewPatientForm(prev => ({ ...prev, [field.key]: e.target.value }))}
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                            background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                            color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' as const }}
                        />
                      </div>
                    ))}
                    <div>
                      <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>
                        Jenis Kelamin *
                      </label>
                      <select
                        value={newPatientForm.gender}
                        onChange={e => setNewPatientForm(prev => ({ ...prev, gender: e.target.value }))}
                        style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                          background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                          color: 'var(--text-primary)', fontSize: 13 }}
                      >
                        <option value="male">Laki-laki</option>
                        <option value="female">Perempuan</option>
                      </select>
                    </div>
                  </div>
                )}

                {selectedPatient && manualPatientMode === 'search' && (
                  <div style={{ padding: '12px 14px', borderRadius: 10,
                    background: 'rgba(192,57,43,0.1)', border: '1px solid rgba(192,57,43,0.3)',
                    marginBottom: 16 }}>
                    <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{selectedPatient.full_name}</div>
                    <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{selectedPatient.patient_code} · {selectedPatient.phone}</div>
                  </div>
                )}

                {manualError && (
                  <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{manualError}</div>
                )}

                <button
                  onClick={handleStep1Continue}
                  disabled={!step1Ready || manualLoading}
                  style={{ width: '100%', padding: 12, borderRadius: 8,
                    background: step1Ready ? 'var(--red)' : 'var(--bg-elevated)',
                    color: step1Ready ? '#fff' : 'var(--text-muted)',
                    border: 'none', cursor: step1Ready ? 'pointer' : 'not-allowed',
                    fontWeight: 600, fontSize: 14 }}
                >
                  {manualLoading ? 'Menyimpan...' : <>Lanjut <ArrowRight size={14} style={{ verticalAlign: -2 }} /></>}
                </button>
              </div>
            )}

            {manualStep === 2 && (
              <div>
                <h3 style={{ color: 'var(--text-primary)', marginBottom: 16 }}>Step 2: Layanan & Detail</h3>

                {/* Pasien terpilih */}
                <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--bg-elevated)',
                  marginBottom: 16, fontSize: 12, color: 'var(--text-secondary)' }}>
                  Pasien: <strong style={{ color: 'var(--text-primary)' }}>{selectedPatient?.full_name}</strong>
                </div>

                {/* Pilih Layanan */}
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                    letterSpacing: 1, display: 'block', marginBottom: 6 }}>
                    Pilih Layanan *
                  </label>
                  <select
                    onChange={e => {
                      const svc = services.find(s => s.id === e.target.value)
                      if (svc && !manualServices.some(ms => ms.service_id === svc.id)) {
                        setManualServices(prev => [...prev, {
                          service_id: svc.id, service_name: svc.name, price: svc.price
                        }])
                      }
                      e.target.value = ''
                    }}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                      background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                      color: 'var(--text-primary)', fontSize: 13 }}
                  >
                    <option value="">— Pilih layanan —</option>
                    {services.filter(s => !manualServices.some(ms => ms.service_id === s.id)).map(s => (
                      <option key={s.id} value={s.id}>{s.name} — Rp {s.price.toLocaleString('id-ID')}</option>
                    ))}
                  </select>

                  {manualServices.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {manualServices.map(s => (
                        <span key={s.service_id} style={{
                          padding: '4px 10px', borderRadius: 999,
                          background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                          color: 'var(--text-primary)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6
                        }}>
                          {s.service_name}
                          <button onClick={() => setManualServices(prev => prev.filter(ms => ms.service_id !== s.service_id))}
                            style={{ background: 'none', border: 'none', color: 'var(--red)', cursor: 'pointer',
                              padding: 0, fontSize: 14, lineHeight: 1 }}><X size={18} /></button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {patientActivePackages.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                      letterSpacing: 1, display: 'block', marginBottom: 8 }}>
                      Paket Aktif Pasien
                    </label>

                    {/* Opsi tidak pakai paket */}
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8,
                      fontSize: 13, cursor: 'pointer', marginBottom: 6, color: 'var(--text-secondary)' }}>
                      <input
                        type="radio"
                        checked={usePackageId === null}
                        onChange={() => { setUsePackageId(null); setPackageServiceId(null) }}
                        style={{ accentColor: 'var(--red)' }}
                      />
                      Tidak menggunakan paket
                    </label>

                    {patientActivePackages.map(pp => (
                      <div key={pp.id}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8,
                          fontSize: 13, cursor: 'pointer', marginBottom: 6 }}>
                          <input
                            type="radio"
                            checked={usePackageId === pp.id}
                            onChange={() => { setUsePackageId(pp.id); setPackageServiceId(null) }}
                            style={{ accentColor: 'var(--red)' }}
                          />
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                            {pp.package.name}
                          </span>
                          <span style={{ color: 'var(--text-secondary)', fontSize: 11 }}>
                            · Sisa {pp.remaining_sessions} sesi
                          </span>
                        </label>

                        {/* Sub-pilihan layanan dari paket */}
                        {usePackageId === pp.id && (() => {
                          const pkgCategory = pp.package.category.toLowerCase()
                          const coverableServices = services.filter(s =>
                            (s as any).package_category === pkgCategory
                          )
                          return coverableServices.length > 0 ? (
                            <div style={{ marginLeft: 24, padding: '10px 12px',
                              background: 'rgba(5,150,105,0.08)', borderRadius: 8,
                              border: '1px solid rgba(5,150,105,0.2)', marginBottom: 8 }}>
                              <div style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600,
                                marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                                Pilih layanan dari paket:
                              </div>
                              {coverableServices.map(s => (
                                <label key={s.id} style={{ display: 'flex', alignItems: 'center',
                                  gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 4, color: 'var(--text-secondary)' }}>
                                  <input
                                    type="radio"
                                    checked={packageServiceId === s.id}
                                    onChange={() => setPackageServiceId(s.id)}
                                    style={{ accentColor: 'var(--red)' }}
                                  />
                                  {s.name}
                                  <span style={{ color: 'var(--green)', fontSize: 11, fontWeight: 600 }}>GRATIS</span>
                                </label>
                              ))}
                            </div>
                          ) : null
                        })()}
                      </div>
                    ))}
                  </div>
                )}

                {/* Tanggal & Jam */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                      letterSpacing: 1, display: 'block', marginBottom: 6 }}>Tanggal *</label>
                    <input type="date" value={manualDate}
                      onChange={e => setManualDate(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                        background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                        color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }} />
                  </div>
                  <div>
                    {manualNeedsSlot ? (
                      <>
                        <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                          letterSpacing: 1, display: 'block', marginBottom: 6 }}>Jam (slot tersedia) *</label>
                        {manualSlotsLoading ? (
                          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>Memuat slot…</p>
                        ) : manualSlots.length === 0 ? (
                          <p style={{ fontSize: 12, color: 'var(--text-primary)', background: 'rgba(245,158,11,0.12)', borderLeft: '3px solid #f59e0b', borderRadius: 6, padding: '8px 10px', margin: 0, lineHeight: 1.4 }}>
                            Tidak ada slot tersedia di tanggal ini — coba tanggal lain.
                          </p>
                        ) : (
                          <select value={manualTime} onChange={e => setManualTime(e.target.value)}
                            style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                              background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                              color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }}>
                            <option value="">— Pilih jam —</option>
                            {manualSlots.map(sl => (
                              <option key={sl.id} value={sl.start_time.slice(0, 5)}>
                                {sl.start_time.slice(0, 5)}–{sl.end_time.slice(0, 5)} (sisa {sl.quota - sl.booked_count})
                              </option>
                            ))}
                          </select>
                        )}
                      </>
                    ) : (
                      <>
                        <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                          letterSpacing: 1, display: 'block', marginBottom: 6 }}>Jam</label>
                        <input type="time" value={manualTime}
                          onChange={e => setManualTime(e.target.value)}
                          style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                            background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                            color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }} />
                      </>
                    )}
                  </div>
                </div>

                {/* Assignment staff — opsional, boleh diisi belakangan */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                      letterSpacing: 1, display: 'block', marginBottom: 6 }}>Assign Dokter (opsional)</label>
                    <select value={manualDoctorId} onChange={e => setManualDoctorId(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                        background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                        color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }}>
                      <option value="">— Belum di-assign —</option>
                      {staffOptions.filter(o => o.role === 'dokter').map(o => (
                        <option key={o.id} value={o.id}>{o.full_name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                      letterSpacing: 1, display: 'block', marginBottom: 6 }}>Assign Terapis (opsional)</label>
                    <select value={manualTherapistId} onChange={e => setManualTherapistId(e.target.value)}
                      style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                        background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                        color: 'var(--text-primary)', fontSize: 13, boxSizing: 'border-box' }}>
                      <option value="">— Belum di-assign —</option>
                      {staffOptions.filter(o => o.role === 'therapist').map(o => (
                        <option key={o.id} value={o.id}>{o.full_name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Keluhan */}
                <div style={{ marginBottom: 16 }}>
                  <label style={{ fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase',
                    letterSpacing: 1, display: 'block', marginBottom: 6 }}>Keluhan Utama</label>
                  <textarea value={manualComplaint}
                    onChange={e => setManualComplaint(e.target.value)}
                    rows={3}
                    placeholder="Deskripsikan keluhan pasien..."
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 8,
                      background: 'var(--bg-input)', border: '1px solid var(--border-strong)',
                      color: 'var(--text-primary)', fontSize: 13, resize: 'vertical', boxSizing: 'border-box' }} />
                </div>

                {manualError && (
                  <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{manualError}</div>
                )}

                <div style={{ display: 'flex', gap: 10 }}>
                  <button onClick={() => setManualStep(1)}
                    style={{ flex: 1, padding: 12, borderRadius: 8,
                      background: 'var(--bg-elevated)', border: '1px solid var(--border)',
                      color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600 }}>
                    <ArrowLeft size={14} style={{ verticalAlign: -2 }} /> Kembali
                  </button>
                  <button
                    onClick={handleManualSubmit}
                    disabled={!manualReady || manualLoading}
                    style={{ flex: 2, padding: 12, borderRadius: 8,
                      background: manualReady ? 'var(--red)' : 'var(--bg-elevated)',
                      color: manualReady ? '#fff' : 'var(--text-muted)',
                      border: 'none', cursor: manualReady ? 'pointer' : 'not-allowed',
                      fontWeight: 600, fontSize: 14 }}>
                    {manualLoading ? 'Menyimpan...' : <>Buat Booking <ArrowRight size={14} style={{ verticalAlign: -2 }} /></>}
                  </button>
                </div>
              </div>
            )}

            {manualStep === 3 && (
              <div style={{ textAlign: 'center', padding: '20px 0' }}>
                <h3 style={{ color: 'var(--text-primary)', marginBottom: 8 }}>Booking Berhasil Dibuat!</h3>
                {manualBookingResult && (
                  <p style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 700, color: 'var(--red)', marginBottom: 12 }}>
                    {manualBookingResult.code}
                  </p>
                )}
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
                  Pasien: <strong style={{ color: 'var(--text-primary)' }}>{selectedPatient?.full_name}</strong>
                </p>
                <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 12 }}>
                  Layanan: {manualServices.map(s => s.service_name).join(', ')}
                </p>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: manualBookingResult?.needsSlot && !manualBookingResult.slotLinked ? 8 : 24 }}>
                  Booking akan diproses check-in pada hari kunjungan (via daftar booking atau kode di atas).
                </p>
                {manualBookingResult?.needsSlot === true && manualBookingResult.slotLinked === false && (
                  <p style={{ fontSize: 12, color: 'var(--text-primary)', background: 'rgba(245,158,11,0.12)', borderLeft: '3px solid #f59e0b', borderRadius: 6, padding: '8px 10px', margin: '0 0 24px', textAlign: 'left', lineHeight: 1.4 }}>
                    Tidak ada slot yang cocok dengan tanggal/jam ini — kursi TIDAK terkunci dan booking
                    tidak muncul di daftar "Menunggu Check-in" (tetap bisa check-in via kode booking).
                  </p>
                )}
                <button onClick={resetManualModal}
                  style={{ padding: '12px 32px', borderRadius: 8, background: 'var(--red)',
                    color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
                  Selesai
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {confirmConfirm && (
        <ConfirmModal
          title="Konfirmasi Booking"
          message={`Konfirmasi booking ${confirmConfirm.booking_code}?`}
          onConfirm={() => handleConfirm(confirmConfirm)}
          onCancel={() => setConfirmConfirm(null)}
          loading={acting}
        />
      )}
      {confirmCancel && (
        <ConfirmModal
          title="Batalkan Booking"
          message={`Batalkan booking ${confirmCancel.booking_code}?`}
          onConfirm={() => handleCancel(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
          danger
          loading={acting}
        />
      )}

      {showCheckinModal && checkinBooking && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
          padding: 16 }}>
          <div style={{ background: 'var(--bg-modal)', border: '1px solid var(--border-strong)',
            borderRadius: 16, padding: 24, width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto' }}>

            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
                  Check-in Pasien
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {(checkinBooking as any).booking_code}
                </div>
              </div>
              <button onClick={() => { setShowCheckinModal(false); setCheckinKtp(''); setCheckinPatientForm(null); setCheckinError(null) }}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)',
                  cursor: 'pointer', fontSize: 20 }}><X size={18} /></button>
            </div>

            {/* Info pasien */}
            <div style={{ padding: '12px 14px', borderRadius: 10, background: 'var(--bg-elevated)',
              marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', marginBottom: 4 }}>
                {(checkinBooking as any).full_name}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                {(checkinBooking as any).service?.name ?? '-'} · {(checkinBooking as any).slot?.start_time?.slice(0, 5) ?? '-'} WIB
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {(checkinBooking as any).phone}
              </div>
            </div>

            {!checkinPatientForm ? (
              /* Input KTP */
              <div style={{ marginBottom: 20 }}>
                <label style={checkinLabelStyle}>
                  Nomor KTP / NIK
                </label>
                <input
                  type="text"
                  value={checkinKtp}
                  onChange={e => setCheckinKtp(e.target.value)}
                  placeholder="16 digit NIK"
                  maxLength={16}
                  style={{ ...checkinInputStyle, fontFamily: "'JetBrains Mono', monospace" }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                  Opsional — bisa diisi untuk melengkapi data rekam medis
                </div>
              </div>
            ) : (
              /* Form identitas — booking belum terhubung ke pasien manapun */
              <div style={{ marginBottom: 20 }}>
                <div style={{ padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(228,0,43,0.08)', border: '1px solid rgba(228,0,43,0.25)',
                  fontSize: 12, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 }}>
                  Booking ini belum terhubung ke data pasien. Tanyakan identitas
                  pasien (dari KTP asli) dan lengkapi di bawah sebelum check-in.
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={checkinLabelStyle}>Nama Lengkap *</label>
                  <input type="text" value={checkinPatientForm.full_name}
                    onChange={e => setCheckinField('full_name', e.target.value)}
                    style={checkinInputStyle} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={checkinLabelStyle}>No. HP</label>
                    <input type="tel" value={checkinPatientForm.phone}
                      onChange={e => setCheckinField('phone', e.target.value)}
                      style={checkinInputStyle} />
                  </div>
                  <div>
                    <label style={checkinLabelStyle}>Email</label>
                    <input type="email" value={checkinPatientForm.email}
                      onChange={e => setCheckinField('email', e.target.value)}
                      style={checkinInputStyle} />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label style={checkinLabelStyle}>Tanggal Lahir *</label>
                    <input type="date" value={checkinPatientForm.date_of_birth}
                      max={new Date().toISOString().slice(0, 10)}
                      onChange={e => setCheckinField('date_of_birth', e.target.value)}
                      style={checkinInputStyle} />
                  </div>
                  <div>
                    <label style={checkinLabelStyle}>Jenis Kelamin *</label>
                    <select value={checkinPatientForm.gender}
                      onChange={e => setCheckinField('gender', e.target.value)}
                      style={checkinInputStyle}>
                      <option value="">Pilih…</option>
                      <option value="male">Laki-laki</option>
                      <option value="female">Perempuan</option>
                    </select>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 10 }}>
                  <div>
                    <label style={checkinLabelStyle}>Jenis ID *</label>
                    <select value={checkinPatientForm.id_type}
                      onChange={e => setCheckinField('id_type', e.target.value)}
                      style={checkinInputStyle}>
                      <option value="nik">KTP / NIK</option>
                      <option value="sim">SIM</option>
                      <option value="passport">Passport</option>
                    </select>
                  </div>
                  <div>
                    <label style={checkinLabelStyle}>Nomor ID *</label>
                    <input type="text" value={checkinPatientForm.id_number}
                      onChange={e => setCheckinField('id_number', e.target.value)}
                      placeholder="Sesuai identitas asli"
                      style={{ ...checkinInputStyle, fontFamily: "'JetBrains Mono', monospace" }} />
                  </div>
                </div>
              </div>
            )}

            {checkinError && (
              <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{checkinError}</div>
            )}

            {/* Buttons */}
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => { setShowCheckinModal(false); setCheckinKtp(''); setCheckinPatientForm(null); setCheckinError(null) }}
                style={{ flex: 1, padding: 12, borderRadius: 8, background: 'var(--bg-elevated)',
                  border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  cursor: 'pointer', fontWeight: 600 }}>
                Batal
              </button>
              {!checkinPatientForm ? (
                <button
                  onClick={handleCheckinConfirm}
                  disabled={checkinLoading}
                  style={{ flex: 2, padding: 12, borderRadius: 8, background: RED,
                    border: 'none', color: '#fff', cursor: checkinLoading ? 'not-allowed' : 'pointer',
                    fontWeight: 700, fontSize: 14 }}>
                  {checkinLoading ? 'Memproses...' : 'Konfirmasi Check-in'}
                </button>
              ) : (
                <button
                  onClick={handleCheckinNewPatient}
                  disabled={checkinLoading || !checkinFormValid}
                  style={{ flex: 2, padding: 12, borderRadius: 8,
                    background: checkinFormValid ? RED : 'var(--bg-elevated)',
                    border: 'none', color: checkinFormValid ? '#fff' : 'var(--text-muted)',
                    cursor: checkinLoading || !checkinFormValid ? 'not-allowed' : 'pointer',
                    fontWeight: 700, fontSize: 14 }}>
                  {checkinLoading ? 'Memproses...' : 'Simpan Pasien & Check-in'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 1100,
          background: '#080808', color: '#fff', padding: '12px 20px', borderRadius: 10,
          fontSize: 14, boxShadow: '0 4px 12px rgba(0,0,0,.2)',
        }}>{toast}</div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <>
      <div style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div style={{ fontWeight: 500 }}>{value}</div>
    </>
  )
}
