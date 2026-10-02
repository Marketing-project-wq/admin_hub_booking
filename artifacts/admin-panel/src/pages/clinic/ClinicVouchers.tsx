import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Copy, Check, Download } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fmtRp, fmtDate, fmtDateTime, fmtTime, exportToCSV } from '../../lib/format'
import { generateUniqueVoucherCode, getSavedVoucherPrefix, isVoucherCodeTaken } from '../../lib/voucherCode'
import VoucherCodeField from '../../components/VoucherCodeField'

// CLINIC — Voucher. Kode diskon untuk checkout booking.20fit.id/clinic.
//
// SUMBER DATA = arena_vouchers (tabel voucher terpadu, sama seperti Recovery/Gym) dengan
// location = 'CLINIC' dan applies_to = 'clinic_booking'. Scope layanan disimpan di
// applicable_clinic_service_ids (clinic_services.id; kosong = semua layanan).
// Checkout clinic memvalidasi lewat RPC verify_clinic_voucher / redeem_clinic_voucher
// (repo ARENA-BOOKING, migration 20261002100000_clinic_vouchers.sql).
//
// Pemakaian: used_count naik 1x per checkout online (saat customer menekan bayar, sebelum
// pembayaran selesai) atau 1x per Close Bill di Kasir. Detail siapa yang memakai dibaca dari
// clinic_bookings.voucher_code (online) + clinic_transactions.voucher_code (Kasir).

interface Voucher {
  id: string
  code: string
  description: string | null
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  min_booking_amount: number | null
  max_discount_amount: number | null
  quota: number | null
  used_count: number
  valid_from: string
  valid_until: string
  is_active: boolean
  applicable_clinic_service_ids: string[] | null
  created_by: string | null
  created_at: string
}

interface ServiceOpt {
  id: string
  name: string
  price: number
  service_group: string | null
  is_active: boolean
  is_online_bookable: boolean
}

interface UsageAgg { bookings: number; discount: number }

type ServiceEmbed = { name: string }
type SlotEmbed = { slot_date: string; start_time: string }
interface UsageRow {
  source: 'online' | 'kasir'
  id: string
  booking_code: string
  full_name: string
  email: string | null
  phone: string | null
  price: number
  discount: number | null
  price_before_disc: number | null
  status: string | null
  payment_method: string | null
  created_at: string
  appointment_date: string | null
  appointment_time: string | null
  manual_date: string | null
  manual_time: string | null
  // PostgREST mengembalikan embed to-one sebagai objek (versi lama: array)
  service: ServiceEmbed | ServiceEmbed[] | null
  slot: SlotEmbed | SlotEmbed[] | null
}

interface FormState {
  code: string
  description: string
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  max_discount: number | null
  min_amount: number
  quota: number | null          // null = tanpa batas
  valid_from: string
  valid_until: string           // '' = tanpa batas waktu
  is_active: boolean
  restrictServices: boolean
  serviceIds: Set<string>
}

type VStatus = 'active' | 'inactive' | 'expired' | 'scheduled' | 'exhausted'

const DEFAULT_PREFIX = 'CLN'
const FAR_FUTURE = '2099-12-31'   // arena_vouchers.valid_until NOT NULL → "tanpa batas"

// Tanggal hari ini di WIB (YYYY-MM-DD) — sama dengan acuan validasi di DB.
const todayWIB = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' })
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const endOfMonth = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
}

const emptyForm = (): FormState => ({
  code: '', description: '', discount_type: 'percentage', discount_value: 0,
  max_discount: null, min_amount: 0, quota: 1,
  valid_from: todayWIB(), valid_until: '', is_active: true,
  restrictServices: false, serviceIds: new Set(),
})

const formFromVoucher = (v: Voucher): FormState => {
  const ids = v.applicable_clinic_service_ids ?? []
  return {
    code: v.code, description: v.description ?? '',
    discount_type: v.discount_type, discount_value: v.discount_value,
    max_discount: v.max_discount_amount, min_amount: v.min_booking_amount ?? 0, quota: v.quota,
    valid_from: v.valid_from ?? '', valid_until: v.valid_until && v.valid_until !== FAR_FUTURE ? v.valid_until : '',
    is_active: v.is_active,
    restrictServices: ids.length > 0, serviceIds: new Set(ids),
  }
}

const statusOf = (v: Voucher, today: string): VStatus => {
  if (!v.is_active) return 'inactive'
  if (v.valid_until && v.valid_until < today) return 'expired'
  if (v.valid_from && v.valid_from > today) return 'scheduled'
  if (v.quota != null && v.used_count >= v.quota) return 'exhausted'
  return 'active'
}

