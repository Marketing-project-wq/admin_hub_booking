import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtRp } from '../../lib/format'

// RECOVERY CENTER — Layanan (katalog). Mengelola produk & harga yang tampil di
// halaman booking.20fit.id/recoverycenter (dan /book kategori Recovery Center).
//
// SUMBER DATA = booking_products (location='RECOVERY_CENTER') — TABEL YANG SAMA
// yang dibaca situs booking. Jadi edit harga / on-off di sini LANGSUNG mengubah
// yang dilihat pembeli. Model harga situs: Harga Normal (base_price, dicoret saat
// promo) + Harga Promo (promo_price) berlaku s/d tanggal promo; setelah lewat,
// otomatis balik ke Harga Normal (tanpa cron). CRUD lewat RPC SECURITY DEFINER
// (booking_products tidak bisa ditulis anon & baris nonaktif tak terlihat anon).

interface CatalogRow {
  id: string
  slug: string
  name: string
  category: string            // 'treatment' | 'product'
  booking_model: string       // 'appointment' | 'addon'
  base_price: number | null
  promo_price: number | null
  promo_label: string | null
  promo_end_date: string | null
  price: number
  duration_min: number | null
  is_online: boolean
  is_active: boolean
  sort_order: number
  description_id: string | null
  source_id: string | null
}

interface FormState {
  name: string
  slug: string                // hanya dipakai saat tambah
  source_id: string           // kode clinic_services, hanya saat tambah
  category: string
  booking_model: string
  base_price: number
  promo_price: number | null
  promo_label: string
  promo_end_date: string
  duration_min: number | null
  sort_order: number | null
  description: string
  is_online: boolean
  is_active: boolean
}

const emptyForm = (): FormState => ({
  name: '', slug: '', source_id: '',
  category: 'treatment', booking_model: 'appointment',
  base_price: 0, promo_price: null, promo_label: '', promo_end_date: '',
  duration_min: null, sort_order: null, description: '',
  is_online: true, is_active: true,
})

// slug otomatis dari nama: huruf kecil, spasi -> '-'
const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Meniru getDisplayPrice() situs booking: promo aktif hanya bila promo_price di-set
// DAN hari ini <= promo_end_date. Kalau tidak, tampil base_price.
const effective = (r: Pick<CatalogRow, 'base_price' | 'promo_price' | 'promo_end_date' | 'price'>) => {
  const base = r.base_price ?? r.price
  const promoActive =
    r.promo_price != null && r.promo_end_date != null &&
    new Date(r.promo_end_date + 'T23:59:59') >= new Date()
  if (promoActive) {
    const pct = base > 0 ? Math.round((1 - (r.promo_price as number) / base) * 100) : 0
    return { current: r.promo_price as number, original: base, isPromo: true, pct }
  }
  return { current: base, original: null as number | null, isPromo: false, pct: 0 }
}

