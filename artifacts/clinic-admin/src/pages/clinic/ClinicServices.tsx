import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { fmtRp } from '@workspace/admin-shared'
import {
  listServicesFull, createService, updateService, toggleServiceActive,
  type ClinicServiceFull, type ServicePayload,
} from '../../lib/clinic'

const emptyForm = (): ServicePayload => ({
  code: '', name: '', description: '', price: 0, duration_minutes: null,
  category: '', service_group: '', visible_app: true, visible_web: true, is_active: true, sort_order: null,
})

export default function ClinicServices() {
  const [data, setData] = useState<ClinicServiceFull[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active'>('all')

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ServicePayload>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listServicesFull(false))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data layanan')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const categories = useMemo(
    () => [...new Set(data.map(s => s.category).filter(Boolean))] as string[],
    [data],
  )

  const filtered = useMemo(() => data.filter(s => {
    if (activeFilter === 'active' && !s.is_active) return false
    if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
    return true
  }), [data, activeFilter, categoryFilter])

  const set = <K extends keyof ServicePayload>(key: K, val: ServicePayload[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (s: ClinicServiceFull) => {
    setForm({
      code: s.code, name: s.name, description: s.description ?? '', price: s.price,
      duration_minutes: s.duration_minutes, category: s.category ?? '', service_group: s.service_group ?? '',
      visible_app: s.visible_app, visible_web: s.visible_web, is_active: s.is_active, sort_order: s.sort_order,
    })
    setEditId(s.id); setFormError(''); setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.code.trim()) { setFormError('Kode wajib diisi'); return }
    if (!form.name.trim()) { setFormError('Nama wajib diisi'); return }
    setSaving(true); setFormError('')
    const payload: ServicePayload = {
      code: form.code.trim(),
      name: form.name.trim(),
      description: form.description?.trim() || null,
      price: Number(form.price) || 0,
      duration_minutes: form.duration_minutes != null && String(form.duration_minutes) !== '' ? Number(form.duration_minutes) : null,
      category: form.category?.trim() || null,
      service_group: form.service_group?.trim() || null,
      visible_app: form.visible_app,
      visible_web: form.visible_web,
      is_active: form.is_active,
      sort_order: form.sort_order != null && String(form.sort_order) !== '' ? Number(form.sort_order) : null,
    }
    try {
      if (editId) await updateService(editId, payload)
      else await createService(payload)
      setShowModal(false); fetchData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan layanan')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (s: ClinicServiceFull) => {
    try {
      await toggleServiceActive(s.id, !s.is_active)
      fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status')
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Layanan Clinic</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Layanan</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}>
          <option value="all">Semua Kategori</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={activeFilter} onChange={e => setActiveFilter(e.target.value as 'all' | 'active')}>
          <option value="all">Semua Status</option>
          <option value="active">Hanya Aktif</option>
        </select>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kode</th><th>Nama</th><th>Kategori</th><th>Grup</th><th>Durasi</th>
              <th>Harga</th><th>App</th><th>Web</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={10}>Memuat data...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={10} className="empty-state">Tidak ada layanan</td></tr>
            ) : filtered.map(s => (
              <tr key={s.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.code}</td>
                <td style={{ fontWeight: 500 }}>{s.name}</td>
                <td>{s.category || '-'}</td>
                <td>{s.service_group || '-'}</td>
                <td>{s.duration_minutes != null ? `${s.duration_minutes} mnt` : '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(s.price)}</td>
                <td>
                  <span className="badge" style={s.visible_app
                    ? { background: '#EFF6FF', color: '#1D4ED8' }
                    : { background: '#F3F4F6', color: '#6B7280' }}>
                    {s.visible_app ? 'Ya' : 'Tidak'}
                  </span>
                </td>
                <td>
                  <span className="badge" style={s.visible_web
                    ? { background: '#EFF6FF', color: '#1D4ED8' }
                    : { background: '#F3F4F6', color: '#6B7280' }}>
                    {s.visible_web ? 'Ya' : 'Tidak'}
                  </span>
                </td>
                <td>
                  <span className={`badge ${s.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {s.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => openEdit(s)}>Edit</button>
                  <button className={`action-btn ${s.is_active ? 'cancel' : 'confirm'}`} onClick={() => handleToggle(s)}>
                    {s.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        // No onClick here: an accidental click on the backdrop must not discard
        // unsaved service edit input. Closing goes through the X/Tutup buttons only.
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Layanan' : 'Tambah Layanan'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>

            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}

            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group">
                  <label>Kode *</label>
                  <input type="text" value={form.code} onChange={e => set('code', e.target.value)} required disabled={!!editId} />
                  {editId && <small style={{ color: 'var(--text-muted)', fontSize: 11 }}>Kode tidak bisa diubah (dipakai voucher & booking)</small>}
                </div>
                <div className="form-group">
                  <label>Nama *</label>
                  <input type="text" value={form.name} onChange={e => set('name', e.target.value)} required />
                </div>
              </div>
              <div className="form-group">
                <label>Deskripsi</label>
                <textarea value={form.description ?? ''} onChange={e => set('description', e.target.value)} rows={2} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Harga (Rp) *</label>
                  <input type="number" min={0} value={form.price} onChange={e => set('price', Math.max(0, Number(e.target.value)))} required />
                </div>
                <div className="form-group">
                  <label>Durasi (menit)</label>
                  <input type="number" min={0} value={form.duration_minutes ?? ''} onChange={e => set('duration_minutes', e.target.value === '' ? null : Number(e.target.value))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Kategori</label>
                  <input type="text" value={form.category ?? ''} onChange={e => set('category', e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Grup Layanan</label>
                  <input type="text" value={form.service_group ?? ''} onChange={e => set('service_group', e.target.value)} />
                </div>
              </div>
              <div className="form-group">
                <label>Urutan (sort order)</label>
                <input type="number" value={form.sort_order ?? ''} onChange={e => set('sort_order', e.target.value === '' ? null : Number(e.target.value))} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.visible_app} onChange={e => set('visible_app', e.target.checked)} style={{ width: 'auto' }} />
                    Tampil di App
                  </label>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.visible_web} onChange={e => set('visible_web', e.target.checked)} style={{ width: 'auto' }} />
                    Tampil di Web
                  </label>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} style={{ width: 'auto' }} />
                    Aktif
                  </label>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
