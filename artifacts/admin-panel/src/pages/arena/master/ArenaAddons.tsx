import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { fmtRp } from '../../../lib/format'

// Add-on catalog (arena_addons). Equipment/service add-ons bought during class/arena booking.
// F1: global stock (stock_total capacity + stock_remaining live; NULL = unlimited),
// class-type eligibility (arena_addon_class_types), show_on_arena flag (BK- flow).
// extend-F1: specific-schedule eligibility (arena_addon_schedules). An add-on is unrestricted
// (all classes) only when it has NO rows in EITHER eligibility table; any row in either
// restricts it to the UNION of (matching class types) ∪ (matching specific schedules).
// Upsell pop-up (booking.20fit.id): when a class-booking customer continues without any add-on,
// the first active + eligible + in-stock add-on with upsell_enabled (lowest sort_order) is offered.
// Empty upsell_* fields fall back to name / description / image_url; button defaults to "Add to booking".

interface Addon {
  id: string; name: string; description: string; price: number; image_url: string | null
  is_active: boolean; sort_order: number
  stock_total: number | null; stock_remaining: number | null; show_on_arena: boolean
  upsell_enabled: boolean; upsell_title: string | null; upsell_body: string | null
  upsell_image_url: string | null; upsell_badge: string | null; upsell_cta: string | null
}
interface ClassType { id: string; name: string }
interface ScheduleOpt { id: string; schedule_date: string; start_time: string; class_type: { name: string } | { name: string }[] | null }

const emptyForm = (): Partial<Addon> => ({
  name: '', description: '', price: 0, image_url: '', is_active: true, sort_order: 0,
  stock_total: null, show_on_arena: true,
  upsell_enabled: false, upsell_title: '', upsell_body: '', upsell_image_url: '', upsell_badge: '', upsell_cta: '',
})

// '' / whitespace-only → null, so booking.20fit.id falls back to the add-on's own fields.
const blankToNull = (s: string | null | undefined): string | null => (s ?? '').trim() || null

const ctName = (c: ScheduleOpt['class_type']): string =>
  (Array.isArray(c) ? c[0]?.name : c?.name) ?? 'Kelas'
