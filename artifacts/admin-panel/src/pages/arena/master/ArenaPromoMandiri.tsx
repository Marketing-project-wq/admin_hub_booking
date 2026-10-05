import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmtRp, fmtDateTime } from '../../../lib/format'
import { useAuth } from '../../../context/AuthContext'

// Promo Mandiri = public.payment_promos row id 'mandiri'. booking.20fit.id applies it SERVER-SIDE
// (create-booking-charge → supabase/functions/_shared/payment_promo.ts); this page only edits the
// config and shows usage:
//   • discount = round(base × pct%), base = product amount EXCLUDING add-ons (after vouchers),
//     capped by cap_amount and by the remaining budget; base must reach min_amount; only inside
//     start_at..end_at; only for the selected flows (booking-code prefix) and methods
//     ('va' = Mandiri VA, 'card' = card whose BIN starts with a bin_list entry or whose issuer
//     name contains MANDIRI).
//   • limits — "identity" = card BIN+last4, or the customer's phone/email for VA — count PAID
//     redemptions + PENDING ones still inside the 35-min charge window.
// adminhub has no Supabase Auth session, so writes + usage go through SECURITY DEFINER RPCs that
// check the logged-in admin (admin_users id + email): admin_save_payment_promo (p_patch = only the
// changed fields; '' clears a nullable number/date) and admin_list_promo_redemptions.
// The table itself is public-read; payment_promo_redemptions is server-only.

const PROMO_ID = 'mandiri'
const USAGE_FETCH_LIMIT = 1000          // RPC maximum — the summary is computed from these rows
const USAGE_TABLE_ROWS = 200
const PENDING_TTL_MS = 35 * 60 * 1000   // = PENDING_TTL_MS in payment_promo.ts (30-min charge + grace)
const WIB_OFFSET_MS = 7 * 3600 * 1000
const INT_MAX = 2147483647              // Postgres integer
const EXAMPLE_BASE = 300000

interface Promo {
  id: string; name: string; enabled: boolean; bank: string; pct: number | string
  cap_amount: number | null; min_amount: number | null
  methods: string[] | null; flows: string[] | null
  per_identity_daily_limit: number; per_identity_total_limit: number | null
  total_quota: number | null; budget_amount: number | null
  bin_list: string[] | null; start_at: string | null; end_at: string | null
  updated_at: string | null; updated_by: string | null
}

interface Redemption {
  booking_code: string; method: string; identity_label: string | null
  discount_amount: number; status: string; created_at: string; paid_at: string | null
}

const METHODS: { key: string; label: string }[] = [
  { key: 'va', label: 'Virtual Account Mandiri' },
  { key: 'card', label: 'Kartu Mandiri (Visa/Mastercard)' },
]
const FLOWS: { key: string; label: string }[] = [
  { key: 'CL-', label: 'Class' },
  { key: 'BK-', label: 'Open Arena · Rent Arena · Bundles · Coaching' },
  { key: 'CLC-', label: 'Recovery Center' },
  { key: 'PKG-', label: 'Packages (paket kelas, /packages)' },
]
const METHOD_LABEL: Record<string, string> = { va: 'VA Mandiri', card: 'Kartu' }

// Form state: inputs as strings ('' = blank), datetimes as datetime-local values in WIB.
interface Form {
  enabled: boolean
  pct: string
  cap_amount: string
  min_amount: string
  methods: string[]
  flows: string[]
  per_identity_daily_limit: string
  per_identity_total_limit: string
  total_quota: string
  budget_amount: string
  start_at: string
  end_at: string
  bin_list: string
}

type IntKey = 'cap_amount' | 'min_amount' | 'per_identity_daily_limit' | 'per_identity_total_limit' | 'total_quota' | 'budget_amount'
const INT_FIELDS: { key: IntKey; label: string; required?: boolean }[] = [
  { key: 'cap_amount', label: 'Maks. diskon per pembayaran' },
  { key: 'min_amount', label: 'Minimal nilai produk' },
  { key: 'per_identity_daily_limit', label: 'Limit per kartu / customer per hari', required: true },
  { key: 'per_identity_total_limit', label: 'Limit per kartu / customer total' },
  { key: 'total_quota', label: 'Kuota total' },
  { key: 'budget_amount', label: 'Budget total' },
]

const numStr = (n: number | string | null | undefined): string =>
  n === null || n === undefined || n === '' ? '' : String(Number(n))
