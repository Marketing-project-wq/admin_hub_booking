import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

interface Coach { id: string; name: string; photo_url: string | null; speciality: string; bio: string; is_active: boolean }
const emptyForm = (): Partial<Coach> => ({ name: '', photo_url: '', speciality: '', bio: '', is_active: true })

export default function ArenaCoaches() {
  const [data, setData] = useState<Coach[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Coach>>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [specFilter, setSpecFilter] = useState('all')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase.from('arena_coaches').select('*').order('name')
    if (err) setError(err.message)
    else setData(rows as Coach[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (c: Coach) => { setForm({ ...c }); setEditId(c.id); setFormError(''); setShowModal(true) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) return setFormError('Nama wajib diisi')
    setSaving(true)
    const payload = { name: form.name, photo_url: form.photo_url || null, speciality: form.speciality, bio: form.bio, is_active: form.is_active ?? true }
    const { error: err } = editId
      ? await supabase.from('arena_coaches').update(payload).eq('id', editId)
      : await supabase.from('arena_coaches').insert({ ...payload, created_at: new Date().toISOString() })
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false); fetchData()
  }

  const toggleActive = async (c: Coach) => {
    await supabase.from('arena_coaches').update({ is_active: !c.is_active }).eq('id', c.id)
    fetchData()
  }

  // Distinct specialities present in the data → drives the optional Spesialisasi dropdown.
  const specialities = Array.from(
    new Set(data.map(c => (c.speciality || '').trim()).filter(Boolean)),
  ).sort((a, b) => a.localeCompare(b))

  // Client-side filter over ALL loaded coaches (this page fetches every row, no pagination),
  // so search/filter always spans the full dataset. Name match is case-insensitive & partial.
  const s = search.trim().toLowerCase()
  const displayData = data.filter(c => {
    if (s && !c.name.toLowerCase().includes(s)) return false
    if (statusFilter === 'active' && !c.is_active) return false
    if (statusFilter === 'inactive' && c.is_active) return false
    if (specFilter !== 'all' && (c.speciality || '').trim() !== specFilter) return false
    return true
  })
  const hasFilter = !!s || statusFilter !== 'all' || specFilter !== 'all'

  const f = form
  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Coaches</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Coach</button>
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari nama coach..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}>
          <option value="all">Semua Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        {specialities.length > 0 && (
          <select value={specFilter} onChange={e => setSpecFilter(e.target.value)}>
            <option value="all">Semua Spesialisasi</option>
            {specialities.map(sp => <option key={sp} value={sp}>{sp}</option>)}
          </select>
        )}
        {hasFilter && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setStatusFilter('all'); setSpecFilter('all') }}
          >
            Reset
          </button>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {displayData.length} coach
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Nama</th><th>Spesialisasi</th><th>Status</th><th>Aksi</th></tr></thead>
          <tbody>
            {loading ? <tr className="loading-row"><td colSpan={4}>Memuat...</td></tr>
              : displayData.length === 0 ? <tr><td colSpan={4} className="empty-state">{hasFilter ? 'Coach tidak ditemukan' : 'Tidak ada coach'}</td></tr>
              : displayData.map(c => (
                <tr key={c.id}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{c.speciality}</td>
                  <td><span className={`badge ${c.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>{c.is_active ? 'Active' : 'Inactive'}</span></td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="action-btn detail" onClick={() => openEdit(c)}>Edit</button>
                    <button className="action-btn" onClick={() => toggleActive(c)}>{c.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
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
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Coach' : 'Tambah Coach'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group"><label>Nama *</label><input value={f.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required /></div>
                <div className="form-group"><label>Spesialisasi</label><input value={f.speciality || ''} onChange={e => setForm(p => ({ ...p, speciality: e.target.value }))} /></div>
              </div>
              <div className="form-group"><label>Photo URL</label><input type="url" value={f.photo_url || ''} onChange={e => setForm(p => ({ ...p, photo_url: e.target.value }))} placeholder="https://..." /></div>
              <div className="form-group"><label>Bio</label><textarea value={f.bio || ''} onChange={e => setForm(p => ({ ...p, bio: e.target.value }))} rows={3} /></div>
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
