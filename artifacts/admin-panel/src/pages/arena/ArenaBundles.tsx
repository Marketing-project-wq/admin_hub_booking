import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtRp } from '../../lib/format'

// ARENA — Bundle (paket Arena × Recovery). Mengelola produk bundle yang tampil di
// halaman /book kategori "Bundles". Sumber data:
//   - booking_products (booking_model='bundle', location='ARENA') — kartu + harga
//   - booking_bundle_items — isi paket (list centang)
// Keduanya dibaca situs booking; CRUD lewat RPC SECURITY DEFINER (tak bisa ditulis anon).

interface Bundle {
  id: string
  slug: string
  name: string
  base_price: number | null
  promo_price: number | null
  promo_label: string | null
  promo_end_date: string | null
  price: number
  is_active: boolean
  is_online: boolean
  sort_order: number
  description_id: string | null
}

interface BundleItemRow {
  bundle_slug: string
  item_name: string
  item_type: string
  quantity: number | null
  source_slug: string | null
  sort_order: number | null
}

interface ItemForm { item_name: string; item_type: string; quantity: number; source_slug: string }

interface FormState {
  name: string
  slug: string
  base_price: number
  promo_price: number | null
  promo_label: string
  promo_end_date: string
  description: string
  sort_order: number | null
  is_online: boolean
  is_active: boolean
  items: ItemForm[]
}

const ITEM_TYPES: { value: string; label: string }[] = [
  { value: 'class_sessions',   label: 'Sesi Kelas Arena' },
  { value: 'recovery_service', label: 'Layanan Recovery' },
  { value: 'gym_access',       label: 'Akses Gym' },
  { value: 'physical_item',    label: 'Barang Fisik' },
]
const itemTypeLabel = (v: string) => ITEM_TYPES.find(t => t.value === v)?.label ?? v

const emptyItem = (): ItemForm => ({ item_name: '', item_type: 'class_sessions', quantity: 1, source_slug: '' })

const emptyForm = (): FormState => ({
  name: '', slug: '', base_price: 0, promo_price: null, promo_label: '', promo_end_date: '',
  description: '', sort_order: null, is_online: true, is_active: true, items: [emptyItem()],
})