const STATUS_META: Record<VStatus, { label: string; css: string }> = {
  active:    { label: 'Aktif',        css: 'badge-confirmed' },
  inactive:  { label: 'Nonaktif',     css: 'badge-cancelled' },
  expired:   { label: 'Kedaluwarsa',  css: 'badge-cancelled' },
  scheduled: { label: 'Belum Mulai',  css: 'badge-info' },
  exhausted: { label: 'Kuota Habis',  css: 'badge-pending' },
}

const BOOKING_STATUS: Record<string, { label: string; css: string }> = {
  pending_payment: { label: 'Menunggu Bayar', css: 'badge-pending' },
  confirmed:       { label: 'Confirmed',      css: 'badge-confirmed' },
  arrived:         { label: 'Datang',         css: 'badge-info' },
  checked_in:      { label: 'Check-in',       css: 'badge-info' },
  completed:       { label: 'Selesai',        css: 'badge-confirmed' },
  kasir_paid:      { label: 'Lunas · Kasir',  css: 'badge-confirmed' },
  cancelled:       { label: 'Batal',          css: 'badge-cancelled' },
  no_show:         { label: 'No Show',        css: 'badge-cancelled' },
}

const discountLabel = (v: Pick<Voucher, 'discount_type' | 'discount_value'>) =>
  v.discount_type === 'percentage' ? `${v.discount_value}%` : fmtRp(v.discount_value)

// Hitungan diskon sama dengan verify_clinic_voucher di DB (persen dibulatkan ke bawah,
// lalu dibatasi maks diskon dan harga item).
const calcDiscount = (price: number, f: Pick<FormState, 'discount_type' | 'discount_value' | 'max_discount'>) => {
  let d = f.discount_type === 'percentage'
    ? Math.floor((price * (Number(f.discount_value) || 0)) / 100)
    : Number(f.discount_value) || 0
  if (f.discount_type === 'percentage' && f.max_discount) d = Math.min(d, f.max_discount)
  return Math.max(0, Math.min(d, price))
}

const one = <T,>(x: T | T[] | null): T | null => (Array.isArray(x) ? x[0] ?? null : x)

const scheduleOf = (r: UsageRow) => {
  const slot = one(r.slot)
  if (slot) return `${fmtDate(slot.slot_date)} ${fmtTime(slot.start_time)}`
  const date = r.appointment_date ?? r.manual_date
  const time = r.appointment_time ?? r.manual_time
  return date ? `${fmtDate(date)}${time ? ` ${fmtTime(time)}` : ''}` : '-'
}

const labelStyle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--text-muted)', display: 'block', marginBottom: 6,
}
const chipStyle = (active: boolean): React.CSSProperties => ({
  fontSize: 11, padding: '4px 10px', borderRadius: 999, cursor: 'pointer',
  border: `1px solid ${active ? 'var(--red)' : 'var(--border-strong)'}`,
  background: active ? 'var(--red)' : 'transparent', color: active ? '#fff' : 'var(--text-muted)',
})

