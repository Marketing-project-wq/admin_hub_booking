import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { X } from 'lucide-react'
import { fmtRp } from '../../lib/format'
import {
  listServicesFull, createService, updateService, toggleServiceActive,
  type ClinicServiceFull, type ServicePayload,
} from '../../lib/clinic'

// RECOVERY CENTER — Layanan. Kelola layanan yang muncul di halaman
// booking.20fit.id/recoverycenter. Data = clinic_services dengan
// service_group='Recovery Center' (isolasi per unit); grup & kategori
// dikunci ke Recovery Center / recovery supaya admin recovery tidak
// menyentuh layanan Clinic.
const SERVICE_GROUP = 'Recovery Center'
const CATEGORY = 'recovery'

const emptyForm = (): ServicePayload => ({
  code: '', name: '', description: '', price: 0, duration_minutes: null,
  category: CATEGORY, service_group: SERVICE_GROUP,
  is_online_bookable: true, is_active: true, sort_order: null,
})

export default function RecoveryServices() {
  const [data, setData] = useState<ClinicServiceFull[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ServicePayload>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const all = await listServicesFull(false)
      // Hanya layanan Recovery Center.
      setData(all.filter(s => s.service_group === SERVICE_GROUP))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data layanan')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const sorted = useMemo(
    () => [...data].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name)),
    [data],
  )

  const set = <K extends keyof ServicePayload>(key: K, val: ServicePayload[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (s: ClinicServiceFull) => {
    setForm({
      code: s.code, name: s.name, description: s.description ?? '', price: s.price,
      duration_minutes: s.duration_minutes, category: s.category ?? CATEGORY, service_group: SERVICE_GROUP,
      is_online_bookable: s.is_online_bookable, is_active: s.is_active, sort_order: s.sort_order,
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
      // Kunci grup & kategori ke Recovery Center — admin recovery tidak boleh
      // membuat layanan di grup lain.
      category: CATEGORY,
      service_group: SERVICE_GROUP,
      is_online_bookable: form.is_online_bookable,
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
        <h2 className="page-title">Layanan Recovery Center</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Layanan</button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Layanan &amp; harga yang tampil di halaman booking.20fit.id/recoverycenter. Kolom <b>Tampil di Booking</b> mengatur apakah layanan muncul untuk dibeli online.
      </p>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Urutan</th><th>Kode</th><th>Nama</th><th>Durasi</th>
              <th>Harga</th><th>Tampil di Booking</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">Belum ada layanan</td></tr>
            ) : sorted.map(s => (
              <tr key={s.id}>
                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{s.sort_order ?? '-'}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{s.code}</td>
                <td style={{ fontWeight: 500 }}>{s.name}</td>
                <td>{s.duration_minutes != null ? `${s.duration_minutes} mnt` : '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(s.price)}</td>
                <td>
                  <span className="badge" style={s.is_online_bookable
                    ? { background: '#EFF6FF', color: '#1D4ED8' }
                    : { background: '#F3F4F6', color: '#6B7280' }}>
                    {s.is_online_bookable ? 'Ya' : 'Tidak'}
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
        // Tanpa onClick di overlay: klik tak sengaja di backdrop tak boleh membuang input.
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Layanan' : 'Tambah Layanan'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}

            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group">
                  <label>Kode *</label>
                  <input type="text" value={form.code} onChange={e => set('code', e.target.value)} placeholder="mis. RC-SM45" required />
                </div>
                <div className="form-group">
                  <label>Nama *</label>
                  <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder='mis. Sport Massage 45"' required />
                </div>
              </div>
              <div className="form-group">
                <label>Deskripsi</label>
                <textarea value={form.description ?? ''} onChange={e => set('description', e.target.value)} rows={2} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Harga Tayang (Rp) *</label>
                  <input type="number" min={0} value={form.price} onChange={e => set('price', Math.max(0, Number(e.target.value)))} required />
                </div>
                <div className="form-group">
                  <label>Durasi (menit)</label>
                  <input type="number" min={0} value={form.duration_minutes ?? ''} onChange={e => set('duration_minutes', e.target.value === '' ? null : Number(e.target.value))} placeholder="mis. 45" />
                </div>
              </div>
              <div className="form-group">
                <label>Urutan tampil (sort order)</label>
                <input type="number" value={form.sort_order ?? ''} onChange={e => set('sort_order', e.target.value === '' ? null : Number(e.target.value))} placeholder="mis. 8" />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_online_bookable} onChange={e => set('is_online_bookable', e.target.checked)} style={{ width: 'auto' }} />
                    Tampil di halaman booking
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