const slugify = (s: string) =>
  s.toLowerCase().trim().replace(/['"]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')

// Mirror getDisplayPrice() situs: promo aktif hanya bila promo_price di-set DAN
// hari ini <= promo_end_date.
const effective = (r: Pick<Bundle, 'base_price' | 'promo_price' | 'promo_end_date' | 'price'>) => {
  const base = r.base_price ?? r.price
  const promoActive = r.promo_price != null && r.promo_end_date != null &&
    new Date(r.promo_end_date + 'T23:59:59') >= new Date()
  const pct = promoActive && base > 0 ? Math.round((1 - (r.promo_price as number) / base) * 100) : 0
  return { isPromo: promoActive, pct }
}

export default function ArenaBundles() {
  const [data, setData] = useState<Bundle[]>([])
  const [itemsBySlug, setItemsBySlug] = useState<Record<string, BundleItemRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const [{ data: bundles, error: err }, { data: items }] = await Promise.all([
      supabase.rpc('bundle_catalog_list'),
      supabase.from('booking_bundle_items').select('*').order('sort_order', { ascending: true }),
    ])
    if (err) { setError(err.message); setLoading(false); return }
    setData((bundles as Bundle[]) || [])
    const grouped: Record<string, BundleItemRow[]> = {}
    for (const it of ((items as BundleItemRow[] | null) || [])) {
      (grouped[it.bundle_slug] ||= []).push(it)
    }
    setItemsBySlug(grouped)
    setError(''); setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const sorted = useMemo(
    () => [...data].sort((a, b) => (a.sort_order ?? 999) - (b.sort_order ?? 999) || a.name.localeCompare(b.name)),
    [data],
  )

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) => setForm(prev => ({ ...prev, [key]: val }))

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (b: Bundle) => {
    const rows = (itemsBySlug[b.slug] ?? []).slice().sort((x, y) => (x.sort_order ?? 0) - (y.sort_order ?? 0))
    setForm({
      name: b.name, slug: b.slug,
      base_price: b.base_price ?? b.price, promo_price: b.promo_price,
      promo_label: b.promo_label ?? '', promo_end_date: b.promo_end_date ?? '',
      description: b.description_id ?? '', sort_order: b.sort_order, is_online: b.is_online, is_active: b.is_active,
      items: rows.length
        ? rows.map(r => ({ item_name: r.item_name, item_type: r.item_type, quantity: r.quantity ?? 1, source_slug: r.source_slug ?? '' }))
        : [emptyItem()],
    })
    setEditId(b.id); setFormError(''); setShowModal(true)
  }

  // item editor helpers
  const setItem = (idx: number, patch: Partial<ItemForm>) =>
    setForm(p => ({ ...p, items: p.items.map((it, i) => i === idx ? { ...it, ...patch } : it) }))
  const addItem = () => setForm(p => ({ ...p, items: [...p.items, emptyItem()] }))
  const removeItem = (idx: number) => setForm(p => ({ ...p, items: p.items.filter((_, i) => i !== idx) }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.name.trim()) return setFormError('Nama wajib diisi')
    if (!form.base_price || form.base_price <= 0) return setFormError('Harga normal harus > 0')
    if (form.promo_price != null && form.promo_price >= form.base_price)
      return setFormError('Harga promo harus lebih kecil dari harga normal')
    if (form.promo_price != null && !form.promo_end_date)
      return setFormError('Isi tanggal "Promo berlaku s/d" agar promo aktif')
    const validItems = form.items.filter(it => it.item_name.trim())
    if (validItems.length === 0) return setFormError('Minimal 1 isi paket')

    let promoLabel = form.promo_label.trim()
    if (form.promo_price != null && !promoLabel) {
      promoLabel = `Save ${Math.round((1 - form.promo_price / form.base_price) * 100)}%`
    }

    setSaving(true)
    // 1) upsert kartu bundle
    const { data: row, error: err } = await supabase.rpc('bundle_upsert', {
      p_id: editId,
      p_name: form.name.trim(),
      p_base_price: Number(form.base_price),
      p_promo_price: form.promo_price != null && String(form.promo_price) !== '' ? Number(form.promo_price) : null,
      p_promo_label: form.promo_price != null ? promoLabel : null,
      p_promo_end_date: form.promo_price != null ? (form.promo_end_date || null) : null,
      p_is_active: form.is_active,
      p_is_online: form.is_online,
      p_description: form.description.trim() || null,
      p_sort_order: form.sort_order != null && String(form.sort_order) !== '' ? Number(form.sort_order) : null,
      p_slug: editId ? null : (form.slug.trim() || slugify(form.name)),
    })
    if (err) { setSaving(false); setFormError(err.message); return }
    const saved = Array.isArray(row) ? row[0] : row
    const slug = (saved as { slug?: string } | null)?.slug ?? form.slug.trim() ?? slugify(form.name)

    // 2) ganti isi paket
    const { error: itemErr } = await supabase.rpc('bundle_items_replace', {
      p_bundle_slug: slug,
      p_items: validItems.map((it, i) => ({
        item_name: it.item_name.trim(),
        item_type: it.item_type,
        quantity: Number(it.quantity) || 1,
        source_slug: it.source_slug.trim() || null,
        sort_order: i + 1,
      })),
    })
    if (itemErr) { setSaving(false); setFormError(`Bundle tersimpan, tapi isi paket gagal: ${itemErr.message}`); fetchData(); return }

    setSaving(false); setShowModal(false); fetchData()
  }

  const handleToggle = async (b: Bundle) => {
    const { error: err } = await supabase.rpc('bundle_set_active', { p_id: b.id, p_active: !b.is_active })
    if (err) setError(err.message); else fetchData()
  }

  const previewPct = form.promo_price != null && form.base_price > 0
    ? Math.round((1 - form.promo_price / form.base_price) * 100) : 0

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Bundle Arena × Recovery</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Bundle</button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Paket bundle yang tampil di halaman <b>booking.20fit.id/book</b> kategori <b>Bundles</b>.
        Atur harga, isi paket, dan tampil/sembunyi. Perubahan langsung terlihat di situs.
      </p>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Urutan</th><th>Nama</th><th>Harga Normal</th><th>Harga Promo</th>
              <th>Isi Paket</th><th>Tampil</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
            ) : sorted.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">Belum ada bundle</td></tr>
            ) : sorted.map(b => {
              const eff = effective(b)
              const items = itemsBySlug[b.slug] ?? []
              return (
              <tr key={b.id}>
                <td style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{b.sort_order ?? '-'}</td>
                <td style={{ fontWeight: 500 }}>
                  {b.name}
                  <div style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--text-muted)' }}>{b.slug}</div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(b.base_price ?? b.price)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {b.promo_price != null ? (
                    <span>{fmtRp(b.promo_price)}
                      <span className="badge" style={{ marginLeft: 6, background: eff.isPromo ? '#ECFDF5' : '#F3F4F6', color: eff.isPromo ? '#047857' : '#9CA3AF' }}>
                        {eff.isPromo ? `−${eff.pct}%` : 'promo lewat'}
                      </span>
                    </span>
                  ) : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{items.length} item</td>
                <td>
                  <span className="badge" style={b.is_online ? { background: '#EFF6FF', color: '#1D4ED8' } : { background: '#F3F4F6', color: '#6B7280' }}>
                    {b.is_online ? 'Ya' : 'Tidak'}
                  </span>
                </td>
                <td>
                  <span className={`badge ${b.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {b.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => openEdit(b)}>Edit</button>
                  <button className={`action-btn ${b.is_active ? 'cancel' : 'confirm'}`} onClick={() => handleToggle(b)}>
                    {b.is_active ? 'Nonaktifkan' : 'Aktifkan'}
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
          <div className="modal-box" style={{ maxWidth: 680 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Bundle' : 'Tambah Bundle'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>

            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}

            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Nama Bundle *</label>
                <input type="text" value={form.name} onChange={e => set('name', e.target.value)} placeholder="mis. Bundle: 5x Arena + Recovery" required />
              </div>
              {!editId && (
                <div className="form-group">
                  <label>Slug URL (otomatis)</label>
                  <input type="text" value={form.slug} onChange={e => set('slug', e.target.value)} placeholder={slugify(form.name) || 'mis. bundle-5arena-recovery'} />
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
                  <label>Urutan tampil</label>
                  <input type="number" value={form.sort_order ?? ''} onChange={e => set('sort_order', e.target.value === '' ? null : Number(e.target.value))} placeholder="mis. 300" />
                </div>
              </div>

              {/* Promo opsional */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 8 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginBottom: 10 }}>
                  <input type="checkbox" checked={form.promo_price != null}
                    onChange={e => set('promo_price', e.target.checked ? Math.round(form.base_price * 0.9) : null)} style={{ width: 'auto' }} />
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
                      <input type="text" value={form.promo_label} onChange={e => set('promo_label', e.target.value)} placeholder={previewPct > 0 ? `Save ${previewPct}%` : 'mis. Promo Pembukaan'} />
                    </div>
                  </>
                )}
              </div>

              {/* Isi paket */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, margin: 0 }}>Isi Paket (list centang di situs)</label>
                  <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: '4px 10px', display: 'inline-flex', alignItems: 'center', gap: 4 }} onClick={addItem}>
                    <Plus size={13} /> Tambah item
                  </button>
                </div>
                {form.items.map((it, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
                    <div style={{ flex: 2 }}>
                      <input type="text" value={it.item_name} onChange={e => setItem(idx, { item_name: e.target.value })} placeholder="mis. 5x Arena Class Sessions" />
                    </div>
                    <div style={{ width: 60 }}>
                      <input type="number" min={1} value={it.quantity} onChange={e => setItem(idx, { quantity: Number(e.target.value) })} title="Jumlah" />
                    </div>
                    <div style={{ flex: 1 }}>
                      <select value={it.item_type} onChange={e => setItem(idx, { item_type: e.target.value })}>
                        {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <input type="text" value={it.source_slug} onChange={e => setItem(idx, { source_slug: e.target.value })} placeholder="slug produk (opsional)" />
                    </div>
                    <button type="button" onClick={() => removeItem(idx)} title="Hapus item"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', padding: 8, flexShrink: 0 }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
                <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block' }}>
                  <b>slug produk</b> opsional — menautkan item ke produk (mis. <code>sport-massage-60</code>) untuk referensi. Tipe: {ITEM_TYPES.map(t => itemTypeLabel(t.value)).join(' · ')}.
                </small>
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
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