export default function ClinicVouchers() {
  const { user } = useAuth()
  const [data, setData] = useState<Voucher[]>([])
  const [services, setServices] = useState<ServiceOpt[]>([])
  const [usage, setUsage] = useState<Record<string, UsageAgg>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | VStatus>('all')
  const [serviceFilter, setServiceFilter] = useState('all')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [serviceSearch, setServiceSearch] = useState('')

  const [copied, setCopied] = useState<string | null>(null)

  const [usageVoucher, setUsageVoucher] = useState<Voucher | null>(null)
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')

  const today = todayWIB()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [vRes, sRes, uRes, tRes] = await Promise.all([
      supabase.from('arena_vouchers').select('*').eq('location', 'CLINIC').order('created_at', { ascending: false }),
      supabase.from('clinic_services')
        .select('id, name, price, service_group, is_active, is_online_bookable')
        .order('sort_order', { ascending: true }).order('name', { ascending: true }),
      supabase.from('clinic_bookings').select('voucher_code, discount, status').not('voucher_code', 'is', null),
      supabase.from('clinic_transactions').select('voucher_code, voucher_discount').not('voucher_code', 'is', null),
    ])
    if (vRes.error) { setError(vRes.error.message); setLoading(false); return }
    setData((vRes.data as Voucher[]) || [])
    setServices(((sRes.data as ServiceOpt[] | null) || []).map(s => ({ ...s, is_online_bookable: !!s.is_online_bookable })))

    // Agregat pemakaian per kode (booking batal tidak dihitung ke total diskon).
    const agg: Record<string, UsageAgg> = {}
    for (const r of (uRes.data || []) as { voucher_code: string; discount: number | null; status: string | null }[]) {
      const key = r.voucher_code.toUpperCase()
      agg[key] = agg[key] || { bookings: 0, discount: 0 }
      if (r.status === 'cancelled') continue
      agg[key].bookings += 1
      agg[key].discount += r.discount || 0
    }
    // Pemakaian di Kasir (Close Bill). Transaksi yang dibatalkan sudah terhapus dari tabel.
    for (const r of (tRes.data || []) as { voucher_code: string; voucher_discount: number | null }[]) {
      const key = r.voucher_code.toUpperCase()
      agg[key] = agg[key] || { bookings: 0, discount: 0 }
      agg[key].bookings += 1
      agg[key].discount += r.voucher_discount || 0
    }
    setUsage(agg)
    setError(''); setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const serviceById = useMemo(() => new Map(services.map(s => [s.id, s])), [services])

  // ── Form helpers ──────────────────────────────────────────────────────────
  const f = form
  const setF = (patch: Partial<FormState>) => setForm(p => ({ ...p, ...patch }))
  const codeLocked = !!editing && editing.used_count > 0   // kode tercatat di booking → jangan diubah

  // Dipakai Duplikat (tombol Generate di form ada di VoucherCodeField).
  const generateCode = async () => {
    setGenerating(true); setFormError('')
    try {
      setF({ code: await generateUniqueVoucherCode(getSavedVoucherPrefix('clinic', DEFAULT_PREFIX)) })
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Gagal membuat kode')
    } finally {
      setGenerating(false)
    }
  }

  const openAdd = () => {
    setForm(emptyForm()); setEditing(null); setFormError(''); setServiceSearch(''); setShowModal(true)
  }
  const openEdit = (v: Voucher) => {
    setForm(formFromVoucher(v)); setEditing(v); setFormError(''); setServiceSearch(''); setShowModal(true)
  }
  // Duplikat: pengaturan sama, kode baru (langsung di-generate), mulai berlaku hari ini.
  const openDuplicate = async (v: Voucher) => {
    const base = formFromVoucher(v)
    setForm({ ...base, code: '', is_active: true, valid_from: base.valid_from > today ? base.valid_from : today })
    setEditing(null); setFormError(''); setServiceSearch(''); setShowModal(true)
    await generateCode()
  }

  const toggleService = (id: string, on: boolean) => setForm(p => {
    const next = new Set(p.serviceIds)
    if (on) next.add(id); else next.delete(id)
    return { ...p, serviceIds: next }
  })

  // Layanan yang tampil di pemilih: aktif + yang sudah terpilih (walau sudah nonaktif).
  const pickerServices = useMemo(() => {
    const q = serviceSearch.trim().toLowerCase()
    return services
      .filter(s => s.is_active || f.serviceIds.has(s.id))
      .filter(s => !q || s.name.toLowerCase().includes(q) || (s.service_group ?? '').toLowerCase().includes(q))
  }, [services, f.serviceIds, serviceSearch])

  const pickerGroups = useMemo(() => {
    const groups = new Map<string, ServiceOpt[]>()
    for (const s of pickerServices) {
      const g = s.service_group || 'Lainnya'
      groups.set(g, [...(groups.get(g) || []), s])
    }
    return Array.from(groups.entries())
  }, [pickerServices])

  // Simulasi diskon untuk layanan terpilih (atau beberapa layanan online bila semua).
  const previewServices = useMemo(() => {
    const pool = f.restrictServices
      ? services.filter(s => f.serviceIds.has(s.id))
      : services.filter(s => s.is_active && s.is_online_bookable)
    return pool.slice(0, 4)
  }, [services, f.restrictServices, f.serviceIds])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const code = f.code.trim().toUpperCase()
    if (!code) return setFormError('Kode wajib diisi — klik "Generate Kode" untuk membuat otomatis')
    if (!/^[A-Z0-9-]{3,32}$/.test(code)) return setFormError('Kode hanya huruf, angka, dan tanda "-" (3–32 karakter)')
    if (!f.discount_value || f.discount_value <= 0) return setFormError('Nilai diskon harus > 0')
    if (f.discount_type === 'percentage' && f.discount_value > 100) return setFormError('Diskon persen maksimal 100%')
    if (f.quota != null && f.quota < 1) return setFormError('Kuota minimal 1 (kosongkan untuk tanpa batas)')
    if (editing && f.quota != null && f.quota < editing.used_count) {
      return setFormError(`Kuota tidak boleh lebih kecil dari pemakaian saat ini (${editing.used_count}x)`)
    }
    if (!f.valid_from) return setFormError('Tanggal mulai berlaku wajib diisi')
    if (f.valid_until && f.valid_until < f.valid_from) return setFormError('Tanggal berakhir harus setelah tanggal mulai')
    if (f.restrictServices && f.serviceIds.size === 0) {
      return setFormError('Pilih minimal 1 layanan, atau pilih "Semua layanan"')
    }

    setSaving(true)
    try {
      if (!editing || code !== editing.code) {
        if (await isVoucherCodeTaken(code, editing?.id)) {
          setFormError('Kode voucher sudah dipakai — klik "Generate Kode" untuk kode baru')
          return
        }
      }

      const payload = {
        code,
        description: f.description.trim() || null,
        discount_type: f.discount_type,
        discount_value: Number(f.discount_value),
        min_booking_amount: Number(f.min_amount) || 0,
        max_discount_amount: f.discount_type === 'percentage' ? (f.max_discount || null) : null,
        quota: f.quota != null ? Number(f.quota) : null,
        valid_from: f.valid_from,
        valid_until: f.valid_until || FAR_FUTURE,
        is_active: f.is_active,
        corporation_only: false,
        applies_to: 'clinic_booking',
        location: 'CLINIC',
        applicable_slugs: null,
        applicable_clinic_service_ids: f.restrictServices ? Array.from(f.serviceIds) : null,
        updated_at: new Date().toISOString(),
      }

      const res = editing
        ? await supabase.from('arena_vouchers').update(payload).eq('id', editing.id).eq('location', 'CLINIC')
        : await supabase.from('arena_vouchers').insert({
            ...payload, used_count: 0,
            created_by: user?.email || user?.full_name || 'admin',
            created_at: new Date().toISOString(),
          })
      if (res.error) {
        setFormError(res.error.code === '23505' ? 'Kode voucher sudah dipakai' : res.error.message)
        return
      }
      setShowModal(false)
      fetchData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan voucher')
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (v: Voucher) => {
    const { error: err } = await supabase.from('arena_vouchers')
      .update({ is_active: !v.is_active, updated_at: new Date().toISOString() })
      .eq('id', v.id).eq('location', 'CLINIC')
    if (err) setError(err.message); else fetchData()
  }

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = code; document.body.appendChild(ta); ta.select()
      document.execCommand('copy'); document.body.removeChild(ta)
    }
    setCopied(code)
    window.setTimeout(() => setCopied(c => (c === code ? null : c)), 1500)
  }

  // ── Pemakaian (siapa yang memakai) ────────────────────────────────────────
  const openUsage = async (v: Voucher) => {
    setUsageVoucher(v); setUsageRows([]); setUsageError(''); setUsageLoading(true)
    const [bRes, tRes] = await Promise.all([
      supabase
        .from('clinic_bookings')
        .select(`
          id, booking_code, full_name, email, phone, price, discount, price_before_disc,
          status, payment_method, created_at, appointment_date, appointment_time, manual_date, manual_time,
          service:clinic_services(name),
          slot:clinic_slots(slot_date, start_time)
        `)
        .eq('voucher_code', v.code),
      supabase
        .from('clinic_transactions')
        .select(`
          id, transaction_code, service_name, total_amount, voucher_discount, payment_method, created_at,
          patient:clinic_patients(full_name, phone),
          visit:clinic_visits(visit_date, visit_time)
        `)
        .eq('voucher_code', v.code),
    ])
    const err = bRes.error || tRes.error
    if (err) setUsageError(err.message)
    type TrxRow = {
      id: string; transaction_code: string; service_name: string; total_amount: number
      voucher_discount: number | null; payment_method: string; created_at: string
      patient: { full_name: string; phone: string | null } | { full_name: string; phone: string | null }[] | null
      visit: { visit_date: string | null; visit_time: string | null } | { visit_date: string | null; visit_time: string | null }[] | null
    }
    const online = ((bRes.data || []) as unknown as Omit<UsageRow, 'source'>[]).map(r => ({ ...r, source: 'online' as const }))
    // Transaksi Kasir dinormalisasi ke bentuk baris yang sama: Dibayar = total transaksi,
    // Diskon = potongan dari voucher ini, Harga Normal = keduanya dijumlah.
    const kasir: UsageRow[] = ((tRes.data || []) as unknown as TrxRow[]).map(t => {
      const pt = one(t.patient)
      const vs = one(t.visit)
      const vd = t.voucher_discount || 0
      return {
        source: 'kasir', id: t.id, booking_code: t.transaction_code,
        full_name: pt?.full_name ?? '-', email: null, phone: pt?.phone ?? null,
        price: t.total_amount, discount: vd, price_before_disc: t.total_amount + vd,
        status: 'kasir_paid', payment_method: t.payment_method, created_at: t.created_at,
        appointment_date: vs?.visit_date ?? null, appointment_time: vs?.visit_time ?? null,
        manual_date: null, manual_time: null,
        service: { name: t.service_name }, slot: null,
      }
    })
    setUsageRows([...online, ...kasir].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    setUsageLoading(false)
  }

  const usageSummary = useMemo(() => {
    const active = usageRows.filter(r => r.status !== 'cancelled')
    const customers = new Set(active.map(r => (r.email || r.phone || r.full_name || '').toLowerCase()))
    return {
      bookings: active.length,
      cancelled: usageRows.length - active.length,
      customers: customers.size,
      discount: active.reduce((s, r) => s + (r.discount || 0), 0),
      paid: active.filter(r => r.status !== 'pending_payment').reduce((s, r) => s + (r.price || 0), 0),
    }
  }, [usageRows])

  const exportUsage = () => {
    if (!usageVoucher) return
    exportToCSV(usageRows.map(r => ({
      'Tanggal Pakai': fmtDateTime(r.created_at),
      'Sumber': r.source === 'kasir' ? 'Kasir' : 'Online',
      'Kode Booking / Transaksi': r.booking_code,
      'Nama': r.full_name,
      'Email': r.email ?? '',
      'No HP': r.phone ?? '',
      'Layanan': one(r.service)?.name ?? '',
      'Jadwal': scheduleOf(r),
      'Harga Normal': r.price_before_disc ?? r.price + (r.discount || 0),
      'Diskon': r.discount || 0,
      'Dibayar': r.price,
      'Status': (BOOKING_STATUS[r.status ?? ''] || { label: r.status ?? '' }).label,
    })), `voucher_clinic_${usageVoucher.code}`)
  }

  // ── List ──────────────────────────────────────────────────────────────────
  const displayData = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter(v => {
      if (q && !v.code.toLowerCase().includes(q) && !(v.description ?? '').toLowerCase().includes(q)) return false
      if (statusFilter !== 'all' && statusOf(v, today) !== statusFilter) return false
      if (serviceFilter !== 'all') {
        const ids = v.applicable_clinic_service_ids ?? []
        if (ids.length > 0 && !ids.includes(serviceFilter)) return false
      }
      return true
    })
  }, [data, search, statusFilter, serviceFilter, today])

  const kpi = useMemo(() => ({
    total: data.length,
    active: data.filter(v => statusOf(v, today) === 'active').length,
    used: data.reduce((s, v) => s + (v.used_count || 0), 0),
    discount: data.reduce((s, v) => s + (usage[v.code.toUpperCase()]?.discount || 0), 0),
  }), [data, usage, today])

  const scopeLabel = (v: Voucher) => {
    const ids = v.applicable_clinic_service_ids ?? []
    if (ids.length === 0) return { short: 'Semua layanan', full: 'Semua layanan clinic' }
    const names = ids.map(id => serviceById.get(id)?.name ?? '(layanan dihapus)')
    return { short: ids.length <= 2 ? names.join(', ') : `${ids.length} layanan`, full: names.join(', ') }
  }

  const hasFilter = !!search || statusFilter !== 'all' || serviceFilter !== 'all'

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Voucher Clinic</h2>
        <button className="btn-primary" onClick={openAdd}>+ Buat Voucher</button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Kode diskon untuk booking online di <b>booking.20fit.id/clinic</b> dan untuk <b>Close Bill di Kasir</b>.
        Bisa dibatasi ke layanan tertentu, diskon persen atau nominal, masa berlaku, dan kuota pemakaian.
      </p>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">Total Voucher</div><div className="kpi-value">{kpi.total}</div></div>
        <div className="kpi-card"><div className="kpi-label">Aktif & Bisa Dipakai</div><div className="kpi-value">{kpi.active}</div></div>
        <div className="kpi-card"><div className="kpi-label">Total Pemakaian</div><div className="kpi-value">{kpi.used}</div><div className="kpi-sub">checkout</div></div>
        <div className="kpi-card"><div className="kpi-label">Total Diskon Diberikan</div><div className="kpi-value" style={{ fontSize: 24 }}>{fmtRp(kpi.discount)}</div><div className="kpi-sub">booking tidak batal</div></div>
      </div>

      <div className="filter-bar">
        <input type="text" placeholder="Cari kode / deskripsi..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | VStatus)}>
          <option value="all">Semua Status</option>
          {(Object.keys(STATUS_META) as VStatus[]).map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select value={serviceFilter} onChange={e => setServiceFilter(e.target.value)}>
          <option value="all">Semua Layanan</option>
          {services.filter(s => s.is_active).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {hasFilter && (
          <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setStatusFilter('all'); setServiceFilter('all') }}>Reset</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kode</th><th>Deskripsi</th><th>Diskon</th><th>Layanan</th><th>Min. Belanja</th>
              <th>Pemakaian</th><th>Masa Berlaku</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={9}>Memuat data...</td></tr>
            ) : displayData.length === 0 ? (
              <tr><td colSpan={9} className="empty-state">{hasFilter ? 'Tidak ada voucher yang cocok' : 'Belum ada voucher — klik "+ Buat Voucher"'}</td></tr>
            ) : displayData.map(v => {
              const st = statusOf(v, today)
              const scope = scopeLabel(v)
              const pct = v.quota ? Math.min(100, Math.round((v.used_count / v.quota) * 100)) : 0
              return (
                <tr key={v.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{v.code}</span>
                    <button type="button" onClick={() => copyCode(v.code)} title="Salin kode"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: copied === v.code ? 'var(--green)' : 'var(--text-muted)', padding: '0 0 0 6px', verticalAlign: 'middle' }}>
                      {copied === v.code ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                  </td>
                  <td>{v.description || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {discountLabel(v)}
                    {v.discount_type === 'percentage' && v.max_discount_amount
                      ? <span style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block' }}>maks {fmtRp(v.max_discount_amount)}</span>
                      : null}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 200 }} title={scope.full}>{scope.short}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{v.min_booking_amount ? fmtRp(v.min_booking_amount) : '-'}</td>
                  <td style={{ minWidth: 110 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{v.used_count} / {v.quota ?? '∞'}</div>
                    {v.quota ? (
                      <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, marginTop: 4, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--amber)' : 'var(--green)' }} />
                      </div>
                    ) : null}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {fmtDate(v.valid_from)} – {v.valid_until && v.valid_until !== FAR_FUTURE ? fmtDate(v.valid_until) : 'tanpa batas'}
                  </td>
                  <td><span className={`badge ${STATUS_META[st].css}`}>{STATUS_META[st].label}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => openUsage(v)}>Pemakaian</button>
                    <button className="action-btn detail" onClick={() => openEdit(v)}>Edit</button>
                    <button className="action-btn detail" onClick={() => openDuplicate(v)} title="Buat voucher baru dengan pengaturan sama + kode baru">Duplikat</button>
                    <button className={`action-btn ${v.is_active ? 'cancel' : 'confirm'}`} onClick={() => toggleActive(v)}>
                      {v.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* ── Modal Buat / Edit ── */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editing ? 'Edit Voucher' : 'Buat Voucher'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <VoucherCodeField
                value={f.code}
                onChange={code => { setF({ code }); setFormError('') }}
                storageKey="clinic"
                defaultPrefix={DEFAULT_PREFIX}
                disabled={codeLocked}
                disabledHint={`Kode tidak bisa diubah karena sudah dipakai ${editing?.used_count ?? 0}x.`}
                onError={setFormError}
                onGeneratingChange={setGenerating}
              />

              <div className="form-group">
                <label>Deskripsi (internal)</label>
                <input type="text" value={f.description} onChange={e => setF({ description: e.target.value })}
                  placeholder="mis. Promo Oktober — diskon fisioterapi" />
              </div>

              <div className="form-group">
                <label>Tipe Diskon *</label>
                <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                  {([['percentage', 'Persentase (%)'], ['fixed', 'Nominal (Rp)']] as const).map(([t, lbl]) => (
                    <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                      <input type="radio" name="dtype" value={t} checked={f.discount_type === t} onChange={() => setF({ discount_type: t })} style={{ width: 'auto' }} />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nilai Diskon * {f.discount_type === 'percentage' ? '(%)' : '(Rp)'}</label>
                  <input type="number" min={0} max={f.discount_type === 'percentage' ? 100 : undefined}
                    value={f.discount_value || ''} onChange={e => setF({ discount_value: Number(e.target.value) })} required />
                </div>
                {f.discount_type === 'percentage' ? (
                  <div className="form-group">
                    <label>Maks Diskon (Rp)</label>
                    <input type="number" min={0} value={f.max_discount || ''}
                      onChange={e => setF({ max_discount: Number(e.target.value) || null })} placeholder="opsional" />
                  </div>
                ) : <div />}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Min. Belanja (Rp)</label>
                  <input type="number" min={0} value={f.min_amount || ''} placeholder="0"
                    onChange={e => setF({ min_amount: Number(e.target.value) || 0 })} />
                  <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Dihitung dari total layanan yang berlaku voucher.</small>
                </div>
                <div className="form-group">
                  <label>Kuota Pemakaian</label>
                  <input type="number" min={1} value={f.quota ?? ''} placeholder="tanpa batas"
                    onChange={e => setF({ quota: e.target.value === '' ? null : Number(e.target.value) })} />
                  <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Berapa kali bisa dipakai (1x per checkout). Kosong = tanpa batas.</small>
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Berlaku Dari *</label>
                  <input type="date" value={f.valid_from} onChange={e => setF({ valid_from: e.target.value })} required />
                </div>
                <div className="form-group">
                  <label>Berlaku Sampai</label>
                  <input type="date" value={f.valid_until} min={f.valid_from || undefined} onChange={e => setF({ valid_until: e.target.value })} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: -6, marginBottom: 16 }}>
                {([
                  ['7 hari', addDays(f.valid_from || today, 6)],
                  ['30 hari', addDays(f.valid_from || today, 29)],
                  ['Akhir bulan', endOfMonth(f.valid_from || today)],
                  ['Tanpa batas', ''],
                ] as const).map(([lbl, val]) => (
                  <button key={lbl} type="button" style={chipStyle(f.valid_until === val)} onClick={() => setF({ valid_until: val })}>{lbl}</button>
                ))}
                <small style={{ color: 'var(--text-muted)', fontSize: 11, alignSelf: 'center' }}>
                  {f.valid_until ? `Berlaku s/d ${fmtDate(f.valid_until)} 23:59 WIB` : 'Tanpa tanggal berakhir'}
                </small>
              </div>

              {/* Scope layanan */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
                <span style={labelStyle}>Berlaku Untuk Layanan *</span>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input type="radio" name="scope" checked={!f.restrictServices} onChange={() => setF({ restrictServices: false })} style={{ width: 'auto' }} />
                    Semua layanan
                  </label>
                  <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input type="radio" name="scope" checked={f.restrictServices} onChange={() => setF({ restrictServices: true })} style={{ width: 'auto' }} />
                    Pilih layanan tertentu
                  </label>
                </div>
                {f.restrictServices && (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <input type="text" placeholder="Cari layanan..." value={serviceSearch}
                        onChange={e => setServiceSearch(e.target.value)} style={{ flex: 1 }} />
                      <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{f.serviceIds.size} dipilih</span>
                      {f.serviceIds.size > 0 && (
                        <button type="button" className="btn-text" style={{ fontSize: 12 }} onClick={() => setF({ serviceIds: new Set() })}>Kosongkan</button>
                      )}
                    </div>
                    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                      {pickerGroups.length === 0 ? (
                        <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Tidak ada layanan</div>
                      ) : pickerGroups.map(([group, list]) => (
                        <div key={group}>
                          <div style={{ padding: '6px 12px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', background: 'var(--bg-input)' }}>{group}</div>
                          {list.map(s => (
                            <label key={s.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, opacity: s.is_active ? 1 : 0.6 }}>
                              <input type="checkbox" checked={f.serviceIds.has(s.id)} onChange={e => toggleService(s.id, e.target.checked)} style={{ width: 'auto' }} />
                              <span style={{ flex: 1 }}>
                                {s.name}
                                {!s.is_online_bookable && <span style={{ color: 'var(--amber)', fontSize: 11 }}> · hanya via Kasir</span>}
                                {!s.is_active && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · nonaktif</span>}
                              </span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-muted)' }}>{fmtRp(s.price)}</span>
                            </label>
                          ))}
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, display: 'block' }}>
                  Voucher bisa dipakai di checkout online booking.20fit.id/clinic dan di Kasir (Close Bill). Layanan yang tidak bisa
                  dibooking online hanya bisa memakai voucher lewat Kasir. Bila ada beberapa layanan, diskon hanya dihitung dari layanan yang dipilih di sini.
                </small>
              </div>

              {/* Simulasi */}
              {f.discount_value > 0 && previewServices.length > 0 && (
                <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>Simulasi (1 sesi)</div>
                  {previewServices.map(s => {
                    const d = calcDiscount(s.price, f)
                    return (
                      <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                        <span>{s.name}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                          {fmtRp(s.price)} − {fmtRp(d)} = <b>{fmtRp(s.price - d)}</b>
                        </span>
                      </div>
                    )
                  })}
                  {f.min_amount > 0 && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>Berlaku bila total layanan ≥ {fmtRp(f.min_amount)}.</div>}
                </div>
              )}

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginBottom: 8 }}>
                <input type="checkbox" checked={f.is_active} onChange={e => setF({ is_active: e.target.checked })} style={{ width: 'auto' }} />
                Aktif (bisa dipakai customer)
              </label>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={saving || generating}>{saving ? 'Menyimpan...' : 'Simpan Voucher'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal Pemakaian ── */}
      {usageVoucher && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 1000 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12 }}>
              <div>
                <h3 className="modal-title" style={{ margin: 0 }}>Pemakaian Voucher</h3>
                <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, marginTop: 4 }}>
                  {usageVoucher.code} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {discountLabel(usageVoucher)} · {scopeLabel(usageVoucher).full}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button className="btn-secondary" onClick={exportUsage} disabled={usageRows.length === 0}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '6px 12px' }}>
                  <Download size={14} /> Export CSV
                </button>
                <button onClick={() => setUsageVoucher(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
              </div>
            </div>

            <div className="kpi-grid" style={{ marginBottom: 16 }}>
              <div className="kpi-card"><div className="kpi-label">Kuota Terpakai</div><div className="kpi-value" style={{ fontSize: 24 }}>{usageVoucher.used_count} / {usageVoucher.quota ?? '∞'}</div></div>
              <div className="kpi-card"><div className="kpi-label">Customer</div><div className="kpi-value" style={{ fontSize: 24 }}>{usageSummary.customers}</div><div className="kpi-sub">{usageSummary.bookings} booking</div></div>
              <div className="kpi-card"><div className="kpi-label">Total Diskon</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmtRp(usageSummary.discount)}</div></div>
              <div className="kpi-card"><div className="kpi-label">Total Dibayar</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmtRp(usageSummary.paid)}</div><div className="kpi-sub">di luar menunggu bayar</div></div>
            </div>

            {usageError && <p style={{ color: 'var(--red)', fontSize: 13 }}>{usageError}</p>}
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tanggal Pakai</th><th>Kode Booking / Trx</th><th>Customer</th><th>Layanan</th><th>Jadwal</th>
                    <th>Harga Normal</th><th>Diskon</th><th>Dibayar</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {usageLoading ? (
                    <tr className="loading-row"><td colSpan={9}>Memuat data...</td></tr>
                  ) : usageRows.length === 0 ? (
                    <tr><td colSpan={9} className="empty-state">Belum ada yang memakai voucher ini</td></tr>
                  ) : usageRows.map(r => {
                    const bs = BOOKING_STATUS[r.status ?? ''] || { label: r.status ?? '-', css: '' }
                    return (
                      <tr key={r.id} style={{ opacity: r.status === 'cancelled' ? 0.55 : 1 }}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(r.created_at)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.booking_code}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{r.source === 'kasir' ? 'Kasir' : 'Online'}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.full_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{[r.phone, r.email].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td style={{ fontSize: 13 }}>{one(r.service)?.name ?? '-'}</td>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{scheduleOf(r)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(r.price_before_disc ?? r.price + (r.discount || 0))}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--green)' }}>− {fmtRp(r.discount || 0)}</td>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(r.price)}</td>
                        <td><span className={`badge ${bs.css}`}>{bs.label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 10 }}>
              Kuota terpakai dihitung per checkout online saat customer menekan bayar (1 checkout bisa berisi beberapa booking)
              dan per Close Bill di Kasir (Batal Bayar mengembalikan kuota). Booking online "Menunggu Bayar" yang tidak
              diselesaikan tetap memakai kuota — naikkan kuota lewat Edit bila perlu.
              {usageSummary.cancelled > 0 && ` ${usageSummary.cancelled} booking batal tidak dihitung ke total.`}
            </small>
          </div>
        </div>
      )}
    </div>
  )
}
