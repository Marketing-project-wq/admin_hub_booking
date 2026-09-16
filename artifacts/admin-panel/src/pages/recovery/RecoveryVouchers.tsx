import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fmtRp, fmtDate } from '../../lib/format'

// RECOVERY CENTER — Voucher. CRUD voucher diskon untuk booking.20fit.id/recoverycenter.
//
// SUMBER DATA = arena_vouchers — TABEL VOUCHER YANG SAMA yang divalidasi situs
// booking saat checkout. Voucher Recovery dibedakan lewat kolom location =
// 'RECOVERY_CENTER'; opsional dibatasi ke produk tertentu lewat applicable_slugs
// (kosong = semua produk Recovery). Situs booking mengecek location + applicable_slugs
// (lihat repo arena-booking) sehingga voucher hanya berlaku di tempat yang benar.

interface Voucher {
  id: string
  code: string
  description: string | null
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  min_booking_amount: number | null
  max_discount_amount: number | null
  quota: number | null
  used_count: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  location: string | null
  applicable_slugs: string[] | null
}

interface ProductOpt { slug: string; name: string }

interface FormState {
  code: string
  description: string
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  slugs: Set<string>          // produk terpilih (slug); kosong/semua = berlaku semua
  min_amount: number
  max_discount: number | null
  quota: number | null
  valid_from: string
  valid_until: string
  is_active: boolean
}

const FAR_FUTURE = '2099-12-31'
const today = () => new Date().toISOString().split('T')[0]

const emptyForm = (): FormState => ({
  code: '', description: '', discount_type: 'percentage', discount_value: 0,
  slugs: new Set(), min_amount: 0, max_discount: null, quota: null,
  valid_from: '', valid_until: '', is_active: true,
})

const discountLabel = (v: Pick<Voucher, 'discount_type' | 'discount_value'>) =>
  v.discount_type === 'percentage' ? `${v.discount_value}%` : fmtRp(v.discount_value)