const schedLabel = (s: ScheduleOpt): string => {
  const d = new Date(s.schedule_date + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return `${ctName(s.class_type)} — ${d} ${String(s.start_time).slice(0, 5)}`
}

export default function ArenaAddons() {
  const [data, setData] = useState<Addon[]>([])
  const [classTypes, setClassTypes] = useState<ClassType[]>([])
  const [schedules, setSchedules] = useState<ScheduleOpt[]>([])          // upcoming options (capped)
  const [eligMap, setEligMap] = useState<Record<string, string[]>>({})     // addon_id -> class_type_id[]
  const [eligSchedMap, setEligSchedMap] = useState<Record<string, string[]>>({}) // addon_id -> schedule_id[]
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Addon>>(emptyForm())
  const [selectedCT, setSelectedCT] = useState<string[]>([])
  const [selectedSched, setSelectedSched] = useState<string[]>([])
  const [pastSched, setPastSched] = useState<ScheduleOpt[]>([])           // selected schedules outside the upcoming set
  const [schedQuery, setSchedQuery] = useState('')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase.from('arena_addons').select('*').order('sort_order')
    if (err) setError(err.message)
    else { setData(rows as Addon[]); setError('') }
    // Eligibility + options are best-effort (still render the catalog pre-migration).
    const { data: elig } = await supabase.from('arena_addon_class_types').select('addon_id, class_type_id')
    if (elig) {
      const m: Record<string, string[]> = {}
      for (const r of elig as { addon_id: string; class_type_id: string }[]) (m[r.addon_id] ??= []).push(r.class_type_id)
      setEligMap(m)
    }
    const { data: eligS } = await supabase.from('arena_addon_schedules').select('addon_id, schedule_id')
    if (eligS) {
      const m: Record<string, string[]> = {}
      for (const r of eligS as { addon_id: string; schedule_id: string }[]) (m[r.addon_id] ??= []).push(r.schedule_id)
      setEligSchedMap(m)
    }
    const { data: cts } = await supabase.from('arena_class_types').select('id, name').eq('is_active', true).order('name')
    if (cts) setClassTypes(cts as ClassType[])
    const today = new Date().toISOString().slice(0, 10)
    const { data: scheds } = await supabase.from('arena_class_schedules')
      .select('id, schedule_date, start_time, class_type:arena_class_types(name)')
      .gte('schedule_date', today).eq('is_cancelled', false)
      .order('schedule_date', { ascending: true }).order('start_time', { ascending: true })
      .limit(500)
    if (scheds) setSchedules(scheds as ScheduleOpt[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => {
    setForm(emptyForm()); setSelectedCT([]); setSelectedSched([]); setPastSched([])
    setSchedQuery(''); setEditId(null); setFormError(''); setShowModal(true)
  }
  const openEdit = async (a: Addon) => {
    setForm({ ...a, stock_total: a.stock_total ?? null })
    setSelectedCT(eligMap[a.id] ?? [])
    const sel = eligSchedMap[a.id] ?? []
    setSelectedSched(sel); setSchedQuery(''); setEditId(a.id); setFormError(''); setShowModal(true)
    // Fetch any selected schedules not in the upcoming list (past / beyond the cap) so they render.
    const missing = sel.filter(id => !schedules.some(s => s.id === id))
    if (missing.length) {
      const { data: extra } = await supabase.from('arena_class_schedules')
        .select('id, schedule_date, start_time, class_type:arena_class_types(name)').in('id', missing)
      setPastSched((extra as ScheduleOpt[]) ?? [])
    } else setPastSched([])
  }

  const toggleCT = (id: string) => setSelectedCT(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  const toggleSched = (id: string) => setSelectedSched(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return setFormError('Nama wajib diisi')
    setSaving(true)

    const stockTotal: number | null =
      form.stock_total === null || form.stock_total === undefined || (form.stock_total as unknown as string) === ''
        ? null : Number(form.stock_total)
    let stockRemaining: number | null
    if (!editId) {
      stockRemaining = stockTotal
    } else {
      const orig = data.find(d => d.id === editId)
      const oldTotal = orig?.stock_total ?? null
      if (stockTotal === null) stockRemaining = null
      else if (oldTotal === null) stockRemaining = stockTotal
      else stockRemaining = Math.max(0, (orig?.stock_remaining ?? 0) + (stockTotal - oldTotal))
    }

    const payload = {
      name: form.name, description: form.description, price: form.price || 0,
      image_url: form.image_url || null, is_active: form.is_active ?? true, sort_order: form.sort_order || 0,
      show_on_arena: form.show_on_arena ?? true, stock_total: stockTotal, stock_remaining: stockRemaining,
      upsell_enabled: form.upsell_enabled ?? false,
      upsell_title: blankToNull(form.upsell_title), upsell_body: blankToNull(form.upsell_body),
      upsell_image_url: blankToNull(form.upsell_image_url), upsell_badge: blankToNull(form.upsell_badge),
      upsell_cta: blankToNull(form.upsell_cta),
    }

    let addonId = editId
    if (editId) {
      const { error: err } = await supabase.from('arena_addons').update(payload).eq('id', editId)
      if (err) { setSaving(false); setFormError(err.message); return }
    } else {
      const { data: ins, error: err } = await supabase.from('arena_addons')
        .insert({ ...payload, created_at: new Date().toISOString() }).select('id').single()
      if (err || !ins) { setSaving(false); setFormError(err?.message || 'Gagal membuat add-on'); return }
      addonId = (ins as { id: string }).id
    }
    if (!addonId) { setSaving(false); setFormError('Missing add-on id'); return }

    // Class-type eligibility diff.
    const curCT = eligMap[addonId] || []
    const ctAdd = selectedCT.filter(ct => !curCT.includes(ct))
    const ctDel = curCT.filter(ct => !selectedCT.includes(ct))
    if (ctAdd.length) {
      const { error: e1 } = await supabase.from('arena_addon_class_types').insert(ctAdd.map(ct => ({ addon_id: addonId, class_type_id: ct })))
      if (e1) { setSaving(false); setFormError(e1.message); return }
    }
    if (ctDel.length) {
      const { error: e2 } = await supabase.from('arena_addon_class_types').delete().eq('addon_id', addonId).in('class_type_id', ctDel)
      if (e2) { setSaving(false); setFormError(e2.message); return }
    }

    // Specific-schedule eligibility diff.
    const curS = eligSchedMap[addonId] || []
    const sAdd = selectedSched.filter(id => !curS.includes(id))
    const sDel = curS.filter(id => !selectedSched.includes(id))
    if (sAdd.length) {
      const { error: e3 } = await supabase.from('arena_addon_schedules').insert(sAdd.map(id => ({ addon_id: addonId, schedule_id: id })))
      if (e3) { setSaving(false); setFormError(e3.message); return }
    }
    if (sDel.length) {
      const { error: e4 } = await supabase.from('arena_addon_schedules').delete().eq('addon_id', addonId).in('schedule_id', sDel)
      if (e4) { setSaving(false); setFormError(e4.message); return }
    }

    setSaving(false); setShowModal(false); fetchData()
  }

  const toggleActive = async (a: Addon) => {
    await supabase.from('arena_addons').update({ is_active: !a.is_active }).eq('id', a.id)
    fetchData()
  }

  const stockLabel = (a: Addon) => {
    if (a.stock_total === null || a.stock_total === undefined) return '∞'
    const remaining = a.stock_remaining ?? 0
    return `${remaining} sisa · ${Math.max(0, a.stock_total - remaining)} terpakai`
  }
  const eligLabel = (a: Addon) => {
    const nCT = (eligMap[a.id] ?? []).length
    const nS = (eligSchedMap[a.id] ?? []).length
    return (nCT === 0 && nS === 0) ? 'Semua' : `${nCT} kelas · ${nS} jadwal`
  }

  // Schedule options shown in the modal: upcoming set + any selected-but-outside rows, filtered by search.
  const schedDisplay = (() => {
    const byId: Record<string, ScheduleOpt> = {}
    for (const s of [...schedules, ...pastSched]) byId[s.id] = s
    let list = Object.values(byId)
    const q = schedQuery.trim().toLowerCase()
    if (q) list = list.filter(s => schedLabel(s).toLowerCase().includes(q))
    return list.sort((a, b) => (a.schedule_date + a.start_time).localeCompare(b.schedule_date + b.start_time))
  })()

  const f = form
  // Pop-up preview — same fallbacks as booking.20fit.id (UpsellSheet).
  const upTitle = f.upsell_title?.trim() || f.name || 'Nama add-on'
  const upBody = f.upsell_body?.trim() || f.description || ''
  const upImage = f.upsell_image_url?.trim() || f.image_url || ''
  const upBadge = f.upsell_badge?.trim() || ''
  const upCta = f.upsell_cta?.trim() || 'Add to booking'
  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Add-ons</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Add-on</button>
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Nama</th><th>Harga</th><th>Stok</th><th>Kelas</th><th>Arena</th><th>Sort</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            {loading ? <tr className="loading-row"><td colSpan={8}>Memuat...</td></tr>
              : data.length === 0 ? <tr><td colSpan={8} className="empty-state">Tidak ada add-on</td></tr>
              : data.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>
                    {a.name}
                    {a.upsell_enabled && <span className="badge badge-info" style={{ marginLeft: 8, verticalAlign: 'middle' }} title="Ditawarkan sebagai pop-up upsell di booking.20fit.id">Pop-up</span>}
                  </td>
                  <td>{fmtRp(a.price)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{stockLabel(a)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{eligLabel(a)}</td>
                  <td style={{ textAlign: 'center' }}>{a.show_on_arena ? '✓' : '—'}</td>
                  <td style={{ textAlign: 'center' }}>{a.sort_order}</td>
                  <td><span className={`badge ${a.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>{a.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => openEdit(a)}>Edit</button>
                    <button className="action-btn" onClick={() => toggleActive(a)}>{a.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Add-on' : 'Tambah Add-on'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group"><label>Nama *</label><input value={f.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required /></div>
                <div className="form-group"><label>Harga (Rp)</label><input type="number" min={0} value={f.price || 0} onChange={e => setForm(p => ({ ...p, price: Number(e.target.value) }))} /></div>
              </div>
              <div className="form-group"><label>Deskripsi</label><textarea value={f.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} /></div>
              <div className="form-row">
                <div className="form-group"><label>Image URL</label><input value={f.image_url || ''} onChange={e => setForm(p => ({ ...p, image_url: e.target.value }))} placeholder="https://..." /></div>
                <div className="form-group"><label>Sort Order</label><input type="number" value={f.sort_order || 0} onChange={e => setForm(p => ({ ...p, sort_order: Number(e.target.value) }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Stok Total</label>
                  <input type="number" min={0} value={f.stock_total ?? ''} placeholder="kosong = unlimited"
                    onChange={e => setForm(p => ({ ...p, stock_total: e.target.value === '' ? null : Number(e.target.value) }))} />
                  {editId && (
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Sisa sekarang: {(data.find(d => d.id === editId)?.stock_remaining ?? null) === null ? '∞' : data.find(d => d.id === editId)?.stock_remaining}. Mengubah total menambah/mengurangi sisa sebesar selisihnya (restock).
                    </span>
                  )}
                </div>
                <div className="form-group" style={{ display: 'flex', alignItems: 'center' }}>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                    <input type="checkbox" checked={f.show_on_arena ?? true} onChange={e => setForm(p => ({ ...p, show_on_arena: e.target.checked }))} />
                    Tampil di booking Arena (non-kelas)
                  </label>
                </div>
              </div>

              <div className="form-group">
                <label>Eligibility Kelas <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(tak ada dipilih di kedua daftar = semua kelas)</span></label>
                <div style={{ maxHeight: 130, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                  {classTypes.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Tidak ada kelas aktif</span>
                  ) : classTypes.map(ct => (
                    <label key={ct.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13, padding: '3px 0' }}>
                      <input type="checkbox" checked={selectedCT.includes(ct.id)} onChange={() => toggleCT(ct.id)} />
                      {ct.name}
                    </label>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>Eligibility Jadwal Spesifik <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(untuk event spesifik — opsional)</span></label>
                <input value={schedQuery} onChange={e => setSchedQuery(e.target.value)} placeholder="Cari jadwal (tipe / tanggal)..." style={{ marginBottom: 6 }} />
                <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
                  {schedDisplay.length === 0 ? (
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{schedQuery ? 'Tak ada jadwal cocok' : 'Tak ada jadwal mendatang'}</span>
                  ) : schedDisplay.map(s => (
                    <label key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 13, padding: '3px 0' }}>
                      <input type="checkbox" checked={selectedSched.includes(s.id)} onChange={() => toggleSched(s.id)} />
                      {schedLabel(s)}
                    </label>
                  ))}
                </div>
                {selectedSched.length > 0 && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{selectedSched.length} jadwal dipilih</span>}
              </div>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, margin: '12px 0 16px' }}>
                <input type="checkbox" checked={f.is_active ?? true} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} /> Active
              </label>

              <div className="modal-section">
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700, marginBottom: 10 }}>
                  Pop-up upsell (booking.20fit.id)
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginBottom: 6 }}>
                  <input type="checkbox" checked={f.upsell_enabled ?? false} onChange={e => setForm(p => ({ ...p, upsell_enabled: e.target.checked }))} />
                  Tampilkan sebagai pop-up saat customer lanjut tanpa add-on
                </label>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 14px', lineHeight: 1.5 }}>
                  Hanya 1 pop-up yang tampil: add-on pertama (Sort Order terkecil) yang aktif, eligible untuk kelas yang dibooking, stoknya masih ada, dan pop-up-nya dicentang. Kolom kosong memakai data add-on di atas.
                </p>
                <div className="form-row">
                  <div className="form-group"><label>Judul pop-up</label><input value={f.upsell_title || ''} onChange={e => setForm(p => ({ ...p, upsell_title: e.target.value }))} placeholder="Kosong = pakai Nama add-on" /></div>
                  <div className="form-group"><label>Label / badge</label><input value={f.upsell_badge || ''} onChange={e => setForm(p => ({ ...p, upsell_badge: e.target.value }))} placeholder="mis. Hemat Rp 21.000" /></div>
                </div>
                <div className="form-group"><label>Teks pop-up</label><textarea value={f.upsell_body || ''} onChange={e => setForm(p => ({ ...p, upsell_body: e.target.value }))} rows={3} placeholder="Kosong = pakai Deskripsi" /></div>
                <div className="form-row">
                  <div className="form-group"><label>Gambar banner URL</label><input value={f.upsell_image_url || ''} onChange={e => setForm(p => ({ ...p, upsell_image_url: e.target.value }))} placeholder="Kosong = pakai Image URL" /></div>
                  <div className="form-group"><label>Teks tombol</label><input value={f.upsell_cta || ''} onChange={e => setForm(p => ({ ...p, upsell_cta: e.target.value }))} placeholder="Add to booking" /></div>
                </div>

                {/* Live preview of the customer pop-up (approximation of booking.20fit.id UpsellSheet). */}
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  Preview{f.upsell_enabled ? '' : ' (belum aktif — tidak tampil di booking)'}
                </div>
                <div style={{ maxWidth: 320, margin: '0 auto', border: '1px solid var(--border-strong)', borderRadius: 18, overflow: 'hidden', background: '#fff', color: '#111', fontFamily: 'var(--font-body)', opacity: f.upsell_enabled ? 1 : 0.6 }}>
                  {upImage && (
                    <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#F1F1EE' }}>
                      <img src={upImage} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                      {upBadge && <span style={{ position: 'absolute', left: 10, top: 10, background: '#D81F27', color: '#fff', borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700 }}>{upBadge}</span>}
                    </div>
                  )}
                  <div style={{ padding: '14px 16px 12px' }}>
                    {!upImage && upBadge && <span style={{ display: 'inline-flex', background: '#FDECEC', color: '#A81620', borderRadius: 999, padding: '4px 10px', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>{upBadge}</span>}
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#6B6B68' }}>Add to your booking</div>
                    <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.25, marginTop: 4, overflowWrap: 'anywhere' }}>{upTitle}</div>
                    {upBody && <p style={{ fontSize: 12.5, color: '#2E2E2C', lineHeight: 1.5, margin: '6px 0 0', display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{upBody}</p>}
                    <div style={{ fontSize: 18, fontWeight: 700, marginTop: 10 }}>{fmtRp(f.price)}</div>
                    <div style={{ marginTop: 12, background: '#D81F27', color: '#fff', borderRadius: 999, padding: '10px 14px', textAlign: 'center', fontSize: 13, fontWeight: 700 }}>{upCta}</div>
                    <div style={{ paddingTop: 8, textAlign: 'center', fontSize: 12, fontWeight: 600, color: '#6B6B68' }}>No thanks, continue</div>
                  </div>
                </div>
              </div>

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