export default function RecoveryServices() {
  const [data, setData] = useState<CatalogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase.rpc('recovery_catalog_list')
    if (err) { setError(err.message); setLoading(false); return }
    setData((rows as CatalogRow[]) || [])
    setError(''); setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const sorted = useMemo(
    () => [...data].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name)),
    [data],
  )

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: val }))

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (r: CatalogRow) => {
    setForm({
      name: r.name, slug: r.slug, source_id: r.source_id ?? '',
      category: r.category || 'treatment', booking_model: r.booking_model || 'appointment',
      base_price: r.base_price ?? r.price, promo_price: r.promo_price,
      promo_label: r.promo_label ?? '', promo_end_date: r.promo_end_date ?? '',
      duration_min: r.duration_min, sort_order: r.sort_order, description: r.description_id ?? '',
      is_online: r.is_online, is_active: r.is_active,
    })
    setEditId(r.id); setFormError(''); setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) return setFormError('Nama wajib diisi')
    if (!form.base_price || form.base_price <= 0) return setFormError('Harga normal harus > 0')
    if (form.promo_price != null && form.promo_price >= form.base_price)
      return setFormError('Harga promo harus lebih kecil dari harga normal')
    if (form.promo_price != null && !form.promo_end_date)
      return setFormError('Isi tanggal "Promo berlaku s/d" agar promo aktif')

    // Label promo otomatis "Hemat X%" bila kosong dan ada promo.
    let promoLabel = form.promo_label.trim()
    if (form.promo_price != null && !promoLabel) {
      const pct = Math.round((1 - form.promo_price / form.base_price) * 100)
      promoLabel = `Hemat ${pct}%`
    }

    setSaving(true)
    const { error: err } = await supabase.rpc('recovery_catalog_upsert', {
      p_id: editId,
      p_name: form.name.trim(),
      p_base_price: Number(form.base_price),
      p_promo_price: form.promo_price != null && String(form.promo_price) !== '' ? Number(form.promo_price) : null,
      p_promo_label: form.promo_price != null ? promoLabel : null,
      p_promo_end_date: form.promo_price != null ? (form.promo_end_date || null) : null,
      p_is_active: form.is_active,
      p_is_online: form.is_online,
      p_duration_min: form.duration_min != null && String(form.duration_min) !== '' ? Number(form.duration_min) : null,
      p_category: form.category,
      p_booking_model: form.booking_model,
      p_description: form.description.trim() || null,
      p_sort_order: form.sort_order != null && String(form.sort_order) !== '' ? Number(form.sort_order) : null,
      p_slug: editId ? null : (form.slug.trim() || slugify(form.name)),
      p_source_id: editId ? null : (form.source_id.trim() || null),
    })
    if (err) { setSaving(false); setFormError(err.message); return }
    setSaving(false); setShowModal(false); fetchData()
  }

  const handleToggle = async (r: CatalogRow) => {
    const { error: err } = await supabase.rpc('recovery_catalog_set_active', { p_id: r.id, p_active: !r.is_active })
    if (err) setError(err.message); else fetchData()
  }

  // preview harga promo di form
  const previewPct = form.promo_price != null && form.base_price > 0
    ? Math.round((1 - form.promo_price / form.base_price) * 100) : 0

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Layanan Recovery Center</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Layanan</button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Produk &amp; harga yang tampil di <b>booking.20fit.id/recoverycenter</b>. Perubahan di sini langsung
        terlihat di halaman booking. <b>Tampil Online</b> = muncul untuk dibeli; <b>Status</b> nonaktif =
        disembunyikan total.
      </p>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Urutan</th><th>Nama</th><th>Durasi</th>
              <th>Harga Normal</th><th>Harga Promo</th><th>Tampil Online</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">Belum ada layanan</td></tr>
            ) : sorted.map(r => {
              const eff = effective(r)
              return (
              <tr key={r.id}>
                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{r.sort_order ?? '-'}</td>
                <td style={{ fontWeight: 500 }}>
                  {r.name}
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{r.slug}</div>
                </td>
                <td>{r.duration_min != null ? `${r.duration_min} mnt` : '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(r.base_price ?? r.price)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {r.promo_price != null ? (
                    <span>
                      {fmtRp(r.promo_price)}
                      <span className="badge" style={{ marginLeft: 6, background: eff.isPromo ? '#ECFDF5' : '#F3F4F6', color: eff.isPromo ? '#047857' : '#9CA3AF' }}>
                        {eff.isPromo ? `−${eff.pct}%` : 'promo lewat'}
                      </span>
                    </span>
                  ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                </td>
                <td>
                  <span className="badge" style={r.is_online
                    ? { background: '#EFF6FF', color: '#1D4ED8' }
                    : { background: '#F3F4F6', color: '#6B7280' }}>
                    {r.is_online ? 'Ya' : 'Tidak'}
                  </span>
                </td>
                <td>
                  <span className={`badge ${r.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {r.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => openEdit(r)}>Edit</button>
                  <button className={`action-btn ${r.is_active ? 'cancel' : 'confirm'}`} onClick={() => handleToggle(r)}>
                    {r.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Layanan' : 'Tambah Layanan'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Nama Layanan *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder='mis. Sport Massage 45"' required />
              </div>

              {!editId && (
                <div className="form-row">
                  <div className="form-group">
                    <label>Slug URL (otomatis)</label>
                    <input type="text" value={form.slug} onChange={e => set('slug', e.target.value)} placeholder={slugify(form.name) || 'mis. sport-massage-45'} />
                  </div>
                  <div className="form-group">
                    <label>Kode (opsional)</label>
                    <input type="text" value={form.source_id} onChange={e => set('source_id', e.target.value)} placeholder="mis. RC-SM45" />
                  </div>
                </div>
              )}

              <div className="form-group">
                <label>Deskripsi</label>
                <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={2} />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Harga Normal (Rp) *</label>
                  <input type="number" min={0} value={form.base_price || ''} onChange={e => set('base_price', Math.max(0, Number(e.target.value)))} required />
                </div>
                <div className="form-group">
                  <label>Durasi (menit)</label>
                  <input type="number" min={0} value={form.duration_min ?? ''} onChange={e => set('duration_min', e.target.value === '' ? null : Number(e.target.value))} placeholder="mis. 45" />
                </div>
              </div>

              {/* Promo — opsional */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 8 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginBottom: 10 }}>
                  <input type="checkbox" checked={form.promo_price != null}
                    onChange={e => set('promo_price', e.target.checked ? Math.round(form.base_price * 0.9) : null)}
                    style={{ width: 'auto' }} />
                  <strong>Pakai Harga Promo</strong>
                </label>
                {form.promo_price != null && (
                  <>
                    <div className="form-row">
                      <div className="form-group">
                        <label>Harga Promo (Rp)</label>
                        <input type="number" min={0} value={form.promo_price || ''} onChange={e => set('promo_price', Number(e.target.value))} />
                        {previewPct > 0 && <small style={{ color: '#047857', fontSize: 11 }}>Hemat {previewPct}% dari harga normal</small>}
                      </div>
                      <div className="form-group">
                        <label>Promo berlaku s/d *</label>
                        <input type="date" value={form.promo_end_date} onChange={e => set('promo_end_date', e.target.value)} />
                      </div>
                    </div>
                    <div className="form-group">
                      <label>Label Promo (opsional)</label>
                      <input type="text" value={form.promo_label} onChange={e => set('promo_label', e.target.value)} placeholder={previewPct > 0 ? `Hemat ${previewPct}%` : 'mis. Promo Pembukaan'} />
                    </div>
                    <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginBottom: 8 }}>
                      Pelanggan melihat harga promo (harga normal dicoret) sampai tanggal di atas, lalu otomatis kembali ke harga normal.
                    </small>
                  </>
                )}
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Kategori</label>
                  <select value={form.category} onChange={e => set('category', e.target.value)}>
                    <option value="treatment">Layanan (treatment)</option>
                    <option value="product">Produk fisik (product)</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Urutan tampil</label>
                  <input type="number" value={form.sort_order ?? ''} onChange={e => set('sort_order', e.target.value === '' ? null : Number(e.target.value))} placeholder="mis. 80" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={form.is_online} onChange={e => set('is_online', e.target.checked)} style={{ width: 'auto' }} />
                    Tampil untuk dibeli online
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
