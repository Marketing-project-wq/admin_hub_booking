import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { fmtRp } from '../../../lib/format'

// Add-on catalog (arena_addons). Equipment/service add-ons bought during class/arena booking.
// F1 adds: global stock (stock_total capacity + stock_remaining live; NULL = unlimited),
// class-type eligibility (arena_addon_class_types; empty = all classes), and a show_on_arena
// flag for the BK- arena (non-class) flow. Stock is decremented at payment-confirm by the
// webhook (F2), not here — admin only sets capacity and sees remaining/used.

interface Addon {
  id: string; name: string; description: string; price: number; image_url: string | null
  is_active: boolean; sort_order: number
  stock_total: number | null; stock_remaining: number | null; show_on_arena: boolean
}
interface ClassType { id: string; name: string }

const emptyForm = (): Partial<Addon> => ({
  name: '', description: '', price: 0, image_url: '', is_active: true, sort_order: 0,
  stock_total: null, show_on_arena: true,
})

export default function ArenaAddons() {
  const [data, setData] = useState<Addon[]>([])
  const [classTypes, setClassTypes] = useState<ClassType[]>([])
  const [eligMap, setEligMap] = useState<Record<string, string[]>>({}) // addon_id -> class_type_id[]
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Addon>>(emptyForm())
  const [selectedCT, setSelectedCT] = useState<string[]>([])
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase.from('arena_addons').select('*').order('sort_order')
    if (err) setError(err.message)
    else { setData(rows as Addon[]); setError('') }
    // Eligibility + class-type options are best-effort: if the join table / columns aren't
    // provisioned yet (pre-F1-migration), the catalog list still renders.
    const { data: elig } = await supabase.from('arena_addon_class_types').select('addon_id, class_type_id')
    if (elig) {
      const m: Record<string, string[]> = {}
      for (const r of elig as { addon_id: string; class_type_id: string }[]) (m[r.addon_id] ??= []).push(r.class_type_id)
      setEligMap(m)
    }
    const { data: cts } = await supabase.from('arena_class_types').select('id, name').eq('is_active', true).order('name')
    if (cts) setClassTypes(cts as ClassType[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setSelectedCT([]); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (a: Addon) => {
    setForm({ ...a, stock_total: a.stock_total ?? null })
    setSelectedCT(eligMap[a.id] ?? [])
    setEditId(a.id); setFormError(''); setShowModal(true)
  }

  const toggleCT = (id: string) =>
    setSelectedCT(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return setFormError('Nama wajib diisi')
    setSaving(true)

    // stock_total: null = unlimited. Derive stock_remaining:
    //  - create:            remaining = total
    //  - edit, now unlimited: remaining = null
    //  - edit, was unlimited: remaining = total (start full)
    //  - edit, capacity changed: shift remaining by the delta (restock), floored at 0
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

    // Eligibility diff against the stored mapping (empty selection = all classes).
    const existing = (addonId && eligMap[addonId]) || []
    const toAdd = selectedCT.filter(ct => !existing.includes(ct))
    const toDel = existing.filter(ct => !selectedCT.includes(ct))
    if (addonId && toAdd.length) {
      const { error: addErr } = await supabase.from('arena_addon_class_types')
        .insert(toAdd.map(ct => ({ addon_id: addonId, class_type_id: ct })))
      if (addErr) { setSaving(false); setFormError(addErr.message); return }
    }
    if (addonId && toDel.length) {
      const { error: delErr } = await supabase.from('arena_addon_class_types')
        .delete().eq('addon_id', addonId).in('class_type_id', toDel)
      if (delErr) { setSaving(false); setFormError(delErr.message); return }
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
    const n = (eligMap[a.id] ?? []).length
    return n === 0 ? 'Semua' : `${n} kelas`
  }

  const f = form
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
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>{fmtRp(a.price)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{stockLabel(a)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{eligLabel(a)}</td>
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
                      Sisa sekarang: {(data.find(d => d.id === editId)?.stock_remaining ?? null) === null ? '∞' : data.find(d => d.id === editId)?.stock_remaining}. Mengubah total akan menambah/mengurangi sisa sebesar selisihnya (restock).
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
                <label>Eligibility Kelas <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(tak ada dipilih = semua kelas)</span></label>
                <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px' }}>
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

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, margin: '12px 0 16px' }}>
                <input type="checkbox" checked={f.is_active ?? true} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} /> Active
              </label>
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