export default function RecoveryVouchers() {
  const { user } = useAuth()
  const [data, setData] = useState<Voucher[]>([])
  const [products, setProducts] = useState<ProductOpt[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    // Produk Recovery Center (untuk pilihan scope voucher).
    const { data: prods } = await supabase.rpc('recovery_catalog_list')
    setProducts(((prods as { slug: string; name: string }[] | null) || []).map(p => ({ slug: p.slug, name: p.name })))

    // Voucher Recovery = arena_vouchers dengan location='RECOVERY_CENTER'.
    const { data: rows, error: err } = await supabase
      .from('arena_vouchers').select('*')
      .eq('location', 'RECOVERY_CENTER')
      .order('created_at', { ascending: false })
    if (err) { setError(err.message); setLoading(false); return }
    setData((rows as Voucher[]) || [])
    setError(''); setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (v: Voucher) => {
    setForm({
      code: v.code, description: v.description ?? '',
      discount_type: v.discount_type, discount_value: v.discount_value,
      slugs: new Set(v.applicable_slugs ?? []),
      min_amount: v.min_booking_amount ?? 0, max_discount: v.max_discount_amount, quota: v.quota,
      valid_from: v.valid_from ?? '', valid_until: (v.valid_until && v.valid_until !== FAR_FUTURE) ? v.valid_until : '',
      is_active: v.is_active,
    })
    setEditId(v.id); setFormError(''); setShowModal(true)
  }

  const f = form
  const setF = (patch: Partial<FormState>) => setForm(p => ({ ...p, ...patch }))
  const toggleSlug = (slug: string, on: boolean) => setForm(p => {
    const next = new Set(p.slugs)
    if (on) next.add(slug); else next.delete(slug)
    return { ...p, slugs: next }
  })

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!f.code.trim()) return setFormError('Kode wajib diisi')
    if (!f.discount_value || f.discount_value <= 0) return setFormError('Nilai diskon harus > 0')
    if (f.discount_type === 'percentage' && f.discount_value > 100) return setFormError('Diskon persen maksimal 100%')
    if (f.valid_from && f.valid_until && f.valid_until < f.valid_from) return setFormError('Berlaku s/d harus setelah Berlaku dari')

    // Semua produk terpilih (atau tak ada) => null = berlaku semua produk Recovery.
    const allSelected = f.slugs.size === 0 || f.slugs.size >= products.length
    const applicable_slugs = allSelected ? null : Array.from(f.slugs)

    const payload = {
      code: f.code.trim().toUpperCase(),
      description: f.description.trim() || null,
      discount_type: f.discount_type,
      discount_value: Number(f.discount_value),
      min_booking_amount: Number(f.min_amount) || 0,
      max_discount_amount: f.discount_type === 'percentage' ? (f.max_discount || null) : null,
      quota: f.quota != null && String(f.quota) !== '' ? Number(f.quota) : null,
      valid_from: f.valid_from || today(),
      valid_until: f.valid_until || FAR_FUTURE,
      is_active: f.is_active,
      corporation_only: false,
      applies_to: 'both',                 // scope sebenarnya via location; 'both' agar tak ditolak cek applies_to
      location: 'RECOVERY_CENTER',
      applicable_slugs,
      updated_at: new Date().toISOString(),
    }

    setSaving(true)
    let err
    if (editId) {
      const res = await supabase.from('arena_vouchers').update(payload).eq('id', editId)
      err = res.error
    } else {
      const { data: existing } = await supabase.from('arena_vouchers').select('id').eq('code', payload.code).maybeSingle()
      if (existing) { setSaving(false); return setFormError('Kode voucher sudah dipakai') }
      const res = await supabase.from('arena_vouchers').insert({ ...payload, used_count: 0, created_by: user?.email || 'admin', created_at: new Date().toISOString() })
      err = res.error
    }
    if (err) { setSaving(false); setFormError(err.message); return }
    setSaving(false); setShowModal(false); fetchData()
  }

  const toggleActive = async (v: Voucher) => {
    const { error: err } = await supabase.from('arena_vouchers')
      .update({ is_active: !v.is_active, updated_at: new Date().toISOString() }).eq('id', v.id)
    if (err) setError(err.message); else fetchData()
  }

  const sl = search.toLowerCase()
  const displayData = search
    ? data.filter(v => v.code?.toLowerCase().includes(sl) || (v.description ?? '').toLowerCase().includes(sl))
    : data

  const scopeLabel = (v: Voucher) => {
    const arr = v.applicable_slugs ?? []
    if (arr.length === 0) return 'Semua layanan'
    return `${arr.length} layanan`
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Voucher Recovery Center</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Voucher</button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Kode voucher untuk pembelian di <b>booking.20fit.id/recoverycenter</b>. Bisa dibatasi ke layanan tertentu
        (kosongkan = berlaku semua layanan Recovery).
      </p>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input type="text" placeholder="Cari kode / deskripsi voucher..." value={search}
          onChange={e => setSearch(e.target.value)} style={{ minWidth: 240 }} />
        {search && (
          <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setSearch('')}>Reset</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kode</th><th>Deskripsi</th><th>Diskon</th><th>Berlaku Untuk</th><th>Min Belanja</th>
              <th>Kuota</th><th>Dipakai</th><th>Berlaku s/d</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={10}>Memuat data...</td></tr>
            ) : displayData.length === 0 ? (
              <tr><td colSpan={10} className="empty-state">{search ? 'Tidak ada hasil' : 'Belum ada voucher'}</td></tr>
            ) : displayData.map(v => (
              <tr key={v.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{v.code}</td>
                <td>{v.description || '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {discountLabel(v)}
                  {v.discount_type === 'percentage' && v.max_discount_amount ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> (maks {fmtRp(v.max_discount_amount)})</span> : null}
                </td>
                <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{scopeLabel(v)}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{v.min_booking_amount ? fmtRp(v.min_booking_amount) : '-'}</td>
                <td style={{ textAlign: 'center' }}>{v.quota ?? '∞'}</td>
                <td style={{ textAlign: 'center' }}>{v.used_count}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{v.valid_until && v.valid_until !== FAR_FUTURE ? fmtDate(v.valid_until) : '-'}</td>
                <td>
                  <span className={`badge ${v.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {v.is_active ? 'Aktif' : 'Nonaktif'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => openEdit(v)}>Edit</button>
                  <button className={`action-btn ${v.is_active ? 'cancel' : 'confirm'}`} onClick={() => toggleActive(v)}>
                    {v.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Voucher' : 'Tambah Voucher'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group">
                  <label>Kode *</label>
                  <input type="text" value={f.code} onChange={e => setF({ code: e.target.value.toUpperCase() })} placeholder="mis. RECOVERY10" required />
                </div>
                <div className="form-group">
                  <label>Deskripsi</label>
                  <input type="text" value={f.description} onChange={e => setF({ description: e.target.value })} placeholder="mis. Diskon 10% semua massage" />
                </div>
              </div>
              <div className="form-group">
                <label>Tipe Diskon *</label>
                <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                  {([['percentage', 'Persentase (%)'], ['fixed', 'Nominal (Rp)']] as const).map(([t, lbl]) => (
                    <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                      <input type="radio" name="dtype" value={t} checked={f.discount_type === t} onChange={() => setF({ discount_type: t })} />
                      {lbl}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nilai Diskon * {f.discount_type === 'percentage' ? '(%)' : '(Rp)'}</label>
                  <input type="number" min={0} max={f.discount_type === 'percentage' ? 100 : undefined} value={f.discount_value || ''} onChange={e => setF({ discount_value: Number(e.target.value) })} required />
                </div>
                {f.discount_type === 'percentage' && (
                  <div className="form-group">
                    <label>Maks Diskon (Rp)</label>
                    <input type="number" min={0} value={f.max_discount || ''} onChange={e => setF({ max_discount: Number(e.target.value) || null })} placeholder="opsional" />
                  </div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Min Belanja (Rp)</label>
                  <input type="number" min={0} value={f.min_amount || 0} onChange={e => setF({ min_amount: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Kuota (kosong = tanpa batas)</label>
                  <input type="number" min={0} value={f.quota ?? ''} onChange={e => setF({ quota: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Berlaku dari</label>
                  <input type="date" value={f.valid_from} onChange={e => setF({ valid_from: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Berlaku s/d</label>
                  <input type="date" value={f.valid_until} onChange={e => setF({ valid_until: e.target.value })} />
                </div>
              </div>

              <div className="form-group">
                <label>Berlaku untuk layanan ({f.slugs.size === 0 ? 'semua' : `${f.slugs.size} dipilih`})</label>
                <small style={{ color: 'var(--text-muted)', fontSize: 11, display: 'block', marginBottom: 6 }}>
                  Kosongkan semua = voucher berlaku untuk semua layanan Recovery. Centang untuk membatasi.
                </small>
                <div style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                  {products.length === 0 ? (
                    <div style={{ padding: 12, fontSize: 13, color: 'var(--text-muted)' }}>Tidak ada layanan Recovery Center</div>
                  ) : products.map(p => (
                    <label key={p.slug} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={f.slugs.has(p.slug)} onChange={e => toggleSlug(p.slug, e.target.checked)} style={{ width: 'auto' }} />
                      <span>{p.name}</span>
                    </label>
                  ))}
                </div>
              </div>

              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginBottom: 8 }}>
                <input type="checkbox" checked={f.is_active} onChange={e => setF({ is_active: e.target.checked })} style={{ width: 'auto' }} />
                Aktif
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
