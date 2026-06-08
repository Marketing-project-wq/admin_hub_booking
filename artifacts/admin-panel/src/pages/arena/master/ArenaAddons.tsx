import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmtRp } from '../../../lib/format'

interface Addon { id: string; name: string; description: string; price: number; image_url: string | null; is_active: boolean; sort_order: number }
const emptyForm = (): Partial<Addon> => ({ name: '', description: '', price: 0, image_url: '', is_active: true, sort_order: 0 })

export default function ArenaAddons() {
  const [data, setData] = useState<Addon[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Addon>>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase.from('arena_addons').select('*').order('sort_order')
    if (err) setError(err.message)
    else setData(rows as Addon[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (a: Addon) => { setForm({ ...a }); setEditId(a.id); setFormError(''); setShowModal(true) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return setFormError('Nama wajib diisi')
    setSaving(true)
    const payload = { name: form.name, description: form.description, price: form.price || 0, image_url: form.image_url || null, is_active: form.is_active ?? true, sort_order: form.sort_order || 0 }
    const { error: err } = editId
      ? await supabase.from('arena_addons').update(payload).eq('id', editId)
      : await supabase.from('arena_addons').insert({ ...payload, created_at: new Date().toISOString() })
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false); fetchData()
  }

  const toggleActive = async (a: Addon) => {
    await supabase.from('arena_addons').update({ is_active: !a.is_active }).eq('id', a.id)
    fetchData()
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
          <thead><tr><th>Nama</th><th>Harga</th><th>Sort Order</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            {loading ? <tr className="loading-row"><td colSpan={5}>Memuat...</td></tr>
              : data.length === 0 ? <tr><td colSpan={5} className="empty-state">Tidak ada add-on</td></tr>
              : data.map(a => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.name}</td>
                  <td>{fmtRp(a.price)}</td>
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
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
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
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginBottom: 16 }}>
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
