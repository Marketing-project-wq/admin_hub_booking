import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { X, Copy, Check, Download, Upload } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fmtRp, fmtDate, fmtDateTime, STATUS_LABEL, exportToCSV } from '../../lib/format'
import { isVoucherCodeTaken, generateUniqueVoucherCode } from '../../lib/voucherCode'
import VoucherCodeField from '../../components/VoucherCodeField'
import { downloadGymVoucherTemplate, prepareGymVoucherCodes, type ParsedCodeRow } from '../../lib/gymVoucherCsv'

// GYM — Voucher diskon untuk checkout Day Pass + Membership (booking.20fit.id).
//
// SUMBER DATA = arena_vouchers (tabel voucher terpadu, sama seperti Clinic/Recovery) dengan
// location = 'GYM'. Scope produk disimpan di applies_to:
//   'gym_all'        → berlaku Day Pass + Membership
//   'gym_membership' → hanya Membership
//   'gym_day_pass'   → hanya Day Pass
// Checkout gym memvalidasi + menebus lewat RPC verify_gym_voucher / redeem_gym_voucher
// (repo ARENA-BOOKING, migration 20261005120000_gym_vouchers.sql). redeem bersifat atomik
// (row-lock), membaca harga OTORITATIF dari katalog server, dan mencatat ke
// gym_voucher_redemptions (1 baris per order → anti dobel-pakai).
//
// Pemakaian per order dibaca dari gym_membership_orders.voucher_code /
// gym_day_pass_orders.voucher_code (+ discount_amount) — sumber daftar "siapa yang memakai".

type Scope = 'gym_all' | 'gym_membership' | 'gym_day_pass'

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
  applies_to: Scope
  applicable_plan_months: number[] | null   // batasan durasi paket membership (bulan); null/[] = semua
  created_by: string | null
  created_at: string
}

interface UsageAgg { orders: number; discount: number }

interface UsageRow {
  source: 'membership' | 'day_pass'
  id: string
  order_code: string
  full_name: string
  email: string | null
  phone: string | null
  item: string
  price: number                 // final dibayar (sudah dipotong voucher)
  discount_amount: number | null
  status: string | null
  payment_method: string | null
  created_at: string
}

interface FormState {
  code: string
  description: string
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  max_discount: number | null
  min_amount: number
  quota: number | null          // null = tanpa batas, 1 = sekali pakai (hangus)
  valid_from: string
  valid_until: string           // '' = tanpa batas waktu
  is_active: boolean
  scope: Scope
  planMonths: number[]          // durasi paket membership yang diizinkan; [] = semua durasi
}

type VStatus = 'active' | 'inactive' | 'expired' | 'scheduled' | 'exhausted'

const DEFAULT_PREFIX = 'GYM'
const FAR_FUTURE = '2099-12-31'   // arena_vouchers.valid_until NOT NULL → "tanpa batas"
const PLAN_MONTHS_OPTIONS = [1, 3, 6, 12] as const   // pilihan durasi paket membership (bulan)

const SCOPE_META: Record<Scope, { label: string; short: string }> = {
  gym_all:        { label: 'Semua (Membership + Day Pass)', short: 'Semua gym' },
  gym_membership: { label: 'Hanya Membership',              short: 'Membership' },
  gym_day_pass:   { label: 'Hanya Day Pass',                short: 'Day Pass' },
}

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
  valid_from: todayWIB(), valid_until: '', is_active: true, scope: 'gym_all', planMonths: [],
})

const formFromVoucher = (v: Voucher): FormState => ({
  code: v.code, description: v.description ?? '',
  discount_type: v.discount_type, discount_value: v.discount_value,
  max_discount: v.max_discount_amount, min_amount: v.min_booking_amount ?? 0, quota: v.quota,
  valid_from: v.valid_from ?? '', valid_until: v.valid_until && v.valid_until !== FAR_FUTURE ? v.valid_until : '',
  is_active: v.is_active,
  scope: (['gym_all', 'gym_membership', 'gym_day_pass'] as Scope[]).includes(v.applies_to) ? v.applies_to : 'gym_all',
  planMonths: Array.isArray(v.applicable_plan_months) ? [...v.applicable_plan_months].sort((a, b) => a - b) : [],
})

// Nilai kolom applicable_plan_months untuk payload: hanya untuk scope membership/gym_all; day pass → null.
const planMonthsPayload = (f: Pick<FormState, 'scope' | 'planMonths'>): number[] | null =>
  f.scope === 'gym_day_pass' || f.planMonths.length === 0 ? null : [...f.planMonths].sort((a, b) => a - b)

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