const normNum = (s: string): string => (s.trim() === '' ? '' : String(Number(s.trim())))
const isInt = (s: string): boolean => /^\d+$/.test(s.trim()) && Number(s) <= INT_MAX

// timestamptz → 'YYYY-MM-DDTHH:mm' in WIB (value for <input type="datetime-local">)
const toWibInput = (iso: string | null): string => {
  if (!iso) return ''
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? '' : new Date(ms + WIB_OFFSET_MS).toISOString().slice(0, 16)
}
// datetime-local value (WIB) → ISO with +07:00; '' clears the column
const fromWibInput = (v: string): string => (!v ? '' : `${v.length === 16 ? `${v}:00` : v}+07:00`)

const parseBins = (s: string): string[] => {
  const out: string[] = []
  for (const x of s.split(/[\s,;]+/)) { const t = x.trim(); if (t && !out.includes(t)) out.push(t) }
  return out
}
const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every(x => b.includes(x))
// Toggle a checkbox value, keeping the canonical order (and any value this page doesn't know).
const toggled = (all: { key: string }[], current: string[], key: string): string[] => {
  const next = current.includes(key) ? current.filter(k => k !== key) : [...current, key]
  const known = all.map(o => o.key)
  return [...known.filter(k => next.includes(k)), ...next.filter(k => !known.includes(k))]
}

const formFromPromo = (p: Promo): Form => ({
  enabled: !!p.enabled,
  pct: numStr(p.pct),
  cap_amount: numStr(p.cap_amount),
  min_amount: numStr(p.min_amount),
  methods: p.methods ?? [],
  flows: p.flows ?? [],
  per_identity_daily_limit: numStr(p.per_identity_daily_limit),
  per_identity_total_limit: numStr(p.per_identity_total_limit),
  total_quota: numStr(p.total_quota),
  budget_amount: numStr(p.budget_amount),
  start_at: toWibInput(p.start_at),
  end_at: toWibInput(p.end_at),
  bin_list: (p.bin_list ?? []).join(', '),
})

// Only the fields that differ from the saved row (RPC: '' clears a nullable number/date).
const buildPatch = (saved: Form, f: Form): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  if (f.enabled !== saved.enabled) patch.enabled = f.enabled
  if (normNum(f.pct) !== normNum(saved.pct)) patch.pct = Number(f.pct)
  for (const { key, required } of INT_FIELDS) {
    if (normNum(f[key]) !== normNum(saved[key])) patch[key] = f[key].trim() === '' && !required ? '' : Number(f[key])
  }
  if (!sameSet(f.methods, saved.methods)) patch.methods = f.methods
  if (!sameSet(f.flows, saved.flows)) patch.flows = f.flows
  if (f.start_at !== saved.start_at) patch.start_at = fromWibInput(f.start_at)
  if (f.end_at !== saved.end_at) patch.end_at = fromWibInput(f.end_at)
  const bins = parseBins(f.bin_list)
  if (bins.join(',') !== parseBins(saved.bin_list).join(',')) patch.bin_list = bins
  return patch
}

const validate = (f: Form): string | null => {
  const pct = f.pct.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(pct) || Number(pct) > 50) return 'Diskon (%) harus angka 0–50 (maks. 2 desimal).'
  for (const { key, label, required } of INT_FIELDS) {
    if (f[key].trim() === '') {
      if (required) return `${label} wajib diisi (0 = tanpa batas).`
      continue
    }
    if (!isInt(f[key])) return `${label} harus bilangan bulat ≥ 0.`
  }
  if (f.methods.length === 0) return 'Pilih minimal satu metode pembayaran. Untuk mematikan promo, pakai switch ON/OFF.'
  if (f.flows.length === 0) return 'Pilih minimal satu flow booking. Untuk mematikan promo, pakai switch ON/OFF.'
  if (f.start_at && f.end_at && Date.parse(fromWibInput(f.end_at)) <= Date.parse(fromWibInput(f.start_at))) {
    return 'Waktu selesai harus setelah waktu mulai.'
  }
  const bad = parseBins(f.bin_list).filter(b => !/^\d{4,8}$/.test(b))
  if (bad.length) return `BIN tidak valid: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? ', …' : ''} (BIN = 4–8 digit angka).`
  return null
}

const rpcError = (m: string): string => {
  if (m.includes('not_authorized')) {
    return 'Tidak diizinkan: hanya admin aktif unit Arena atau super admin yang bisa mengakses promo ini. Coba logout lalu login ulang.'
  }
  if (m.includes('promo_not_found')) return `Promo "${PROMO_ID}" tidak ditemukan di database.`
  if (m.includes('check constraint')) return `Nilai ditolak database: ${m}`
  return m
}

