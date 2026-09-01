import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '@workspace/admin-shared'
import { fmtRp } from '@workspace/admin-shared'

interface Plan {
  id: string; name: string; duration_months: number; price: number;
  description: string | null; sort_order: number; is_active: boolean
}

const emptyForm = (): Partial<Plan> => ({
  name: '', duration_months: 1, price: 0, description: '', sort_order: 0, is_active: true,
})

export default function GymMembershipPlans() {
  const [data, setData] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Plan>>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase
      .from('gym_membership_plans')
      .select('id, name, duration_months, price, description, sort_order, is_active')
      .order('sort_order', { ascending: true })
      .order('duration_months', { ascending: true })
    if (err) setError(err.message)
    else setData(rows as Plan[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (p: Plan) => { setForm({ ...p }); setEditId(p.id); setFormError(''); setShowModal(true) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return setFormError('Nama wajib diisi')
    setSaving(true)
    const payload = {
      name: form.name,
      duration_months: Number(form.duration_months) || 1,
      price: Number(form.price) || 0,
      description: form.description || null,
      sort_order: Number(form.sort_order) || 0,
      is_active: form.is_active ?? true,
    }
    const { error: err } = editId
      ? await supabase.from('gym_membership_plans').update(payload).eq('id', editId)
      : await supabase.from('gym_membership_plans').insert(payload)
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false); fetchData()
  }

  const toggleActive = async (p: Plan) => {
    await supabase.from('gym_membership_plans').update({ is_active: !p.is_active }).eq('id', p.id)
    fetchData()
  }

  const f = form
  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Membership Plans</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Plan</button>
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Nama</th><th>Durasi</th><th>Harga</th><th>Urutan</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            {loading ? <tr className="loading-row"><td colSpan={6}>Memuat...</td></tr>
              : data.length === 0 ? <tr><td colSpan={6} className="empty-state">Tidak ada plan</td></tr>
              : data.map(p => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600 }}>{p.name}</td>
                  <td>{p.duration_months} bln</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(p.price)}</td>
                  <td style={{ textAlign: 'center' }}>{p.sort_order}</td>
                  <td><span className={`badge ${p.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>{p.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => openEdit(p)}>Edit</button>
                    <button className="action-btn" onClick={() => toggleActive(p)}>{p.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
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
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Plan' : 'Tambah Plan'}</h3>
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
                  <label>Durasi (bulan)</label>
                  <input type="number" min={1} value={f.duration_months ?? 1} onChange={e => setForm(p => ({ ...p, duration_months: Number(e.target.value) }))} />
                </div>
                <div className="form-group">
                  <label>Harga (Rp)</label>
                  <input type="number" min={0} value={f.price ?? 0} onChange={e => setForm(p => ({ ...p, price: Number(e.target.value) }))} />
                </div>
                <div className="form-group">
                  <label>Urutan</label>
                  <input type="number" value={f.sort_order ?? 0} onChange={e => setForm(p => ({ ...p, sort_order: Number(e.target.value) }))} />
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
