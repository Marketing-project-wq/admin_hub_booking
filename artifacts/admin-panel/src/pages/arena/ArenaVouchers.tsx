import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtDate } from '../../lib/format'

interface Voucher {
  id: string; code: string; description: string; discount_type: string; discount_value: number;
  min_booking_amount: number; max_discount_amount: number | null; quota: number; used_count: number;
  valid_from: string; valid_until: string; is_active: boolean; corporation_only: boolean;
}

const emptyForm = (): Partial<Voucher> => ({
  code: '', description: '', discount_type: 'percentage', discount_value: 0,
  min_booking_amount: 0, max_discount_amount: null, quota: 1,
  valid_from: '', valid_until: '', is_active: true, corporation_only: false,
})

export default function ArenaVouchers() {
  const [data, setData] = useState<Voucher[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Voucher>>(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase.from('arena_vouchers').select('*').order('created_at', { ascending: false })
    if (err) setError(err.message)
    else setData(rows as Voucher[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (v: Voucher) => { setForm({ ...v }); setEditId(v.id); setFormError(''); setShowModal(true) }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!form.code) return setFormError('Code wajib diisi')
    if (!form.discount_value || form.discount_value <= 0) return setFormError('Nilai diskon harus > 0')
    if (form.valid_until && form.valid_from && form.valid_until < form.valid_from) return setFormError('Valid Until harus setelah Valid From')

    setSaving(true)
    const payload = {
      code: form.code!.toUpperCase(),
      description: form.description,
      discount_type: form.discount_type,
      discount_value: form.discount_value,
      min_booking_amount: form.min_booking_amount || 0,
      max_discount_amount: form.max_discount_amount || null,
      quota: form.quota || 1,
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      is_active: form.is_active ?? true,
      corporation_only: form.corporation_only ?? false,
      updated_at: new Date().toISOString(),
    }

    let err
    if (editId) {
      const res = await supabase.from('arena_vouchers').update(payload).eq('id', editId)
      err = res.error
    } else {
      // Check unique
      const { data: existing } = await supabase.from('arena_vouchers').select('id').eq('code', payload.code).single()
      if (existing) { setSaving(false); return setFormError('Code voucher sudah digunakan') }
      const res = await supabase.from('arena_vouchers').insert({ ...payload, created_at: new Date().toISOString() })
      err = res.error
    }
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false)
    fetchData()
  }

  const toggleActive = async (v: Voucher) => {
    await supabase.from('arena_vouchers').update({ is_active: !v.is_active, updated_at: new Date().toISOString() }).eq('id', v.id)
    fetchData()
  }

  const f = form

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Vouchers</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Voucher</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari kode atau deskripsi voucher..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />
        {search && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => setSearch('')}
          >
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        {(() => {
          const sl = search.toLowerCase()
          const displayData = search
            ? data.filter(v =>
                v.code?.toLowerCase().includes(sl) ||
                v.description?.toLowerCase().includes(sl)
              )
            : data
          return (
        <table className="data-table">
          <thead>
            <tr>
              <th>Code</th><th>Deskripsi</th><th>Tipe Diskon</th><th>Nilai</th>
              <th>Quota</th><th>Used</th><th>Valid Until</th><th>Status</th>
              <th>Corp Only</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={10}>Memuat data...</td></tr>
            ) : displayData.length === 0 ? (
              <tr><td colSpan={10} className="empty-state">{search ? 'Tidak ada hasil' : 'Tidak ada voucher'}</td></tr>
            ) : displayData.map(v => (
              <tr key={v.id}>
                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{v.code}</td>
                <td>{v.description}</td>
                <td>{v.discount_type}</td>
                <td>{v.discount_type === 'percentage' ? `${v.discount_value}%` : `Rp ${v.discount_value.toLocaleString('id-ID')}`}</td>
                <td style={{ textAlign: 'center' }}>{v.quota}</td>
                <td style={{ textAlign: 'center' }}>{v.used_count}</td>
                <td>{fmtDate(v.valid_until)}</td>
                <td>
                  <span className={`badge ${v.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {v.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ textAlign: 'center' }}>{v.corporation_only ? 'Ya' : '-'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => openEdit(v)}>Edit</button>
                  <button className="action-btn" onClick={() => toggleActive(v)}>
                    {v.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
          )
        })()}
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Voucher' : 'Tambah Voucher'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-row">
                <div className="form-group">
                  <label>Code *</label>
                  <input type="text" value={f.code || ''} onChange={e => setForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} required />
                </div>
                <div className="form-group">
                  <label>Deskripsi</label>
                  <input type="text" value={f.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Tipe Diskon *</label>
                <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
                  {['percentage', 'fixed'].map(t => (
                    <label key={t} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                      <input type="radio" name="dtype" value={t} checked={f.discount_type === t} onChange={() => setForm(p => ({ ...p, discount_type: t }))} />
                      {t === 'percentage' ? 'Persentase (%)' : 'Nominal (Rp)'}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Nilai Diskon * {f.discount_type === 'percentage' ? '(%)' : '(Rp)'}</label>
                  <input type="number" min={0} max={f.discount_type === 'percentage' ? 100 : undefined} value={f.discount_value || ''} onChange={e => setForm(p => ({ ...p, discount_value: Number(e.target.value) }))} required />
                </div>
                {f.discount_type === 'percentage' && (
                  <div className="form-group">
                    <label>Max Diskon (Rp)</label>
                    <input type="number" min={0} value={f.max_discount_amount || ''} onChange={e => setForm(p => ({ ...p, max_discount_amount: Number(e.target.value) || null }))} />
                  </div>
                )}
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Min Booking Amount (Rp)</label>
                  <input type="number" min={0} value={f.min_booking_amount || 0} onChange={e => setForm(p => ({ ...p, min_booking_amount: Number(e.target.value) }))} />
                </div>
                <div className="form-group">
                  <label>Quota</label>
                  <input type="number" min={1} value={f.quota || 1} onChange={e => setForm(p => ({ ...p, quota: Number(e.target.value) }))} required />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Valid From</label>
                  <input type="date" value={f.valid_from || ''} onChange={e => setForm(p => ({ ...p, valid_from: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Valid Until</label>
                  <input type="date" value={f.valid_until || ''} onChange={e => setForm(p => ({ ...p, valid_until: e.target.value }))} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={f.corporation_only ?? false} onChange={e => setForm(p => ({ ...p, corporation_only: e.target.checked }))} />
                  Corporation Only
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={f.is_active ?? true} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />
                  Active
                </label>
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