const promoState = (p: Promo, now: number): { label: string; css: string } => {
  if (!p.enabled) return { label: 'Nonaktif', css: 'badge-cancelled' }
  if (p.start_at && now < Date.parse(p.start_at)) return { label: 'Terjadwal', css: 'badge-info' }
  if (p.end_at && now > Date.parse(p.end_at)) return { label: 'Berakhir', css: 'badge-warning' }
  return { label: 'Aktif', css: 'badge-confirmed' }
}

const methodsText = (m: string[]): string => {
  const va = m.includes('va'), card = m.includes('card')
  if (va && card) return 'VA Bank Mandiri dan kartu Mandiri'
  if (va) return 'VA Bank Mandiri'
  if (card) return 'kartu Mandiri'
  return 'Bank Mandiri'
}
const fmtPct = (n: number | string): string => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 2 })

const isLivePending = (r: Redemption, now: number): boolean =>
  r.status === 'pending' && now - Date.parse(r.created_at) <= PENDING_TTL_MS
const redemptionBadge = (r: Redemption, now: number): { label: string; css: string } => {
  if (r.status === 'paid') return { label: 'Paid', css: 'badge-confirmed' }
  if (r.status === 'pending') return isLivePending(r, now) ? { label: 'Pending', css: 'badge-pending' } : { label: 'Expired', css: '' }
  if (r.status === 'released') return { label: 'Released', css: 'badge-cancelled' }
  return { label: r.status, css: '' }
}

const neutralBadge: React.CSSProperties = { background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)' }
const cardHeader: React.CSSProperties = { padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--border)' }
const cardTitle: React.CSSProperties = { fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 17, textTransform: 'uppercase', letterSpacing: '0.03em', color: 'var(--text-primary)' }
const sectionStyle: React.CSSProperties = { borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }
const sectionTitle: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 12 }
const hint: React.CSSProperties = { fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }
const checkLabel: React.CSSProperties = {
  display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', padding: '3px 0', margin: 0,
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 500, textTransform: 'none', letterSpacing: 'normal', color: 'var(--text-primary)',
}
const tile: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }

