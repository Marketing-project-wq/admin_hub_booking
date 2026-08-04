import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtTime } from '../../lib/format'

interface Voucher {
  id: string; code: string; description: string; discount_type: string; discount_value: number;
  min_booking_amount: number; max_discount_amount: number | null; quota: number; used_count: number;
  valid_from: string; valid_until: string; is_active: boolean; corporation_only: boolean;
  applies_to: string;   // 'class_booking' | 'package_purchase' | 'both'
}

type ClassTypeEmbed = { name: string; color: string | null }
interface ScheduleOption {
  id: string
  schedule_date: string
  start_time: string
  end_time: string
  instructor: string | null
  // PostgREST returns the to-one embed as an object (older versions: an array)
  arena_class_types: ClassTypeEmbed | ClassTypeEmbed[] | null
}

interface PackageOption {
  id: string
  name: string
  sessions: number
  price: number
  is_active: boolean
}

const emptyForm = (): Partial<Voucher> => ({
  code: '', description: '', discount_type: 'percentage', discount_value: 0,
  min_booking_amount: 0, max_discount_amount: null, quota: 1,
  valid_from: '', valid_until: '', is_active: true, corporation_only: false,
  applies_to: 'class_booking',
})

// "Senin, 7 Jul 2026 — 08:00-09:00 — Foundation (Elsen)"
const scheduleLabel = (s: ScheduleOption) => {
  const ct = Array.isArray(s.arena_class_types) ? s.arena_class_types[0] : s.arena_class_types
  // Parse as local midnight so the weekday matches the calendar date regardless of timezone
  const dateLabel = new Date(`${s.schedule_date}T00:00:00`).toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
  })
  const time = `${fmtTime(s.start_time)}-${fmtTime(s.end_time)}`
  const cls = ct?.name || 'Kelas'
  const coach = s.instructor ? ` (${s.instructor})` : ''
  return `${dateLabel} — ${time} — ${cls}${coach}`
}

// "HYROX Complete — 10 sesi — Rp 1.500.000"
const packageLabel = (p: PackageOption) =>
  `${p.name} — ${p.sessions} sesi — Rp ${p.price.toLocaleString('id-ID')}${p.is_active ? '' : ' (nonaktif)'}`

