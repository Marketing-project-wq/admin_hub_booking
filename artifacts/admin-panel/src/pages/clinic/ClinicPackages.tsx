import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { X } from 'lucide-react'
import { fmtRp } from '../../lib/format'
import {
  listPackagesAll, createPackage, updatePackage, togglePackageActive,
  type ClinicPackage, type ClinicPackagePayload,
} from '../../lib/clinic'

const emptyForm = (): ClinicPackagePayload => ({
  name: '', category: '', sessions: 1, price_per_session: 0,
  package_price: 0, retail_price: 0, discount_percent: 0,
  requires_referral: false, is_active: true,
})

// Diskon dihitung otomatis dari harga retail vs harga paket.
const calcDiscount = (retail: number, pkg: number): number =>
  retail > 0 ? Math.round(((retail - pkg) / retail) * 100) : 0

export default function ClinicPackages() {
  const [data, setData] = useState<ClinicPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [categoryFilter, setCategoryFilter] = useState('all')
  const [activeFilter, setActiveFilter] = useState<'all' | 'active'>('all')

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<ClinicPackagePayload>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      setData(await listPackagesAll())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data paket')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const categories = useMemo(
    () => [...new Set(data.map(p => p.category).filter(Boolean))] as string[],
    [data],
  )

  const filtered = useMemo(() => data.filter(p => {
    if (activeFilter === 'active' && !p.is_active) return false
    if (categoryFilter !== 'all' && p.category !== categoryFilter) return false
    return true
  }), [data, activeFilter, categoryFilter])

  const set = <K extends keyof ClinicPackagePayload>(key: K, val: ClinicPackagePayload[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  // Update harga paket + hitung ulang diskon otomatis.
  const setPackagePrice = (val: number) =>
    setForm(prev => ({ ...prev, package_price: val, discount_percent: calcDiscount(prev.retail_price, val) }))
  const setRetailPrice = (val: number) =>
    setForm(prev => ({ ...prev, retail_price: val, discount_percent: calcDiscount(val, prev.package_price) }))

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (p: ClinicPackage) => {
    setForm({
      name: p.name, category: p.category, sessions: p.sessions,
      price_per_session: p.price_per_session, package_price: p.package_price,
      retail_price: p.retail_price, discount_percent: p.discount_percent,
      requires_referral: p.requires_referral, is_active: p.is_active,
    })
    setEditId(p.id); setFormError(''); setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) { setFormError('Nama paket wajib diisi'); return }
    if (!form.category.trim()) { setFormError('Kategori wajib diisi'); return }
    if (Number(form.sessions) < 1) { setFormError('Jumlah visit minimal 1'); return }
    setSaving(true); setFormError('')
    const payload: ClinicPackagePayload = {
      name: form.name.trim(),
      category: form.category.trim(),
      sessions: Number(form.sessions) || 1,
      price_per_session: Number(form.price_per_session) || 0,
      package_price: Number(form.package_price) || 0,
      retail_price: Number(form.retail_price) || 0,
      discount_percent: Number(form.discount_percent) || 0,
      requires_referral: form.requires_referral,
      is_active: form.is_active,
    }
    try {
      if (editId) await updatePackage(editId, payload)
      else await createPackage(payload)
      setShowModal(false); fetchData()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan paket')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async (p: ClinicPackage) => {
    try {
      await togglePackageActive(p.id, !p.is_active)
      fetchData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengubah status')
    }
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Package Clinic</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Paket</button>
      </div>

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Kelola paket clinic beserta harga & diskonnya. Paket aktif otomatis muncul di Kasir saat close bill.
      </p>

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
              <th>Nama</th><th>Kategori</th><th>Visit</th><th>Harga/Visit</th>
              <th>Harga Paket</th><th>Harga Retail</th><th>Hemat</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={9}>Memuat data...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="empty-state">Tidak ada paket</td></tr>
            ) : filtered.map(p => (
              <tr key={p.id}>
                <td style={{ fontWeight: 500 }}>{p.name}</td>
                <td>{p.category || '-'}</td>
                <td>{p.sessions}x</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(p.price_per_session)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(p.package_price)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(p.retail_price)}</td>
                <td>
                  <span className="badge" style={{ background: '#ECFDF5', color: '#047857' }}>
                    {p.discount_percent}%
                  </span>
                </td>
                <td>
                  <span className={`badge ${p.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {p.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => openEdit(p)}>Edit</button>
                  <button className={`action-btn ${p.is_active ? 'cancel' : 'confirm'}`} onClick={() => handleToggle(p)}>
                    {p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Paket' : 'Tambah Paket'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}

            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group">
                  <label>Nama Paket *</label>
                  <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="mis. Laser Package 4x" required />
                </div>
                <div className="form-group">
                  <label>Kategori *</label>
                  <input type="text" value={form.category} onChange={e => set('category', e.target.value)} placeholder="mis. Laser" list="pkg-categories" required />
                  <datalist id="pkg-categories">
                    {categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Jumlah Visit *</label>
                  <input type="number" min={1} value={form.sessions} onChange={e => set('sessions', Math.max(1, Number(e.target.value)))} required />
                </div>
                <div className="form-group">
                  <label>Harga per Visit (Rp)</label>
                  <input type="number" min={0} value={form.price_per_session} onChange={e => set('price_per_session', Math.max(0, Number(e.target.value)))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Harga Retail (Rp)</label>
                  <input type="number" min={0} value={form.retail_price} onChange={e => setRetailPrice(Math.max(0, Number(e.target.value)))} />
                </div>
                <div className="form-group">
                  <label>Harga Paket (Rp)</label>
                  <input type="number" min={0} value={form.package_price} onChange={e => setPackagePrice(Math.max(0, Number(e.target.value)))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Diskon (%)</label>
                  <input type="number" min={0} max={100} value={form.discount_percent} onChange={e => set('discount_percent', Math.min(100, Math.max(0, Number(e.target.value))))} />
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Terisi otomatis dari harga retail &amp; paket, bisa diubah manual.</span>
                </div>
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 24 }}>
                    <input type="checkbox" checked={form.requires_referral} onChange={e => set('requires_referral', e.target.checked)} style={{ width: 'auto' }} />
                    Perlu rujukan dokter
                  </label>
                </div>
              </div>
              <div className="form-group">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} style={{ width: 'auto' }} />
                  Aktif (muncul di Kasir)
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
