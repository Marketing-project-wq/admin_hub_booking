import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmtRp } from '../../../lib/format'

interface ClassType {
  id: string; name: string; description: string; price_guest: number; price_member: number;
  duration_min: number; color: string; is_active: boolean;
}

const emptyForm = (): Partial<ClassType> => ({
  name: '', description: '', price_guest: 0, price_member: 0,
  duration_min: 60, color: '#B94A3E', is_active: true,
})

export default function ArenaClassTypes() {
  const [data, setData] = useState<ClassType[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<ClassType>>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase
      .from('arena_class_types')
      .select('id, name, description, price_guest, price_member, duration_min, color, is_active')
      .order('name')
    if (err) setError(err.message)
    else setData(rows as ClassType[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (ct: ClassType) => { setForm({ ...ct }); setEditId(ct.id); setFormError(''); setShowModal(true) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return setFormError('Nama wajib diisi')
    setSaving(true)
    const payload = {
      name: form.name,
      description: form.description,
      price_guest: form.price_guest || 0,
      price_member: form.price_member || 0,
      duration_min: Number(form.duration_min) || 60,
      color: form.color || '#B94A3E',
      is_active: form.is_active ?? true,
      updated_at: new Date().toISOString(),
    }
    const { error: err } = editId
      ? await supabase.from('arena_class_types').update(payload).eq('id', editId)
      : await supabase.from('arena_class_types').insert({ ...payload, created_at: new Date().toISOString() })
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false); fetchData()
  }

  const toggleActive = async (ct: ClassType) => {
    await supabase.from('arena_class_types').update({ is_active: !ct.is_active, updated_at: new Date().toISOString() }).eq('id', ct.id)
    fetchData()
  }

  const f = form

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Class Types</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Class Type</button>
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th><th>Durasi</th><th>Harga Guest</th><th>Harga Member</th>
              <th>Color</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr className="loading-row"><td colSpan={7}>Memuat...</td></tr>
              : data.length === 0 ? <tr><td colSpan={7} className="empty-state">Tidak ada data</td></tr>
              : data.map(ct => (
                <tr key={ct.id}>
                  <td style={{ fontWeight: 600 }}>
                    <span style={{ color: ct.color, marginRight: 6 }}>●</span>
                    {ct.name}
                  </td>
                  <td>{ct.duration_min} mnt</td>
                  <td>{fmtRp(ct.price_guest)}</td>
                  <td>{fmtRp(ct.price_member)}</td>
                  <td>
                    <span style={{ display: 'inline-block', width: 20, height: 20, background: ct.color, borderRadius: 3, border: '1px solid var(--border)', verticalAlign: 'middle' }} />
                    <span style={{ marginLeft: 6, fontSize: 11, color: 'var(--text-muted)' }}>{ct.color}</span>
                  </td>
                  <td><span className={`badge ${ct.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>{ct.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => openEdit(ct)}>Edit</button>
                    <button className="action-btn" onClick={() => toggleActive(ct)}>{ct.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
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
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Class Type' : 'Tambah Class Type'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Nama *</label>
                <input value={f.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label>Deskripsi</label>
                <textarea value={f.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Harga Guest (Rp)</label>
                  <input type="number" min={0} value={f.price_guest || 0} onChange={e => setForm(p => ({ ...p, price_guest: Number(e.target.value) }))} />
                </div>
                <div className="form-group">
                  <label>Harga Member (Rp)</label>
                  <input type="number" min={0} value={f.price_member || 0} onChange={e => setForm(p => ({ ...p, price_member: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Durasi (mnt)</label>
                  <input type="number" min={1} value={f.duration_min || 60} onChange={e => setForm(p => ({ ...p, duration_min: Number(e.target.value) }))} />
                </div>
                <div className="form-group">
                  <label>Color (#hex)</label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="color" value={f.color || '#B94A3E'} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} style={{ width: 48, height: 38, padding: 2, cursor: 'pointer' }} />
                    <input type="text" value={f.color || '#B94A3E'} onChange={e => setForm(p => ({ ...p, color: e.target.value }))} style={{ flex: 1 }} placeholder="#B94A3E" />
                  </div>
                </div>
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
