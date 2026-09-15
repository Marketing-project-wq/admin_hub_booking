import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate } from '../../lib/format'

// RECOVERY CENTER — Voucher. CRUD voucher diskon untuk booking.20fit.id/recoverycenter.
// Data = tabel recovery_vouchers (lihat migrasi 20260915_recovery_vouchers.sql).
// Customer app yang menerapkan voucher saat checkout & menstempel booking; halaman
// ini hanya mengelola master voucher-nya.

interface Voucher {
  id: string
  code: string
  description: string | null
  discount_type: 'percentage' | 'fixed'
  discount_value: number
  max_discount: number | null
  min_spend: number
  quota: number | null
  used_count: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
}

const emptyForm = (): Partial<Voucher> => ({
  code: '', description: '', discount_type: 'percentage', discount_value: 0,
  max_discount: null, min_spend: 0, quota: null, valid_from: '', valid_until: '', is_active: true,
})

const discountLabel = (v: Pick<Voucher, 'discount_type' | 'discount_value'>) =>
  v.discount_type === 'percentage' ? `${v.discount_value}%` : fmtRp(v.discount_value)

export default function RecoveryVouchers() {
  const [data, setData] = useState<Voucher[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notReady, setNotReady] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Voucher>>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase
      .from('recovery_vouchers').select('*').order('created_at', { ascending: false })
    if (err) {
      // Tabel belum dibuat (migrasi belum di-apply) → tampilkan info, bukan error merah.
      if (/does not exist|schema cache/i.test(err.message || '')) { setNotReady(true); setError('') }
      else setError(err.message)
      setLoading(false); return
    }
    setNotReady(false); setData((rows as Voucher[]) || [])
    setError(''); setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (v: Voucher) => {
    setForm({ ...v, description: v.description ?? '', valid_from: v.valid_from ?? '', valid_until: v.valid_until ?? '' })
    setEditId(v.id); setFormError(''); setShowModal(true)
  }

  const f = form
  const setF = (patch: Partial<Voucher>) => setForm(p => ({ ...p, ...patch }))

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!f.code?.trim()) return setFormError('Kode wajib diisi')
    if (!f.discount_value || f.discount_value <= 0) return setFormError('Nilai diskon harus > 0')
    if (f.discount_type === 'percentage' && f.discount_value > 100) return setFormError('Diskon persen maksimal 100%')
    if (f.valid_from && f.valid_until && f.valid_until < f.valid_from) return setFormError('Berlaku s/d harus setelah Berlaku dari')

    setSaving(true)
    const payload = {
      code: f.code!.trim().toUpperCase(),
      description: f.description?.trim() || null,
      discount_type: f.discount_type,
      discount_value: Number(f.discount_value),
      max_discount: f.discount_type === 'percentage' ? (f.max_discount || null) : null,
      min_spend: Number(f.min_spend) || 0,
      quota: f.quota != null && String(f.quota) !== '' ? Number(f.quota) : null,
      valid_from: f.valid_from || null,
      valid_until: f.valid_until || null,
      is_active: f.is_active ?? true,
      updated_at: new Date().toISOString(),
    }

    let err
    if (editId) {
      err = (await supabase.from('recovery_vouchers').update(payload).eq('id', editId)).error
    } else {
      const { data: existing } = await supabase.from('recovery_vouchers').select('id').eq('code', payload.code).maybeSingle()
      if (existing) { setSaving(false); return setFormError('Kode voucher sudah dipakai') }
      err = (await supabase.from('recovery_vouchers').insert({ ...payload, used_count: 0, created_at: new Date().toISOString() })).error
    }
    if (err) { setSaving(false); setFormError(err.message); return }
    setSaving(false); setShowModal(false); fetchData()
  }

  const toggleActive = async (v: Voucher) => {
    const { error: err } = await supabase.from('recovery_vouchers')
      .update({ is_active: !v.is_active, updated_at: new Date().toISOString() }).eq('id', v.id)
    if (err) setError(err.message); else fetchData()
  }

  const sl = search.toLowerCase()
  const displayData = search
    ? data.filter(v => v.code?.toLowerCase().includes(sl) || (v.description ?? '').toLowerCase().includes(sl))
    : data

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Voucher Recovery Center</h2>
        <button className="btn-primary" onClick={openAdd} disabled={notReady}>+ Tambah Voucher</button>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 20, fontSize: 13 }}>
        Kode voucher diskon untuk pembelian di booking.20fit.id/recoverycenter. Diskon diterapkan oleh halaman booking saat checkout.
      </p>

      {notReady && (
        <div style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FCD34D', borderRadius: 8, padding: '12px 16px', fontSize: 13, marginBottom: 16 }}>
          Fitur voucher sedang disiapkan — database belum diaktivasi. Voucher bisa dibuat di sini setelah migrasi <b>20260915_recovery_vouchers</b> di-apply.
        </div>
      )}
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
              <th>Kode</th><th>Deskripsi</th><th>Diskon</th><th>Min Belanja</th>
              <th>Kuota</th><th>Dipakai</th><th>Berlaku s/d</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={9}>Memuat data...</td></tr>
            ) : displayData.length === 0 ? (
              <tr><td colSpan={9} className="empty-state">{search ? 'Tidak ada hasil' : 'Belum ada voucher'}</td></tr>
            ) : displayData.map(v => (
              <tr key={v.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{v.code}</td>
                <td>{v.description || '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {discountLabel(v)}
                  {v.discount_type === 'percentage' && v.max_discount ? <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> (maks {fmtRp(v.max_discount)})</span> : null}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>{v.min_spend ? fmtRp(v.min_spend) : '-'}</td>
                <td style={{ textAlign: 'center' }}>{v.quota ?? '∞'}</td>
                <td style={{ textAlign: 'center' }}>{v.used_count}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{v.valid_until ? fmtDate(v.valid_until) : '-'}</td>
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
          <div className="modal-box" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Voucher' : 'Tambah Voucher'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group">
                  <label>Kode *</label>
                  <input type="text" value={f.code || ''} onChange={e => setF({ code: e.target.value.toUpperCase() })} placeholder="mis. RECOVERY10" required />
                </div>
                <div className="form-group">
                  <label>Deskripsi</label>
                  <input type="text" value={f.description || ''} onChange={e => setF({ description: e.target.value })} placeholder="mis. Diskon 10% semua massage" />
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
                  <input type="number" min={0} value={f.min_spend || 0} onChange={e => setF({ min_spend: Number(e.target.value) })} />
                </div>
                <div className="form-group">
                  <label>Kuota (kosong = tanpa batas)</label>
                  <input type="number" min={0} value={f.quota ?? ''} onChange={e => setF({ quota: e.target.value === '' ? null : Number(e.target.value) })} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Berlaku dari</label>
                  <input type="date" value={f.valid_from || ''} onChange={e => setF({ valid_from: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Berlaku s/d</label>
                  <input type="date" value={f.valid_until || ''} onChange={e => setF({ valid_until: e.target.value })} />
                </div>
              </div>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, marginBottom: 8 }}>
                <input type="checkbox" checked={f.is_active ?? true} onChange={e => setF({ is_active: e.target.checked })} style={{ width: 'auto' }} />
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