const discountLabel = (v: Pick<Voucher, 'discount_type' | 'discount_value'>) =>
  v.discount_type === 'percentage' ? `${v.discount_value}%` : fmtRp(v.discount_value)

// Hitungan diskon sama dengan verify_gym_voucher di DB (persen dibulatkan ke bawah,
// lalu dibatasi maks diskon dan harga).
const calcDiscount = (price: number, f: Pick<FormState, 'discount_type' | 'discount_value' | 'max_discount'>) => {
  let d = f.discount_type === 'percentage'
    ? Math.floor((price * (Number(f.discount_value) || 0)) / 100)
    : Number(f.discount_value) || 0
  if (f.discount_type === 'percentage' && f.max_discount) d = Math.min(d, f.max_discount)
  return Math.max(0, Math.min(d, price))
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

// Produk gym untuk simulasi diskon (nama + harga), difilter per scope voucher.
interface GymProduct { key: string; name: string; price: number; scope: 'gym_membership' | 'gym_day_pass' }

export default function GymVouchers() {
  const { user } = useAuth()
  const [data, setData] = useState<Voucher[]>([])
  const [products, setProducts] = useState<GymProduct[]>([])
  const [usage, setUsage] = useState<Record<string, UsageAgg>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | VStatus>('all')
  const [scopeFilter, setScopeFilter] = useState<'all' | Scope>('all')

  const [showModal, setShowModal] = useState(false)
  const [editing, setEditing] = useState<Voucher | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState(false)

  const [copied, setCopied] = useState<string | null>(null)

  const [usageVoucher, setUsageVoucher] = useState<Voucher | null>(null)
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState('')

  // ── Impor CSV (bulk-create) ─────────────────────────────────────────────────
  // Alur: upload (preview kode) → settings (setelan untuk semua kode) → result.
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importStage, setImportStage] = useState<'upload' | 'settings' | 'result'>('upload')
  const [importFileName, setImportFileName] = useState('')
  const [importParsing, setImportParsing] = useState(false)
  const [importHeaderError, setImportHeaderError] = useState('')
  const [importRows, setImportRows] = useState<ParsedCodeRow[]>([])
  const [importForm, setImportForm] = useState<FormState>(emptyForm())   // setelan untuk semua kode
  const [importFormError, setImportFormError] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ success: number; failed: number; failures: { rowNum: number; reason: string }[] } | null>(null)

  const today = todayWIB()

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [vRes, planRes, dpRes, mRes, dRes] = await Promise.all([
      supabase.from('arena_vouchers').select('*').eq('location', 'GYM').order('created_at', { ascending: false }),
      supabase.from('gym_membership_plans').select('id, name, price, is_active').eq('is_active', true).order('sort_order', { ascending: true }),
      supabase.from('gym_day_pass_config').select('price, is_active').eq('is_active', true).order('id').limit(1),
      supabase.from('gym_membership_orders').select('voucher_code, discount_amount, status').not('voucher_code', 'is', null),
      supabase.from('gym_day_pass_orders').select('voucher_code, discount_amount, status').not('voucher_code', 'is', null),
    ])
    if (vRes.error) { setError(vRes.error.message); setLoading(false); return }
    setData((vRes.data as Voucher[]) || [])

    // Produk untuk simulasi: plan membership + 1 harga day pass aktif.
    const prods: GymProduct[] = []
    for (const p of (planRes.data as { id: string; name: string; price: number }[] | null) || []) {
      prods.push({ key: `m-${p.id}`, name: p.name, price: p.price, scope: 'gym_membership' })
    }
    const dp = ((dpRes.data as { price: number }[] | null) || [])[0]
    if (dp) prods.push({ key: 'daypass', name: 'Day Pass', price: dp.price, scope: 'gym_day_pass' })
    setProducts(prods)

    // Agregat pemakaian per kode (order batal tidak dihitung ke total diskon).
    const agg: Record<string, UsageAgg> = {}
    const addAgg = (rows: { voucher_code: string | null; discount_amount: number | null; status: string | null }[]) => {
      for (const r of rows) {
        if (!r.voucher_code) continue
        const key = r.voucher_code.toUpperCase()
        agg[key] = agg[key] || { orders: 0, discount: 0 }
        if (r.status === 'cancelled') continue
        agg[key].orders += 1
        agg[key].discount += r.discount_amount || 0
      }
    }
    addAgg((mRes.data as never[]) || [])
    addAgg((dRes.data as never[]) || [])
    setUsage(agg)
    setError(''); setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // ── Form helpers ──────────────────────────────────────────────────────────
  const f = form
  const setF = (patch: Partial<FormState>) => setForm(p => ({ ...p, ...patch }))
  const setIF = (patch: Partial<FormState>) => setImportForm(p => ({ ...p, ...patch }))   // setelan impor

  // Checkbox batasan durasi paket (membership). Dipakai form "Buat Voucher" + step setelan impor.
  // Hanya relevan untuk scope membership/gym_all; day pass → tak ditampilkan (plan diabaikan).
  const togglePlanMonth = (cur: number[], m: number): number[] =>
    cur.includes(m) ? cur.filter(x => x !== m) : [...cur, m].sort((a, b) => a - b)
  const renderPlanMonthsField = (fm: FormState, apply: (p: Partial<FormState>) => void) =>
    fm.scope === 'gym_day_pass' ? null : (
      <div className="form-group">
        <label>Batasi Durasi Paket (membership)</label>
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
          {PLAN_MONTHS_OPTIONS.map(m => (
            <label key={m} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
              <input type="checkbox" checked={fm.planMonths.includes(m)}
                onChange={() => apply({ planMonths: togglePlanMonth(fm.planMonths, m) })} style={{ width: 'auto' }} />
              {m} bulan
            </label>
          ))}
        </div>
        <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>
          {fm.planMonths.length === 0
            ? 'Tak ada dicentang = berlaku untuk semua durasi paket.'
            : `Hanya untuk paket: ${[...fm.planMonths].sort((a, b) => a - b).join(' / ')} bulan.`}
        </small>
      </div>
    )
  const codeLocked = !!editing && editing.used_count > 0   // kode tercatat di order → jangan diubah

  const openAdd = () => {
    setForm(emptyForm()); setEditing(null); setFormError(''); setShowModal(true)
  }
  const openEdit = (v: Voucher) => {
    setForm(formFromVoucher(v)); setEditing(v); setFormError(''); setShowModal(true)
  }

  // Simulasi diskon untuk produk yang masuk scope.
  const previewProducts = useMemo(() => {
    const pool = products.filter(p => f.scope === 'gym_all' || p.scope === f.scope)
    return pool.slice(0, 4)
  }, [products, f.scope])

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
        applies_to: f.scope,
        location: 'GYM',
        applicable_slugs: null,
        applicable_clinic_service_ids: null,
        applicable_plan_months: planMonthsPayload(f),
        updated_at: new Date().toISOString(),
      }

      const res = editing
        ? await supabase.from('arena_vouchers').update(payload).eq('id', editing.id).eq('location', 'GYM')
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

  // ── Impor CSV handlers ──────────────────────────────────────────────────────
  const resetImport = () => {
    setImportStage('upload'); setImportFileName(''); setImportRows([]); setImportHeaderError('')
    setImportForm(emptyForm()); setImportFormError(''); setImportResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }
  const openImport = () => { resetImport(); setShowImport(true) }
  const closeImport = () => { setShowImport(false); resetImport() }

  // Langkah 1 — baca file → ambil kode existing (DB) sekali → validasi KODE tiap baris (preview).
  const onFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportFileName(file.name); setImportParsing(true); setImportHeaderError(''); setImportRows([]); setImportResult(null); setImportStage('upload')
    try {
      const text = await file.text()
      // Kode dianggap terpakai bila ada di arena_vouchers (semua lokasi, code UNIQUE global) atau
      // tabel voucher lama `vouchers` — cermin dari isVoucherCodeTaken, diambil sekali untuk preview.
      const [avRes, legacyRes] = await Promise.all([
        supabase.from('arena_vouchers').select('code'),
        supabase.from('vouchers').select('code'),
      ])
      const existing = new Set<string>()
      for (const r of (avRes.data as { code: string | null }[] | null) || []) if (r.code) existing.add(r.code.toUpperCase())
      for (const r of (legacyRes.data as { code: string | null }[] | null) || []) if (r.code) existing.add(r.code.toUpperCase())
      const { headerError, rows } = prepareGymVoucherCodes(text, existing)
      if (headerError) setImportHeaderError(headerError)
      setImportRows(rows)
    } catch (err) {
      setImportHeaderError(err instanceof Error ? err.message : 'Gagal membaca file')
    } finally {
      setImportParsing(false)
    }
  }

  const validImportRows = useMemo(() => importRows.filter(r => r.valid), [importRows])

  // Validasi setelan — IDENTIK dengan handleSave (tanpa cek kode: kode sudah divalidasi di CSV).
  const validateImportSettings = (f: FormState): string | null => {
    if (!f.discount_value || f.discount_value <= 0) return 'Nilai diskon harus > 0'
    if (f.discount_type === 'percentage' && f.discount_value > 100) return 'Diskon persen maksimal 100%'
    if (f.quota != null && f.quota < 1) return 'Kuota minimal 1 (kosongkan untuk tanpa batas)'
    if (!f.valid_from) return 'Tanggal mulai berlaku wajib diisi'
    if (f.valid_until && f.valid_until < f.valid_from) return 'Tanggal berakhir harus setelah tanggal mulai'
    return null
  }

  // Langkah 2 → 3 — terapkan setelan ke semua kode valid, insert per-baris. Payload & cara simpan
  // IDENTIK handleSave (arena_vouchers, location='GYM'); 1 error (mis. 23505) tak gagalkan batch.
  const doImport = async () => {
    const f = importForm
    const err = validateImportSettings(f)
    if (err) { setImportFormError(err); return }
    if (validImportRows.length === 0) return
    setImportFormError(''); setImporting(true)
    const generated = new Set<string>()
    let success = 0
    const failures: { rowNum: number; reason: string }[] = []
    for (const row of validImportRows) {
      try {
        // Kode wajib (sudah divalidasi); fallback generate hanya untuk jaga-jaga bila kosong.
        let code = row.code
        if (!code) {
          for (let a = 0; a < 8; a++) { const c = await generateUniqueVoucherCode(DEFAULT_PREFIX); if (!generated.has(c)) { generated.add(c); code = c; break } }
        }
        const payload = {
          code,
          description: row.description,
          discount_type: f.discount_type,
          discount_value: Number(f.discount_value),
          min_booking_amount: Number(f.min_amount) || 0,
          max_discount_amount: f.discount_type === 'percentage' ? (f.max_discount || null) : null,
          quota: f.quota != null ? Number(f.quota) : null,
          valid_from: f.valid_from,
          valid_until: f.valid_until || FAR_FUTURE,
          is_active: f.is_active,
          corporation_only: false,
          applies_to: f.scope,
          location: 'GYM',
          applicable_slugs: null,
          applicable_clinic_service_ids: null,
          applicable_plan_months: planMonthsPayload(f),
          used_count: 0,
          created_by: user?.email || user?.full_name || 'admin',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
        const res = await supabase.from('arena_vouchers').insert(payload)
        if (res.error) throw new Error(res.error.code === '23505' ? 'Kode voucher sudah dipakai' : res.error.message)
        success++
      } catch (e) {
        failures.push({ rowNum: row.rowNum, reason: e instanceof Error ? e.message : 'Gagal menyimpan' })
      }
    }
    const skipped = importRows.length - validImportRows.length
    setImportResult({ success, failed: skipped + failures.length, failures })
    setImportStage('result'); setImporting(false)
    fetchData()
  }

  const toggleActive = async (v: Voucher) => {
    const { error: err } = await supabase.from('arena_vouchers')
      .update({ is_active: !v.is_active, updated_at: new Date().toISOString() })
      .eq('id', v.id).eq('location', 'GYM')
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
    const [mRes, dRes] = await Promise.all([
      supabase.from('gym_membership_orders')
        .select('id, order_code, plan_name, duration_months, full_name, email, phone, price, discount_amount, status, payment_method, created_at')
        .eq('voucher_code', v.code),
      supabase.from('gym_day_pass_orders')
        .select('id, order_code, product_name, full_name, email, phone, price, discount_amount, status, payment_method, created_at')
        .eq('voucher_code', v.code),
    ])
    const err = mRes.error || dRes.error
    if (err) setUsageError(err.message)
    type MRow = { id: string; order_code: string; plan_name: string | null; duration_months: number | null; full_name: string | null; email: string | null; phone: string | null; price: number; discount_amount: number | null; status: string | null; payment_method: string | null; created_at: string }
    type DRow = { id: string; order_code: string; product_name: string | null; full_name: string | null; email: string | null; phone: string | null; price: number; discount_amount: number | null; status: string | null; payment_method: string | null; created_at: string }
    const membership: UsageRow[] = ((mRes.data || []) as unknown as MRow[]).map(r => ({
      source: 'membership', id: r.id, order_code: r.order_code,
      full_name: r.full_name ?? '-', email: r.email, phone: r.phone,
      item: `${r.plan_name ?? 'Membership'}${r.duration_months ? ` (${r.duration_months} bln)` : ''}`,
      price: r.price, discount_amount: r.discount_amount, status: r.status,
      payment_method: r.payment_method, created_at: r.created_at,
    }))
    const dayPass: UsageRow[] = ((dRes.data || []) as unknown as DRow[]).map(r => ({
      source: 'day_pass', id: r.id, order_code: r.order_code,
      full_name: r.full_name ?? '-', email: r.email, phone: r.phone,
      item: r.product_name ?? 'Day Pass',
      price: r.price, discount_amount: r.discount_amount, status: r.status,
      payment_method: r.payment_method, created_at: r.created_at,
    }))
    setUsageRows([...membership, ...dayPass].sort((a, b) => b.created_at.localeCompare(a.created_at)))
    setUsageLoading(false)
  }

  const usageSummary = useMemo(() => {
    const active = usageRows.filter(r => r.status !== 'cancelled')
    const customers = new Set(active.map(r => (r.email || r.phone || r.full_name || '').toLowerCase()))
    return {
      orders: active.length,
      cancelled: usageRows.length - active.length,
      customers: customers.size,
      discount: active.reduce((s, r) => s + (r.discount_amount || 0), 0),
      paid: active.filter(r => r.status !== 'pending_payment').reduce((s, r) => s + (r.price || 0), 0),
    }
  }, [usageRows])

  const exportUsage = () => {
    if (!usageVoucher) return
    exportToCSV(usageRows.map(r => ({
      'Tanggal': fmtDateTime(r.created_at),
      'Jenis': r.source === 'membership' ? 'Membership' : 'Day Pass',
      'Kode Order': r.order_code,
      'Nama': r.full_name,
      'Email': r.email ?? '',
      'No HP': r.phone ?? '',
      'Produk': r.item,
      'Harga Normal': r.price + (r.discount_amount || 0),
      'Diskon': r.discount_amount || 0,
      'Dibayar': r.price,
      'Status': (STATUS_LABEL[r.status ?? ''] || { label: r.status ?? '' }).label,
    })), `voucher_gym_${usageVoucher.code}`)
  }

  // ── List ──────────────────────────────────────────────────────────────────
  const displayData = useMemo(() => {
    const q = search.trim().toLowerCase()
    return data.filter(v => {
      if (q && !v.code.toLowerCase().includes(q) && !(v.description ?? '').toLowerCase().includes(q)) return false
      if (statusFilter !== 'all' && statusOf(v, today) !== statusFilter) return false
      if (scopeFilter !== 'all' && v.applies_to !== scopeFilter) return false
      return true
    })
  }, [data, search, statusFilter, scopeFilter, today])

  const kpi = useMemo(() => ({
    total: data.length,
    active: data.filter(v => statusOf(v, today) === 'active').length,
    used: data.reduce((s, v) => s + (v.used_count || 0), 0),
    discount: data.reduce((s, v) => s + (usage[v.code.toUpperCase()]?.discount || 0), 0),
  }), [data, usage, today])

  const hasFilter = !!search || statusFilter !== 'all' || scopeFilter !== 'all'

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Voucher Gym</h2>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn-secondary" onClick={openImport}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Upload size={15} /> Impor CSV
          </button>
          <button className="btn-primary" onClick={openAdd}>+ Buat Voucher</button>
        </div>
        <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onFileSelected} />
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Kode diskon untuk checkout <b>Day Pass</b> dan <b>Membership</b> gym. Diskon persen atau nominal,
        bisa dibatasi ke Membership / Day Pass saja, dengan masa berlaku dan kuota pemakaian
        (kuota <b>1</b> = sekali pakai / hangus, <b>N</b> = kuota, kosong = tanpa batas).
      </p>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="kpi-grid">
        <div className="kpi-card"><div className="kpi-label">Total Voucher</div><div className="kpi-value">{kpi.total}</div></div>
        <div className="kpi-card"><div className="kpi-label">Aktif & Bisa Dipakai</div><div className="kpi-value">{kpi.active}</div></div>
        <div className="kpi-card"><div className="kpi-label">Total Pemakaian</div><div className="kpi-value">{kpi.used}</div><div className="kpi-sub">checkout</div></div>
        <div className="kpi-card"><div className="kpi-label">Total Diskon Diberikan</div><div className="kpi-value" style={{ fontSize: 24 }}>{fmtRp(kpi.discount)}</div><div className="kpi-sub">order tidak batal</div></div>
      </div>

      <div className="filter-bar">
        <input type="text" placeholder="Cari kode / deskripsi..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ minWidth: 220 }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | VStatus)}>
          <option value="all">Semua Status</option>
          {(Object.keys(STATUS_META) as VStatus[]).map(s => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
        <select value={scopeFilter} onChange={e => setScopeFilter(e.target.value as 'all' | Scope)}>
          <option value="all">Semua Scope</option>
          {(Object.keys(SCOPE_META) as Scope[]).map(s => <option key={s} value={s}>{SCOPE_META[s].short}</option>)}
        </select>
        {hasFilter && (
          <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setStatusFilter('all'); setScopeFilter('all') }}>Reset</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kode</th><th>Deskripsi</th><th>Diskon</th><th>Scope</th><th>Min. Belanja</th>
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
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {(SCOPE_META[v.applies_to] ?? SCOPE_META.gym_all).short}
                    {v.applies_to !== 'gym_day_pass' && v.applicable_plan_months && v.applicable_plan_months.length > 0 && (
                      <span style={{ display: 'block', fontSize: 11 }}>· {[...v.applicable_plan_months].sort((a, b) => a - b).join('/')} bln</span>
                    )}
                  </td>
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
                storageKey="gym"
                defaultPrefix={DEFAULT_PREFIX}
                disabled={codeLocked}
                disabledHint={`Kode tidak bisa diubah karena sudah dipakai ${editing?.used_count ?? 0}x.`}
                onError={setFormError}
                onGeneratingChange={setGenerating}
              />

              <div className="form-group">
                <label>Deskripsi (internal)</label>
                <input type="text" value={f.description} onChange={e => setF({ description: e.target.value })}
                  placeholder="mis. Promo Oktober — diskon membership" />
              </div>

              {/* Scope produk */}
              <div className="form-group">
                <label>Berlaku Untuk *</label>
                <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
                  {(Object.keys(SCOPE_META) as Scope[]).map(s => (
                    <label key={s} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                      <input type="radio" name="scope" value={s} checked={f.scope === s} onChange={() => setF({ scope: s })} style={{ width: 'auto' }} />
                      {SCOPE_META[s].label}
                    </label>
                  ))}
                </div>
              </div>

              {/* Batasan durasi paket membership (hanya saat scope membership / semua). */}
              {renderPlanMonthsField(f, setF)}

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
                  <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Dihitung dari harga Day Pass / Membership.</small>
                </div>
                <div className="form-group">
                  <label>Kuota Pemakaian</label>
                  <input type="number" min={1} value={f.quota ?? ''} placeholder="tanpa batas"
                    onChange={e => setF({ quota: e.target.value === '' ? null : Number(e.target.value) })} />
                  <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>1 = sekali pakai (hangus), N = kuota, kosong = tanpa batas.</small>
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

              {/* Simulasi */}
              {f.discount_value > 0 && previewProducts.length > 0 && (
                <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12 }}>
                  <div style={{ ...labelStyle, marginBottom: 4 }}>Simulasi</div>
                  {previewProducts.map(p => {
                    const d = calcDiscount(p.price, f)
                    return (
                      <div key={p.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '2px 0' }}>
                        <span>{p.name}</span>
                        <span style={{ fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                          {fmtRp(p.price)} − {fmtRp(d)} = <b>{fmtRp(p.price - d)}</b>
                        </span>
                      </div>
                    )
                  })}
                  {f.min_amount > 0 && <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>Berlaku bila harga ≥ {fmtRp(f.min_amount)}.</div>}
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
                  {usageVoucher.code} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>· {discountLabel(usageVoucher)} · {(SCOPE_META[usageVoucher.applies_to] ?? SCOPE_META.gym_all).label}</span>
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
              <div className="kpi-card"><div className="kpi-label">Customer</div><div className="kpi-value" style={{ fontSize: 24 }}>{usageSummary.customers}</div><div className="kpi-sub">{usageSummary.orders} order</div></div>
              <div className="kpi-card"><div className="kpi-label">Total Diskon</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmtRp(usageSummary.discount)}</div></div>
              <div className="kpi-card"><div className="kpi-label">Total Dibayar</div><div className="kpi-value" style={{ fontSize: 20 }}>{fmtRp(usageSummary.paid)}</div><div className="kpi-sub">di luar menunggu bayar</div></div>
            </div>

            {usageError && <p style={{ color: 'var(--red)', fontSize: 13 }}>{usageError}</p>}
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Tanggal</th><th>Kode Order</th><th>Customer</th><th>Produk</th>
                    <th>Harga Normal</th><th>Diskon</th><th>Dibayar</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {usageLoading ? (
                    <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
                  ) : usageRows.length === 0 ? (
                    <tr><td colSpan={8} className="empty-state">Belum ada yang memakai voucher ini</td></tr>
                  ) : usageRows.map(r => {
                    const bs = STATUS_LABEL[r.status ?? ''] || { label: r.status ?? '-', css: '' }
                    return (
                      <tr key={r.id} style={{ opacity: r.status === 'cancelled' ? 0.55 : 1 }}>
                        <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(r.created_at)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.order_code}</div>
                          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{r.source === 'membership' ? 'Membership' : 'Day Pass'}</div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{r.full_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{[r.phone, r.email].filter(Boolean).join(' · ')}</div>
                        </td>
                        <td style={{ fontSize: 13 }}>{r.item}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(r.price + (r.discount_amount || 0))}</td>
                        <td style={{ whiteSpace: 'nowrap', color: 'var(--green)' }}>− {fmtRp(r.discount_amount || 0)}</td>
                        <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(r.price)}</td>
                        <td><span className={`badge ${bs.css}`}>{bs.label}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginTop: 10 }}>
              Kuota terpakai dihitung saat voucher ditebus di checkout (via redeem_gym_voucher). Order yang
              dibatalkan TIDAK mengembalikan kuota otomatis — naikkan kuota lewat Edit bila perlu.
              {usageSummary.cancelled > 0 && ` ${usageSummary.cancelled} order batal tidak dihitung ke total.`}
            </small>
          </div>
        </div>
      )}

      {/* ── Modal Impor CSV (Upload → Setelan → Selesai) ── */}
      {showImport && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 760 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <h3 className="modal-title" style={{ margin: 0 }}>Impor Voucher dari CSV</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 6, marginBottom: 0, maxWidth: 620 }}>
                  {importStage === 'settings'
                    ? <>Pilih setelan diskon, produk, masa berlaku & kuota — berlaku untuk <b>semua {validImportRows.length} kode</b> yang diimpor. Validasi & payload identik form "Buat Voucher".</>
                    : <>Upload CSV berisi <b>kode</b> (+ deskripsi opsional), 1 kode per baris. Pemisah <code>,</code> atau <code>;</code> terdeteksi otomatis; baris diawali <code>#</code> & baris kosong diabaikan.</>}
                </p>
              </div>
              <button onClick={closeImport} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            {/* Stepper */}
            <div style={{ display: 'flex', gap: 10, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 14 }}>
              {(['upload', 'settings', 'result'] as const).map((st, i) => {
                const label = { upload: '1 · Kode', settings: '2 · Setelan', result: '3 · Selesai' }[st]
                const active = importStage === st
                return <span key={st} style={{ fontWeight: active ? 700 : 500, color: active ? 'var(--red)' : 'var(--text-muted)' }}>{label}{i < 2 ? '  →' : ''}</span>
              })}
            </div>

            {/* STAGE 1 — Upload + preview kode */}
            {importStage === 'upload' && (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
                  <button className="btn-secondary" onClick={() => fileInputRef.current?.click()}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <Upload size={14} /> Pilih file CSV
                  </button>
                  <button className="btn-secondary" onClick={downloadGymVoucherTemplate}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                    <Download size={14} /> Download Template
                  </button>
                  {importFileName && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{importFileName}</span>}
                </div>

                {importParsing && <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Memproses file…</p>}
                {importHeaderError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{importHeaderError}</p>}

                {importRows.length > 0 && (
                  <>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                      {importRows.length} kode · <b style={{ color: 'var(--green)' }}>{validImportRows.length} valid</b>
                      {importRows.length - validImportRows.length > 0 && <> · <b style={{ color: 'var(--red)' }}>{importRows.length - validImportRows.length} error (dilewati)</b></>}
                    </div>
                    <div className="table-wrap" style={{ maxHeight: 340, overflow: 'auto' }}>
                      <table className="data-table">
                        <thead><tr><th>#</th><th>Kode</th><th>Deskripsi</th><th>Status</th></tr></thead>
                        <tbody>
                          {importRows.map(r => (
                            <tr key={r.rowNum} style={{ opacity: r.valid ? 1 : 0.85 }}>
                              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{r.rowNum}</td>
                              <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{r.code || '-'}</td>
                              <td style={{ fontSize: 13 }}>{r.description || '-'}</td>
                              <td style={{ fontSize: 12 }}>
                                {r.valid
                                  ? <span className="badge badge-confirmed">OK</span>
                                  : <span style={{ color: 'var(--red)' }}>{r.errors.join('; ')}</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}

            {/* STAGE 2 — Setelan (berlaku untuk semua kode). Field & validasi mirror "Buat Voucher". */}
            {importStage === 'settings' && (
              <>
                {importFormError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{importFormError}</p>}

                <div className="form-group">
                  <label>Berlaku Untuk (produk) *</label>
                  <div style={{ display: 'flex', gap: 16, marginTop: 4, flexWrap: 'wrap' }}>
                    {(Object.keys(SCOPE_META) as Scope[]).map(s => (
                      <label key={s} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                        <input type="radio" name="imp-scope" value={s} checked={importForm.scope === s} onChange={() => setIF({ scope: s })} style={{ width: 'auto' }} />
                        {SCOPE_META[s].label}
                      </label>
                    ))}
                  </div>
                </div>

                {/* Batasan durasi paket membership — berlaku untuk semua kode batch. */}
                {renderPlanMonthsField(importForm, setIF)}

                <div className="form-group">
                  <label>Tipe Diskon *</label>
                  <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                    {([['percentage', 'Persentase (%)'], ['fixed', 'Nominal (Rp)']] as const).map(([t, lbl]) => (
                      <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                        <input type="radio" name="imp-dtype" value={t} checked={importForm.discount_type === t} onChange={() => setIF({ discount_type: t })} style={{ width: 'auto' }} />
                        {lbl}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Nilai Diskon * {importForm.discount_type === 'percentage' ? '(%)' : '(Rp)'}</label>
                    <input type="number" min={0} max={importForm.discount_type === 'percentage' ? 100 : undefined}
                      value={importForm.discount_value || ''} onChange={e => setIF({ discount_value: Number(e.target.value) })} />
                  </div>
                  {importForm.discount_type === 'percentage' ? (
                    <div className="form-group">
                      <label>Maks Diskon (Rp)</label>
                      <input type="number" min={0} value={importForm.max_discount || ''}
                        onChange={e => setIF({ max_discount: Number(e.target.value) || null })} placeholder="opsional" />
                    </div>
                  ) : <div />}
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Min. Belanja (Rp)</label>
                    <input type="number" min={0} value={importForm.min_amount || ''} placeholder="0"
                      onChange={e => setIF({ min_amount: Number(e.target.value) || 0 })} />
                  </div>
                  <div className="form-group">
                    <label>Kuota Pemakaian</label>
                    <input type="number" min={1} value={importForm.quota ?? ''} placeholder="tanpa batas"
                      onChange={e => setIF({ quota: e.target.value === '' ? null : Number(e.target.value) })} />
                    <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>1 = sekali pakai, N = kuota, kosong = tanpa batas. Berlaku per-kode.</small>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Berlaku Dari *</label>
                    <input type="date" value={importForm.valid_from} onChange={e => setIF({ valid_from: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Berlaku Sampai</label>
                    <input type="date" value={importForm.valid_until} min={importForm.valid_from || undefined} onChange={e => setIF({ valid_until: e.target.value })} placeholder="tanpa batas" />
                  </div>
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginTop: 4 }}>
                  <input type="checkbox" checked={importForm.is_active} onChange={e => setIF({ is_active: e.target.checked })} style={{ width: 'auto' }} />
                  Aktif (bisa dipakai customer)
                </label>
              </>
            )}

            {/* STAGE 3 — Hasil */}
            {importStage === 'result' && importResult && (
              <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '12px 14px', fontSize: 13 }}>
                <b style={{ color: 'var(--green)' }}>{importResult.success} berhasil</b>
                {importResult.failed > 0 && <span> · <b style={{ color: 'var(--red)' }}>{importResult.failed} gagal/dilewati</b></span>}
                {importResult.failures.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 18, color: 'var(--red)' }}>
                    {importResult.failures.map(fl => <li key={fl.rowNum}>Baris {fl.rowNum}: {fl.reason}</li>)}
                  </ul>
                )}
                <div style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 12 }}>Daftar voucher sudah diperbarui.</div>
              </div>
            )}

            {/* Footer per-stage */}
            <div className="modal-footer">
              {importStage === 'upload' && (
                <>
                  <button type="button" className="btn-secondary" onClick={closeImport}>Batal</button>
                  <button type="button" className="btn-primary" disabled={validImportRows.length === 0}
                    onClick={() => { setImportForm(emptyForm()); setImportFormError(''); setImportStage('settings') }}>
                    Lanjut: Setelan ({validImportRows.length} kode)
                  </button>
                </>
              )}
              {importStage === 'settings' && (
                <>
                  <button type="button" className="btn-secondary" onClick={() => { setImportFormError(''); setImportStage('upload') }}>← Kembali</button>
                  <button type="button" className="btn-primary" disabled={importing || validImportRows.length === 0} onClick={doImport}>
                    {importing ? 'Mengimpor…' : `Impor ${validImportRows.length} kode`}
                  </button>
                </>
              )}
              {importStage === 'result' && (
                <button type="button" className="btn-secondary" onClick={closeImport}>Tutup</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