export default function ArenaVouchers() {
  const [data, setData] = useState<Voucher[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Voucher>>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // Voucher-per-schedule feature
  const [scheduleCounts, setScheduleCounts] = useState<Record<string, number>>({})
  const [schedules, setSchedules] = useState<ScheduleOption[]>([])
  const [schedulesLoading, setSchedulesLoading] = useState(false)
  const [restrictSchedule, setRestrictSchedule] = useState(false)
  const [selectedScheduleIds, setSelectedScheduleIds] = useState<Set<string>>(new Set())
  const [scheduleSearch, setScheduleSearch] = useState('')

  // Voucher-per-package feature (restriksi pembelian paket — pola sama dgn jadwal)
  const [packageCounts, setPackageCounts] = useState<Record<string, number>>({})
  const [packages, setPackages] = useState<PackageOption[]>([])
  const [packagesLoading, setPackagesLoading] = useState(false)
  const [restrictPackage, setRestrictPackage] = useState(false)
  const [selectedPackageIds, setSelectedPackageIds] = useState<Set<string>>(new Set())

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase.from('arena_vouchers').select('*').order('created_at', { ascending: false })
    if (err) { setError(err.message); setLoading(false); return }
    setData(rows as Voucher[])

    // How many schedules each voucher is restricted to (no rows => berlaku semua jadwal)
    const { data: assignRows } = await supabase.from('arena_voucher_schedules').select('voucher_id')
    const counts: Record<string, number> = {}
    for (const r of (assignRows || []) as { voucher_id: string }[]) {
      counts[r.voucher_id] = (counts[r.voucher_id] || 0) + 1
    }
    setScheduleCounts(counts)

    // Idem untuk restriksi paket (no rows => berlaku semua paket)
    const { data: pkgAssignRows } = await supabase.from('arena_voucher_packages').select('voucher_id')
    const pkgCounts: Record<string, number> = {}
    for (const r of (pkgAssignRows || []) as { voucher_id: string }[]) {
      pkgCounts[r.voucher_id] = (pkgCounts[r.voucher_id] || 0) + 1
    }
    setPackageCounts(pkgCounts)
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Future, non-cancelled schedules for the selector
  const fetchSchedules = useCallback(async () => {
    setSchedulesLoading(true)
    const today = new Date().toISOString().split('T')[0]
    const { data: rows } = await supabase
      .from('arena_class_schedules')
      .select(`
        id,
        schedule_date,
        start_time,
        end_time,
        instructor,
        arena_class_types (name, color)
      `)
      .gte('schedule_date', today)
      .eq('is_cancelled', false)
      .order('schedule_date', { ascending: true })
      .order('start_time', { ascending: true })
    setSchedules((rows || []) as unknown as ScheduleOption[])
    setSchedulesLoading(false)
  }, [])

  // Semua paket (termasuk nonaktif — restriksi lama bisa menunjuk paket nonaktif), urut tampilan customer
  const fetchPackages = useCallback(async () => {
    setPackagesLoading(true)
    const { data: rows } = await supabase
      .from('arena_packages')
      .select('id, name, sessions, price, is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    setPackages((rows || []) as PackageOption[])
    setPackagesLoading(false)
  }, [])

  const openAdd = () => {
    setForm(emptyForm()); setEditId(null); setFormError('')
    setRestrictSchedule(false); setSelectedScheduleIds(new Set()); setScheduleSearch('')
    setRestrictPackage(false); setSelectedPackageIds(new Set())
    setShowModal(true)
    fetchSchedules()
    fetchPackages()
  }

  const openEdit = async (v: Voucher) => {
    setForm({ ...v, applies_to: v.applies_to || 'class_booking' }); setEditId(v.id); setFormError('')
    setScheduleSearch(''); setSelectedScheduleIds(new Set()); setRestrictSchedule(false)
    setRestrictPackage(false); setSelectedPackageIds(new Set())
    setShowModal(true)
    fetchSchedules()
    fetchPackages()
    // Load existing assignments — presence of rows => voucher is restricted
    const { data: assignments } = await supabase
      .from('arena_voucher_schedules')
      .select('schedule_id')
      .eq('voucher_id', v.id)
    const ids = (assignments || []).map(a => (a as { schedule_id: string }).schedule_id)
    setSelectedScheduleIds(new Set(ids))
    setRestrictSchedule(ids.length > 0)

    const { data: pkgAssignments } = await supabase
      .from('arena_voucher_packages')
      .select('package_id')
      .eq('voucher_id', v.id)
    const pkgIds = (pkgAssignments || []).map(a => (a as { package_id: string }).package_id)
    setSelectedPackageIds(new Set(pkgIds))
    setRestrictPackage(pkgIds.length > 0)
  }

  // Scope voucher — restriksi jadwal hanya relevan utk booking kelas, restriksi paket utk pembelian paket
  const appliesTo = form.applies_to || 'class_booking'
  const scopeClass = appliesTo === 'class_booking' || appliesTo === 'both'
  const scopePackage = appliesTo === 'package_purchase' || appliesTo === 'both'

  // Sync arena_voucher_schedules to the current selection. Returns an error message or null.
  // Delete jalan terus walau scope tak mencakup kelas — membersihkan restriksi basi saat scope diganti.
  const syncSchedules = async (voucherId: string): Promise<string | null> => {
    const del = await supabase.from('arena_voucher_schedules').delete().eq('voucher_id', voucherId)
    if (del.error) return del.error.message
    if (scopeClass && restrictSchedule && selectedScheduleIds.size > 0) {
      const rows = Array.from(selectedScheduleIds).map(schedule_id => ({ voucher_id: voucherId, schedule_id }))
      const ins = await supabase.from('arena_voucher_schedules').insert(rows)
      if (ins.error) return ins.error.message
    }
    return null
  }

  // Idem untuk arena_voucher_packages (0 baris = berlaku semua paket)
  const syncPackages = async (voucherId: string): Promise<string | null> => {
    const del = await supabase.from('arena_voucher_packages').delete().eq('voucher_id', voucherId)
    if (del.error) return del.error.message
    if (scopePackage && restrictPackage && selectedPackageIds.size > 0) {
      const rows = Array.from(selectedPackageIds).map(package_id => ({ voucher_id: voucherId, package_id }))
      const ins = await supabase.from('arena_voucher_packages').insert(rows)
      if (ins.error) return ins.error.message
    }
    return null
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.code) return setFormError('Code wajib diisi')
    if (!form.discount_value || form.discount_value <= 0) return setFormError('Nilai diskon harus > 0')
    if (form.valid_until && form.valid_from && form.valid_until < form.valid_from) return setFormError('Valid Until harus setelah Valid From')
    if (scopeClass && restrictSchedule && selectedScheduleIds.size === 0) return setFormError('Pilih minimal 1 jadwal, atau matikan pembatasan jadwal')
    if (scopePackage && restrictPackage && selectedPackageIds.size === 0) return setFormError('Pilih minimal 1 paket, atau matikan pembatasan paket')

    setSaving(true)
    const payload = {
      code: form.code!.toUpperCase(),
      description: form.description,
      discount_type: form.discount_type,
      discount_value: form.discount_value,
      min_booking_amount: form.min_booking_amount || 0,
      max_discount_amount: form.max_discount_amount || null,
      quota: form.quota || 1,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      is_active: form.is_active ?? true,
      corporation_only: form.corporation_only ?? false,
      applies_to: appliesTo,
      updated_at: new Date().toISOString(),
    }

    let voucherId: string | null = editId
    let err
    if (editId) {
      const res = await supabase.from('arena_vouchers').update(payload).eq('id', editId)
      err = res.error
    } else {
      // Check unique
      const { data: existing } = await supabase.from('arena_vouchers').select('id').eq('code', payload.code).single()
      if (existing) { setSaving(false); return setFormError('Code voucher sudah digunakan') }
      const res = await supabase.from('arena_vouchers').insert({ ...payload, created_at: new Date().toISOString() }).select('id').single()
      err = res.error
      voucherId = res.data?.id ?? null
    }
    if (err) { setSaving(false); setFormError(err.message); return }

    // Sync schedule/package assignments (backward compatible: no rows => berlaku semua)
    if (voucherId) {
      const syncErr = await syncSchedules(voucherId)
      if (syncErr) { setSaving(false); setFormError(`Voucher tersimpan, tapi gagal menyimpan jadwal: ${syncErr}`); fetchData(); return }
      const pkgSyncErr = await syncPackages(voucherId)
      if (pkgSyncErr) { setSaving(false); setFormError(`Voucher tersimpan, tapi gagal menyimpan paket: ${pkgSyncErr}`); fetchData(); return }
    }

    setSaving(false)
    setShowModal(false)
    fetchData()
  }

  const toggleActive = async (v: Voucher) => {
    await supabase.from('arena_vouchers').update({ is_active: !v.is_active, updated_at: new Date().toISOString() }).eq('id', v.id)
    fetchData()
  }

  const toggleSchedule = (id: string, checked: boolean) => {
    setSelectedScheduleIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  const togglePackage = (id: string, checked: boolean) => {
    setSelectedPackageIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(id); else next.delete(id)
      return next
    })
  }

  const f = form

  // Selected assignments that aren't in the future/active list (already-past or cancelled) — kept on save
  const visibleIds = new Set(schedules.map(s => s.id))
  const hiddenSelectedCount = Array.from(selectedScheduleIds).filter(id => !visibleIds.has(id)).length

  const ss = scheduleSearch.toLowerCase()
  const filteredSchedules = scheduleSearch
    ? schedules.filter(s => scheduleLabel(s).toLowerCase().includes(ss))
    : schedules

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Vouchers</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Voucher</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari kode atau deskripsi voucher..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />
        {search && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => setSearch('')}
          >
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        {(() => {
          const sl = search.toLowerCase()
          const displayData = search
            ? data.filter(v =>
                v.code?.toLowerCase().includes(sl) ||
                v.description?.toLowerCase().includes(sl)
              )
            : data
          return (
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th><th>Deskripsi</th><th>Tipe Diskon</th><th>Nilai</th>
              <th>Quota</th><th>Used</th><th>Valid Until</th><th>Berlaku Untuk</th><th>Status</th>
              <th>Corp Only</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={11}>Memuat data...</td></tr>
            ) : displayData.length === 0 ? (
              <tr><td colSpan={11} className="empty-state">{search ? 'Tidak ada hasil' : 'Tidak ada voucher'}</td></tr>
            ) : displayData.map(v => {
              const count = scheduleCounts[v.id] || 0
              const pkgCount = packageCounts[v.id] || 0
              const scope = v.applies_to || 'class_booking'
              const rowScopeClass = scope === 'class_booking' || scope === 'both'
              const rowScopePackage = scope === 'package_purchase' || scope === 'both'
              return (
              <tr key={v.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{v.code}</td>
                <td>{v.description}</td>
                <td>{v.discount_type}</td>
                <td>{v.discount_type === 'percentage' ? `${v.discount_value}%` : `Rp ${v.discount_value.toLocaleString('id-ID')}`}</td>
                <td style={{ textAlign: 'center' }}>{v.quota}</td>
                <td style={{ textAlign: 'center' }}>{v.used_count}</td>
                <td>{fmtDate(v.valid_until)}</td>
                <td style={{ textAlign: 'center' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                    {rowScopeClass && (count > 0 ? (
                      <span className="badge badge-pending">Kelas · {count} Jadwal</span>
                    ) : (
                      <span className="badge" style={{ background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Kelas · Semua Jadwal</span>
                    ))}
                    {rowScopePackage && (pkgCount > 0 ? (
                      <span className="badge badge-pending">Paket · {pkgCount} Paket</span>
                    ) : (
                      <span className="badge" style={{ background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Paket · Semua Paket</span>
                    ))}
                  </div>
                </td>
                <td>
                  <span className={`badge ${v.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {v.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>{v.corporation_only ? 'Ya' : '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => openEdit(v)}>Edit</button>
                  <button className="action-btn" onClick={() => toggleActive(v)}>
                    {v.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
          )
        })()}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Voucher' : 'Tambah Voucher'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group">
                  <label>Code *</label>
                  <input type="text" value={f.code || ''} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} required />
                </div>
                <div className="form-group">
                  <label>Deskripsi</label>
                  <input type="text" value={f.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Tipe Diskon *</label>
                <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                  {['percentage', 'fixed'].map(t => (
                    <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                      <input type="radio" name="dtype" value={t} checked={f.discount_type === t} onChange={() => setForm(p => ({ ...p, discount_type: t }))} />
                      {t === 'percentage' ? 'Persentase (%)' : 'Nominal (Rp)'}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nilai Diskon * {f.discount_type === 'percentage' ? '(%)' : '(Rp)'}</label>
                  <input type="number" min={0} max={f.discount_type === 'percentage' ? 100 : undefined} value={f.discount_value || ''} onChange={e => setForm(p => ({ ...p, discount_value: Number(e.target.value) }))} required />
                </div>
                {f.discount_type === 'percentage' && (
                  <div className="form-group">
                    <label>Max Diskon (Rp)</label>
                    <input type="number" min={0} value={f.max_discount_amount || ''} onChange={e => setForm(p => ({ ...p, max_discount_amount: Number(e.target.value) || null }))} />
                  </div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Min Booking Amount (Rp)</label>
                  <input type="number" min={0} value={f.min_booking_amount || 0} onChange={e => setForm(p => ({ ...p, min_booking_amount: Number(e.target.value) }))} />
                </div>
                <div className="form-group">
                  <label>Quota</label>
                  <input type="number" min={1} value={f.quota || 1} onChange={e => setForm(p => ({ ...p, quota: Number(e.target.value) }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Valid From</label>
                  <input type="date" value={f.valid_from || ''} onChange={e => setForm(p => ({ ...p, valid_from: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Valid Until</label>
                  <input type="date" value={f.valid_until || ''} onChange={e => setForm(p => ({ ...p, valid_until: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={f.corporation_only ?? false} onChange={e => setForm(p => ({ ...p, corporation_only: e.target.checked }))} />
                  Corporation Only
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={f.is_active ?? true} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />
                  Active
                </label>
              </div>

              {/* Scope voucher — menentukan seksi restriksi mana yang relevan */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
                <label style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Berlaku Untuk *
                </label>
                <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                  {([['class_booking', 'Booking Kelas'], ['package_purchase', 'Pembelian Paket'], ['both', 'Keduanya']] as const).map(([val, lbl]) => (
                    <label key={val} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                      <input type="radio" name="applies_to" value={val} checked={appliesTo === val} onChange={() => setForm(p => ({ ...p, applies_to: val }))} />
                      {lbl}
                    </label>
                  ))}
                </div>
                <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, display: 'block' }}>
                  {appliesTo === 'class_booking' && 'Voucher hanya bisa dipakai saat booking kelas/slot (perilaku lama).'}
                  {appliesTo === 'package_purchase' && 'Voucher hanya bisa dipakai saat pembelian paket di halaman checkout paket.'}
                  {appliesTo === 'both' && 'Voucher bisa dipakai di booking kelas DAN pembelian paket (kuota digabung).'}
                </small>
              </div>

              {/* Jadwal Berlaku — hanya relevan bila scope mencakup booking kelas */}
              {scopeClass && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
                <label className="toggle" style={{ fontSize: 14 }}>
                  <span className={`toggle-track ${restrictSchedule ? 'on' : ''}`}><span className="toggle-thumb" /></span>
                  <input type="checkbox" checked={restrictSchedule} onChange={e => setRestrictSchedule(e.target.checked)} style={{ display: 'none' }} />
                  <strong>Batasi ke jadwal tertentu</strong>
                </label>
                <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, display: 'block' }}>
                  {restrictSchedule
                    ? 'Voucher hanya berlaku untuk jadwal yang dipilih di bawah.'
                    : 'Voucher berlaku untuk SEMUA jadwal kelas (default).'}
                </small>

                {restrictSchedule && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                        Pilih Jadwal — {selectedScheduleIds.size} dipilih
                      </label>
                      {selectedScheduleIds.size > 0 && (
                        <button type="button" className="btn-text" style={{ fontSize: 12 }} onClick={() => setSelectedScheduleIds(new Set())}>
                          Kosongkan
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Cari jadwal (kelas / instruktur / tanggal)..."
                      value={scheduleSearch}
                      onChange={e => setScheduleSearch(e.target.value)}
                      style={{ width: '100%', marginBottom: 8 }}
                    />
                    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                      {schedulesLoading ? (
                        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Memuat jadwal...</div>
                      ) : filteredSchedules.length === 0 ? (
                        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                          {scheduleSearch ? 'Tidak ada jadwal cocok' : 'Tidak ada jadwal mendatang'}
                        </div>
                      ) : filteredSchedules.map(s => (
                        <label
                          key={s.id}
                          style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedScheduleIds.has(s.id)}
                            onChange={e => toggleSchedule(s.id, e.target.checked)}
                          />
                          <span>{scheduleLabel(s)}</span>
                        </label>
                      ))}
                    </div>
                    {hiddenSelectedCount > 0 && !schedulesLoading && (
                      <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, display: 'block' }}>
                        + {hiddenSelectedCount} jadwal terpilih yang sudah lewat/dibatalkan tetap tersimpan (tidak ditampilkan di daftar).
                      </small>
                    )}
                  </div>
                )}
              </div>
              )}

              {/* Paket Berlaku — hanya relevan bila scope mencakup pembelian paket */}
              {scopePackage && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
                <label className="toggle" style={{ fontSize: 14 }}>
                  <span className={`toggle-track ${restrictPackage ? 'on' : ''}`}><span className="toggle-thumb" /></span>
                  <input type="checkbox" checked={restrictPackage} onChange={e => setRestrictPackage(e.target.checked)} style={{ display: 'none' }} />
                  <strong>Batasi ke paket tertentu</strong>
                </label>
                <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, display: 'block' }}>
                  {restrictPackage
                    ? 'Voucher hanya berlaku untuk paket yang dipilih di bawah.'
                    : 'Voucher berlaku untuk SEMUA paket (default).'}
                </small>

                {restrictPackage && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                        Pilih Paket — {selectedPackageIds.size} dipilih
                      </label>
                      {selectedPackageIds.size > 0 && (
                        <button type="button" className="btn-text" style={{ fontSize: 12 }} onClick={() => setSelectedPackageIds(new Set())}>
                          Kosongkan
                        </button>
                      )}
                    </div>
                    <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                      {packagesLoading ? (
                        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Memuat paket...</div>
                      ) : packages.length === 0 ? (
                        <div style={{ padding: 16, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Tidak ada paket</div>
                      ) : packages.map(p => (
                        <label
                          key={p.id}
                          style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13, opacity: p.is_active ? 1 : 0.6 }}
                        >
                          <input
                            type="checkbox"
                            checked={selectedPackageIds.has(p.id)}
                            onChange={e => togglePackage(p.id, e.target.checked)}
                          />
                          <span>{packageLabel(p)}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              )}

              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
