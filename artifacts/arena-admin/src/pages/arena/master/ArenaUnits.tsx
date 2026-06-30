import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@workspace/admin-shared'
import { fmtRp } from '@workspace/admin-shared'

interface Unit {
  id: string; name: string; unit_type: string; description: string;
  capacity: number; slot_duration: number; price_member: number; price_guest: number;
  cutoff_minutes: number; is_active: boolean;
}
const emptyForm = (): Partial<Unit> => ({
  name: '', unit_type: '', description: '', capacity: 1, slot_duration: 60,
  price_member: 0, price_guest: 0, cutoff_minutes: 60, is_active: true,
})

export default function ArenaUnits() {
  const [data, setData] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Unit>>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase.from('arena_booking_units').select('*').order('name')
    if (err) setError(err.message)
    else setData(rows as Unit[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (u: Unit) => { setForm({ ...u }); setEditId(u.id); setFormError(''); setShowModal(true) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.name) return setFormError('Nama wajib diisi')
    setSaving(true)
    const payload = {
      name: form.name, unit_type: form.unit_type, description: form.description,
      capacity: form.capacity, slot_duration: form.slot_duration,
      price_member: form.price_member, price_guest: form.price_guest,
      cutoff_minutes: form.cutoff_minutes ?? 60,
      is_active: form.is_active ?? true, updated_at: new Date().toISOString(),
    }
    const { error: err } = editId
      ? await supabase.from('arena_booking_units').update(payload).eq('id', editId)
      : await supabase.from('arena_booking_units').insert({ ...payload, created_at: new Date().toISOString() })
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false); fetchData()
  }

  const toggleActive = async (u: Unit) => {
    await supabase.from('arena_booking_units').update({ is_active: !u.is_active, updated_at: new Date().toISOString() }).eq('id', u.id)
    fetchData()
  }

  const f = form
  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Arena Units</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Unit</button>
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Name</th><th>Type</th><th>Capacity</th><th>Slot Duration</th>
              <th>Cut-off</th><th>Harga Member</th><th>Harga Guest</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr className="loading-row"><td colSpan={9}>Memuat...</td></tr>
              : data.length === 0 ? <tr><td colSpan={9} className="empty-state">Tidak ada data</td></tr>
              : data.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.name}</td>
                  <td>{u.unit_type}</td>
                  <td style={{ textAlign: 'center' }}>{u.capacity}</td>
                  <td style={{ textAlign: 'center' }}>{u.slot_duration} mnt</td>
                  <td style={{ textAlign: 'center' }}>{u.cutoff_minutes ?? 60} mnt</td>
                  <td>{fmtRp(u.price_member)}</td>
                  <td>{fmtRp(u.price_guest)}</td>
                  <td><span className={`badge ${u.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => openEdit(u)}>Edit</button>
                    <button className="action-btn" onClick={() => toggleActive(u)}>{u.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
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
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Unit' : 'Tambah Unit'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group"><label>Nama *</label><input value={f.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required /></div>
                <div className="form-group"><label>Tipe Unit</label><input value={f.unit_type || ''} onChange={e => setForm(p => ({ ...p, unit_type: e.target.value }))} /></div>
              </div>
              <div className="form-group"><label>Deskripsi</label><textarea value={f.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} /></div>
              <div className="form-row">
                <div className="form-group"><label>Kapasitas</label><input type="number" min={1} value={f.capacity || 1} onChange={e => setForm(p => ({ ...p, capacity: Number(e.target.value) }))} /></div>
                <div className="form-group"><label>Slot Duration (mnt)</label><input type="number" min={1} value={f.slot_duration || 60} onChange={e => setForm(p => ({ ...p, slot_duration: Number(e.target.value) }))} /></div>
              </div>
              <div className="form-row">
                <div className="form-group"><label>Harga Member (Rp)</label><input type="number" min={0} value={f.price_member || 0} onChange={e => setForm(p => ({ ...p, price_member: Number(e.target.value) }))} /></div>
                <div className="form-group"><label>Harga Guest (Rp)</label><input type="number" min={0} value={f.price_guest || 0} onChange={e => setForm(p => ({ ...p, price_guest: Number(e.target.value) }))} /></div>
              </div>
              <div className="form-group">
                <label>Cut-off Booking (menit)</label>
                <input
                  type="number" min={0} max={1440}
                  value={f.cutoff_minutes ?? 60}
                  onChange={e => setForm(p => ({ ...p, cutoff_minutes: Number(e.target.value) }))}
                />
                <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4, display: 'block' }}>
                  Berapa menit sebelum kelas dimulai, booking ditutup. Default: 60 menit (1 jam).
                </small>
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
