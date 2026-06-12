import React, { useState, useEffect, useCallback } from 'react'
import {
  listStaff, createStaff, updateStaff, toggleStaffActive,
  type ClinicStaff, type StaffPayload,
} from '../../lib/clinic'

const ROLE_OPTIONS = ['dokter', 'fisioterapis', 'terapis', 'admin']
const ROLE_LABEL: Record<string, string> = {
  dokter: 'Dokter', fisioterapis: 'Fisioterapis', terapis: 'Terapis', admin: 'Admin',
}

const emptyForm = (): StaffPayload => ({ name: '', role: 'dokter', photo_url: '', is_active: true })

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join('') || '?'

export default function ClinicStaff() {
  const [data, setData] = useState<ClinicStaff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<StaffPayload>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listStaff(false))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data staff')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const set = <K extends keyof StaffPayload>(key: K, val: StaffPayload[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (s: ClinicStaff) => {
    setForm({ name: s.name, role: s.role ?? 'dokter', photo_url: s.photo_url ?? '', is_active: s.is_active })
    setEditId(s.id); setFormError(''); setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setFormError('Nama wajib diisi'); return }
    setSaving(true); setFormError('')
    const payload: StaffPayload = {
      name: form.name.trim(),
      role: form.role || null,
      photo_url: form.photo_url?.trim() || null,
      is_active: form.is_active,
    }
    try {
      if (editId) await updateStaff(editId, payload)
      else await createStaff(payload)
      setShowModal(false); fetchData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan staff')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (s: ClinicStaff) => {
    try {
      await toggleStaffActive(s.id, !s.is_active)
      fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status')
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Staff Clinic</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Staff</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr><th style={{ width: 56 }}>Foto</th><th>Nama</th><th>Peran</th><th>Status</th><th>Aksi</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={5}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={5} className="empty-state">Belum ada staff</td></tr>
            ) : data.map(s => (
              <tr key={s.id}>
                <td>
                  {s.photo_url ? (
                    <img src={s.photo_url} alt={s.name}
                      style={{ width: 36, height: 36, borderRadius: '50%', objectFit: 'cover' }} />
                  ) : (
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%', background: 'var(--border, #E5E7EB)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 13, fontWeight: 600, color: 'var(--text-muted)',
                    }}>{initials(s.name)}</div>
                  )}
                </td>
                <td style={{ fontWeight: 500 }}>{s.name}</td>
                <td>{s.role ? (ROLE_LABEL[s.role] || s.role) : '-'}</td>
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
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Staff' : 'Tambah Staff'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>

            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Nama *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} required />
              </div>
              <div className="form-group">
                <label>Peran</label>
                <select value={form.role ?? ''} onChange={e => set('role', e.target.value)}>
                  {ROLE_OPTIONS.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>URL Foto</label>
                <input type="text" value={form.photo_url ?? ''} onChange={e => set('photo_url', e.target.value)} placeholder="https://..." />
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} style={{ width: 'auto' }} />
                  Aktif
                </label>
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