export default function ArenaPromoMandiri() {
  const { user } = useAuth()
  const [promo, setPromo] = useState<Promo | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [rows, setRows] = useState<Redemption[]>([])
  const [usageLoading, setUsageLoading] = useState(true)
  const [usageError, setUsageError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const fetchPromo = useCallback(async () => {
    setLoading(true); setLoadError('')
    const { data, error } = await supabase.from('payment_promos').select('*').eq('id', PROMO_ID).maybeSingle()
    if (error) setLoadError(error.message)
    else if (!data) setLoadError(`Promo "${PROMO_ID}" belum ada di tabel payment_promos.`)
    else { setPromo(data as Promo); setForm(formFromPromo(data as Promo)) }
    setLoading(false)
  }, [])

  const fetchUsage = useCallback(async () => {
    if (!user) return
    setUsageLoading(true); setUsageError('')
    const { data, error } = await supabase.rpc('admin_list_promo_redemptions', {
      p_admin_id: user.id, p_admin_email: user.email, p_promo_id: PROMO_ID, p_limit: USAGE_FETCH_LIMIT,
    })
    if (error) setUsageError(rpcError(error.message))
    else setRows((data as Redemption[] | null) ?? [])
    setNow(Date.now())
    setUsageLoading(false)
  }, [user])

  useEffect(() => { fetchPromo() }, [fetchPromo])
  useEffect(() => { fetchUsage() }, [fetchUsage])

  const saved = useMemo(() => (promo ? formFromPromo(promo) : null), [promo])
  const patch = useMemo(() => (saved && form ? buildPatch(saved, form) : {}), [saved, form])
  const dirty = Object.keys(patch).length > 0

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm(f => (f ? { ...f, [key]: value } : f))
    setSaveMsg('')
  }
  const reset = () => { if (saved) setForm(saved); setSaveError(''); setSaveMsg('') }

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!user || !form || !saved) return
    setSaveMsg('')
    const invalid = validate(form)
    if (invalid) { setSaveError(invalid); return }
    if (!dirty) { setSaveError(''); setSaveMsg('Tidak ada perubahan'); return }
    setSaving(true); setSaveError('')
    const { data, error } = await supabase.rpc('admin_save_payment_promo', {
      p_admin_id: user.id, p_admin_email: user.email, p_promo_id: PROMO_ID, p_patch: patch,
    })
    setSaving(false)
    if (error) { setSaveError(rpcError(error.message)); return }
    const row = (Array.isArray(data) ? data[0] : data) as Promo | null
    if (row && row.id) { setPromo(row); setForm(formFromPromo(row)) } else await fetchPromo()
    setNow(Date.now())
    setSaveMsg('Tersimpan')
    window.setTimeout(() => setSaveMsg(m => (m === 'Tersimpan' ? '' : m)), 3000)
  }

  const usage = useMemo(() => {
    let paid = 0, pending = 0, dropped = 0, paidDiscount = 0, liveCount = 0, liveDiscount = 0
    for (const r of rows) {
      const live = isLivePending(r, now)
      const amt = Number(r.discount_amount) || 0
      if (r.status === 'paid') { paid++; paidDiscount += amt } else if (live) pending++; else dropped++
      if (r.status === 'paid' || live) { liveCount++; liveDiscount += amt }
    }
    return { paid, pending, dropped, paidDiscount, liveCount, liveDiscount }
  }, [rows, now])

  const state = promo ? promoState(promo, now) : null
  const subtitle = promo
    ? `Diskon ${fmtPct(promo.pct)}% untuk pembayaran ${methodsText(promo.methods ?? [])} di booking.20fit.id (add-on tidak termasuk).`
    : 'Diskon pembayaran Bank Mandiri di booking.20fit.id (add-on tidak termasuk).'

  const rpHint = (v: string, blank: string) =>
    v.trim() === '' ? blank : isInt(v) ? `= ${fmtRp(Number(v))}` : 'Harus bilangan bulat ≥ 0'
  const numInput = (key: IntKey | 'pct', placeholder?: string) => (
    <input
      type="number" min={0} step={key === 'pct' ? '0.01' : '1'} max={key === 'pct' ? 50 : undefined}
      inputMode={key === 'pct' ? 'decimal' : 'numeric'}
      value={form ? form[key] : ''} placeholder={placeholder}
      onChange={e => set(key, e.target.value)}
    />
  )
  const dateInput = (key: 'start_at' | 'end_at', label: string, blank: string) => (
    <div className="form-group">
      <label>{label}</label>
      <input type="datetime-local" value={form ? form[key] : ''} onChange={e => set(key, e.target.value)} />
      {form && form[key]
        ? <span style={hint}><button type="button" className="btn-text" style={{ fontSize: 11 }} onClick={() => set(key, '')}>Kosongkan</button></span>
        : <span style={hint}>{blank}</span>}
    </div>
  )

  // Live example under the discount fields.
  const example = (() => {
    if (!form || !/^\d+(\.\d{1,2})?$/.test(form.pct.trim())) return ''
    if (isInt(form.min_amount) && EXAMPLE_BASE < Number(form.min_amount)) {
      return `Contoh: produk ${fmtRp(EXAMPLE_BASE)} → tanpa diskon (di bawah minimal).`
    }
    let d = Math.round((EXAMPLE_BASE * Number(form.pct)) / 100)
    if (isInt(form.cap_amount)) d = Math.min(d, Number(form.cap_amount))
    return `Contoh: produk ${fmtRp(EXAMPLE_BASE)} (di luar add-on) → diskon ${fmtRp(d)}.`
  })()
  const bins = form ? parseBins(form.bin_list) : []
  const badBins = bins.filter(b => !/^\d{4,8}$/.test(b))

  return (
    <div>
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <h2 className="page-title">Promo Mandiri</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '4px 0 0' }}>{subtitle}</p>
        </div>
        {form && saved && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {state && <span className={`badge ${state.css}`} title="Status promo yang tersimpan">{state.label}</span>}
            <label className="toggle" style={{ fontSize: 13 }} title="Aktifkan / matikan promo (klik Simpan untuk menerapkan)">
              <span className={`toggle-track ${form.enabled ? 'on' : ''}`}><span className="toggle-thumb" /></span>
              <input type="checkbox" checked={form.enabled} onChange={e => set('enabled', e.target.checked)} style={{ display: 'none' }} />
              <span style={{ fontWeight: 700, color: form.enabled ? 'var(--text-primary)' : 'var(--text-muted)' }}>{form.enabled ? 'ON' : 'OFF'}</span>
            </label>
            {dirty && (
              <button type="button" className="action-btn confirm" onClick={() => handleSave()} disabled={saving}>
                {saving ? 'Menyimpan…' : 'Simpan perubahan'}
              </button>
            )}
          </div>
        )}
      </div>

      {loadError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{loadError}</p>}

      {loading ? (
        <p style={{ color: 'var(--text-faint)', fontSize: 14 }}>Memuat konfigurasi…</p>
      ) : form && promo && (
        <form onSubmit={handleSave} className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 24, maxWidth: 860 }}>
          <div style={cardHeader}>
            <div>
              <div style={cardTitle}>Pengaturan</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Berlaku untuk pembayaran baru. Diskon dihitung dari harga produk, tanpa add-on.</div>
            </div>
          </div>

          <div style={{ padding: '18px 22px' }}>
            <div style={sectionTitle}>Diskon</div>
            <div className="form-row">
              <div className="form-group">
                <label>Diskon (%)</label>
                {numInput('pct', '5')}
                <span style={hint}>0–50%. {example}</span>
              </div>
              <div className="form-group">
                <label>Maks. diskon per pembayaran (Rp)</label>
                {numInput('cap_amount', 'kosong = tanpa batas')}
                <span style={hint}>{rpHint(form.cap_amount, 'Kosong = tanpa batas')}</span>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label>Minimal nilai produk (Rp)</label>
                {numInput('min_amount', 'kosong = tanpa minimum')}
                <span style={hint}>{rpHint(form.min_amount, 'Kosong = tanpa minimum')}</span>
              </div>
              <div />
            </div>

            <div style={sectionStyle}>
              <div style={sectionTitle}>Berlaku untuk</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Metode pembayaran</label>
                  {METHODS.map(m => (
                    <label key={m.key} style={checkLabel}>
                      <input type="checkbox" checked={form.methods.includes(m.key)} onChange={() => set('methods', toggled(METHODS, form.methods, m.key))} />
                      {m.label}
                    </label>
                  ))}
                </div>
                <div className="form-group">
                  <label>Flow booking</label>
                  {FLOWS.map(fl => (
                    <label key={fl.key} style={checkLabel}>
                      <input type="checkbox" checked={form.flows.includes(fl.key)} onChange={() => set('flows', toggled(FLOWS, form.flows, fl.key))} />
                      <span>{fl.label} <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>({fl.key})</span></span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={sectionTitle}>Batas pemakaian</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Limit per kartu / per customer per hari</label>
                  {numInput('per_identity_daily_limit', '1')}
                  <span style={hint}>Jumlah pembayaran berdiskon per kartu (kartu) atau per no. HP / email customer (VA) per hari WIB. 0 = tanpa batas.</span>
                </div>
                <div className="form-group">
                  <label>Limit per kartu / per customer total</label>
                  {numInput('per_identity_total_limit', 'kosong = tanpa batas')}
                  <span style={hint}>Selama promo berjalan. Kosong = tanpa batas.</span>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Kuota total (pembayaran)</label>
                  {numInput('total_quota', 'kosong = tanpa batas')}
                  <span style={hint}>Semua pembayaran berdiskon. Kosong = tanpa batas.</span>
                </div>
                <div className="form-group">
                  <label>Budget total (Rp)</label>
                  {numInput('budget_amount', 'kosong = tanpa batas')}
                  <span style={hint}>{rpHint(form.budget_amount, 'Total diskon yang boleh diberikan. Kosong = tanpa batas')}</span>
                </div>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={sectionTitle}>Periode</div>
              <div className="form-row">
                {dateInput('start_at', 'Mulai (WIB)', 'Kosong = langsung berlaku')}
                {dateInput('end_at', 'Selesai (WIB)', 'Kosong = tanpa tanggal berakhir')}
              </div>
            </div>

            <div style={sectionStyle}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label>
                  BIN kartu Mandiri{' '}
                  <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 'normal', fontFamily: 'var(--font-body)' }}>({bins.length} BIN)</span>
                </label>
                <textarea rows={4} value={form.bin_list} onChange={e => set('bin_list', e.target.value)}
                  placeholder="490284, 490283, ..." style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }} />
                <span style={hint}>
                  Pisahkan dengan koma atau baris baru. Kartu dianggap kartu Mandiri bila nomornya diawali salah satu BIN ini,
                  atau nama issuer kartunya mengandung &quot;MANDIRI&quot;.
                </span>
                {badBins.length > 0 && (
                  <span style={{ ...hint, color: 'var(--red)' }}>Tidak valid (harus 4–8 digit angka): {badBins.slice(0, 8).join(', ')}{badBins.length > 8 ? ', …' : ''}</span>
                )}
              </div>
            </div>
          </div>

          <div style={{ padding: '14px 22px 18px', borderTop: '1px solid var(--border)' }}>
            {saveError && <p style={{ color: 'var(--red)', fontSize: 13, margin: '0 0 12px' }}>{saveError}</p>}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {promo.updated_at ? `Terakhir diupdate: ${fmtDateTime(promo.updated_at)} oleh ${promo.updated_by || '—'}` : 'Belum pernah diupdate'}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {saveMsg
                  ? <span style={{ fontSize: 12, fontWeight: 600, color: saveMsg === 'Tersimpan' ? 'var(--green)' : 'var(--text-muted)' }}>{saveMsg}</span>
                  : dirty && <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--amber)' }}>Perubahan belum disimpan</span>}
                {dirty && <button type="button" className="btn-secondary" onClick={reset} disabled={saving}>Batal</button>}
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Menyimpan…' : 'Simpan'}</button>
              </div>
            </div>
          </div>
        </form>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={cardHeader}>
          <div>
            <div style={cardTitle}>Pemakaian</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Pembayaran yang mendapat diskon promo ini (terbaru di atas).</div>
          </div>
          <button type="button" className="action-btn" onClick={fetchUsage} disabled={usageLoading}>{usageLoading ? 'Memuat…' : 'Muat ulang'}</button>
        </div>

        <div style={{ padding: '18px 22px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12 }}>
          {([
            {
              label: 'Paid', value: String(usage.paid),
              sub: promo?.total_quota != null ? `Kuota terpakai ${usage.liveCount} / ${promo.total_quota}` : 'Pembayaran berhasil',
              color: 'var(--green)',
            },
            { label: 'Pending', value: String(usage.pending), sub: 'Menunggu pembayaran (≤ 35 menit)', color: 'var(--amber)' },
            {
              label: 'Total diskon (paid)', value: fmtRp(usage.paidDiscount),
              sub: promo?.budget_amount != null
                ? `Sisa budget ${fmtRp(Math.max(0, promo.budget_amount - usage.liveDiscount))} dari ${fmtRp(promo.budget_amount)}`
                : 'Budget tanpa batas',
              color: 'var(--red)',
            },
            { label: 'Tidak jadi', value: String(usage.dropped), sub: 'Released / expired (tidak dibayar)', color: 'var(--text-faint)' },
          ] as { label: string; value: string; sub: string; color: string }[]).map(k => (
            <div key={k.label} style={tile}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 999, background: k.color, flex: '0 0 auto' }} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{k.label}</div>
              </div>
              <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--text-primary)' }}>{usageLoading ? '...' : usageError ? '—' : k.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div className="table-wrap" style={{ margin: 0 }}>
          <table className="data-table">
            <thead>
              <tr><th>Waktu</th><th>Kode Booking</th><th>Metode</th><th>Kartu / Customer</th><th>Diskon</th><th>Status</th></tr>
            </thead>
            <tbody>
              {usageLoading ? (
                <tr className="loading-row"><td colSpan={6}>Memuat...</td></tr>
              ) : usageError ? (
                <tr><td colSpan={6} style={{ color: 'var(--red)' }}>{usageError}</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={6} className="empty-state">Belum ada pembayaran yang memakai promo ini</td></tr>
              ) : rows.slice(0, USAGE_TABLE_ROWS).map(r => {
                const b = redemptionBadge(r, now)
                return (
                  <tr key={r.booking_code}>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(r.created_at)}</td>
                    <td className="mono" style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{r.booking_code}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{METHOD_LABEL[r.method] ?? r.method}</td>
                    <td style={{ fontSize: 12 }}>{r.identity_label || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(r.discount_amount)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className={`badge ${b.css}`} style={b.css ? undefined : neutralBadge}>{b.label}</span>
                      {r.status === 'paid' && r.paid_at && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>dibayar {fmtDateTime(r.paid_at)}</div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {!usageLoading && !usageError && rows.length > USAGE_TABLE_ROWS && (
          <div style={{ padding: '12px 22px', fontSize: 11, color: 'var(--text-faint)' }}>
            Menampilkan {USAGE_TABLE_ROWS} transaksi terbaru dari {rows.length.toLocaleString('id-ID')}.
            {rows.length >= USAGE_FETCH_LIMIT && ` Ringkasan di atas dihitung dari ${USAGE_FETCH_LIMIT.toLocaleString('id-ID')} transaksi terbaru.`}
          </div>
        )}
      </div>
    </div>
  )
}
