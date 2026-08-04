import React, { useState, useEffect, useCallback } from 'react'
import { X, AlertTriangle } from 'lucide-react'
import { supabase } from '../../../lib/supabase'

interface ArenaPackage {
  id: string
  name: string
  description: string | null
  sessions: number
  price: number
  original_price: number
  includes_physio_voucher: boolean
  is_active: boolean
  sort_order: number
}

// Mirror dari sistem booking (ARENA-BOOKING youngstarsArena.ts): paket dikenali
// sebagai Youngstars HANYA jika namanya diawali PERSIS string ini (case-sensitive).
// Dipakai customer untuk split tab DAN validasi redeem voucher paket — rename yang
// merusak prefix ini membuat kedua fitur itu diam-diam rusak.
const YOUNGSTARS_NAME_MARKER = 'HYROX Youngstars'

const isYoungstarsName = (name: string) => name.startsWith(YOUNGSTARS_NAME_MARKER)
// Mengandung "youngstars" tapi TIDAK diawali marker persis → hampir pasti typo/salah format
const isBrokenYoungstarsName = (name: string) =>
  name.toLowerCase().includes('youngstars') && !isYoungstarsName(name)

const emptyForm = (): Partial<ArenaPackage> => ({
  name: '', description: '', sessions: 1, price: 0, original_price: 0,
  includes_physio_voucher: false, is_active: true, sort_order: 0,
})

const fmtRp = (n: number) => `Rp ${Number(n || 0).toLocaleString('id-ID')}`

export default function ArenaPackages() {
  const [data, setData] = useState<ArenaPackage[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<ArenaPackage>>(emptyForm())
  const [originalName, setOriginalName] = useState('')   // nama sebelum edit — deteksi rename yang merusak prefix Youngstars
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Konfirmasi 2 langkah saat nama berisiko merusak deteksi Youngstars
  const [showYoungstarsConfirm, setShowYoungstarsConfirm] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase
      .from('arena_packages')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
    if (err) { setError(err.message); setLoading(false); return }
    setData(rows as ArenaPackage[])
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const openAdd = () => {
    setForm(emptyForm()); setEditId(null); setOriginalName(''); setFormError('')
    setShowYoungstarsConfirm(false)
    setShowModal(true)
  }

  const openEdit = (p: ArenaPackage) => {
    setForm({ ...p }); setEditId(p.id); setOriginalName(p.name); setFormError('')
    setShowYoungstarsConfirm(false)
    setShowModal(true)
  }

  const f = form
  const name = (f.name || '').trim()

  // Lapis pengaman Youngstars:
  // - brokenName: nama mengandung "youngstars" tapi prefix tidak persis → warning + wajib konfirmasi
  // - lostMarker: edit paket yang SEMULA Youngstars jadi tidak diawali marker → wajib konfirmasi
  const brokenName = isBrokenYoungstarsName(name)
  const lostMarker = !!editId && isYoungstarsName(originalName) && !isYoungstarsName(name)
  const needsYoungstarsConfirm = brokenName || lostMarker

  const doSave = async () => {
    setSaving(true)
    const payload = {
      name,
      description: f.description?.trim() || null,
      sessions: f.sessions,
      price: f.price,
      original_price: f.original_price,
      includes_physio_voucher: f.includes_physio_voucher ?? false,
      is_active: f.is_active ?? true,
      sort_order: f.sort_order ?? 0,
    }
    let err
    if (editId) {
      const res = await supabase.from('arena_packages').update(payload).eq('id', editId)
      err = res.error
    } else {
      const res = await supabase.from('arena_packages').insert(payload)
      err = res.error
    }
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false)
    setShowYoungstarsConfirm(false)
    fetchData()
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    if (!name) return setFormError('Nama paket wajib diisi')
    if (!f.sessions || f.sessions < 1) return setFormError('Sessions minimal 1')
    if (f.price == null || f.price < 0) return setFormError('Harga tidak valid')
    if (f.original_price == null || f.original_price < 0) return setFormError('Harga coret tidak valid')

    if (needsYoungstarsConfirm) { setShowYoungstarsConfirm(true); return }
    await doSave()
  }

  const toggleActive = async (p: ArenaPackage) => {
    await supabase.from('arena_packages').update({ is_active: !p.is_active }).eq('id', p.id)
    fetchData()
  }

  const sl = search.toLowerCase()
  const displayData = search
    ? data.filter(p => p.name.toLowerCase().includes(sl) || (p.description || '').toLowerCase().includes(sl))
    : data

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Packages</h2>
        <button className="btn-primary" onClick={openAdd}>+ Tambah Paket</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari nama atau deskripsi paket..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 240 }}
        />
        {search && (
          <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => setSearch('')}>
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nama</th><th>Sessions</th><th>Harga</th><th>Harga Coret</th>
              <th>Physio Voucher</th><th>Sort</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
            ) : displayData.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">{search ? 'Tidak ada hasil' : 'Tidak ada paket'}</td></tr>
            ) : displayData.map(p => (
              <tr key={p.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>
                    {p.name}
                    {isYoungstarsName(p.name) && (
                      <span className="badge badge-pending" style={{ marginLeft: 8 }}>Youngstars</span>
                    )}
                  </div>
                  {p.description && <div style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 320, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.description}</div>}
                </td>
                <td style={{ textAlign: 'center' }}>{p.sessions}</td>
                <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(p.price)}</td>
                <td style={{ whiteSpace: 'nowrap', color: 'var(--text-muted)' }}>
                  {p.original_price > p.price ? <s>{fmtRp(p.original_price)}</s> : fmtRp(p.original_price)}
                </td>
                <td style={{ textAlign: 'center' }}>{p.includes_physio_voucher ? 'Ya' : '-'}</td>
                <td style={{ textAlign: 'center' }}>{p.sort_order}</td>
                <td>
                  <span className={`badge ${p.is_active ? 'badge-confirmed' : 'badge-cancelled'}`}>
                    {p.is_active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => openEdit(p)}>Edit</button>
                  <button className="action-btn" onClick={() => toggleActive(p)}>
                    {p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Paket' : 'Tambah Paket'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Nama Paket *</label>
                <input type="text" value={f.name || ''} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
                {brokenName && (
                  <p style={{ fontSize: 12, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '8px 10px', margin: '8px 0 0', lineHeight: 1.5 }}>
                    <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                    Sistem booking mengenali paket Youngstars HANYA dari nama yang diawali persis{' '}
                    <strong style={{ fontFamily: 'monospace' }}>{YOUNGSTARS_NAME_MARKER}</strong> (huruf besar-kecil harus sama).
                    Nama ini <strong>tidak akan dikenali</strong> — tab Youngstars di booking.20fit.id dan validasi
                    voucher paket Youngstars akan rusak tanpa peringatan.
                  </p>
                )}
                {!brokenName && lostMarker && (
                  <p style={{ fontSize: 12, color: '#B91C1C', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 6, padding: '8px 10px', margin: '8px 0 0', lineHeight: 1.5 }}>
                    <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                    Paket ini semula bernama <strong>{originalName}</strong> dan dikenali sistem booking sebagai
                    paket Youngstars. Nama baru tidak lagi diawali{' '}
                    <strong style={{ fontFamily: 'monospace' }}>{YOUNGSTARS_NAME_MARKER}</strong> — tab Youngstars
                    dan validasi voucher paket Youngstars akan rusak.
                  </p>
                )}
                {isYoungstarsName(name) && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 10px', margin: '8px 0 0', lineHeight: 1.5 }}>
                    Nama diawali <span style={{ fontFamily: 'monospace' }}>{YOUNGSTARS_NAME_MARKER}</span> — paket ini
                    diperlakukan sebagai paket Youngstars oleh sistem booking (tab terpisah + voucher hanya bisa
                    dipakai untuk kelas Youngstars).
                  </p>
                )}
              </div>
              <div className="form-group">
                <label>Deskripsi</label>
                <textarea rows={2} value={f.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Sessions *</label>
                  <input type="number" min={1} value={f.sessions || ''} onChange={e => setForm(p => ({ ...p, sessions: Number(e.target.value) }))} required />
                </div>
                <div className="form-group">
                  <label>Sort Order</label>
                  <input type="number" value={f.sort_order ?? 0} onChange={e => setForm(p => ({ ...p, sort_order: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Harga (Rp) *</label>
                  <input type="number" min={0} value={f.price ?? ''} onChange={e => setForm(p => ({ ...p, price: Number(e.target.value) }))} required />
                </div>
                <div className="form-group">
                  <label>Harga Coret (Rp) *</label>
                  <input type="number" min={0} value={f.original_price ?? ''} onChange={e => setForm(p => ({ ...p, original_price: Number(e.target.value) }))} required />
                </div>
              </div>
              {(f.original_price ?? 0) > 0 && (f.original_price ?? 0) < (f.price ?? 0) && (
                <p style={{ fontSize: 12, color: '#92400E', background: '#FEF3C7', borderRadius: 6, padding: '8px 10px', margin: '0 0 12px', lineHeight: 1.5 }}>
                  Harga coret lebih kecil dari harga jual — coretan diskon tidak akan tampil di halaman customer.
                  Biasanya harga coret ≥ harga jual.
                </p>
              )}
              <div style={{ display: 'flex', gap: 20, marginBottom: 16 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14 }}>
                  <input type="checkbox" checked={f.includes_physio_voucher ?? false} onChange={e => setForm(p => ({ ...p, includes_physio_voucher: e.target.checked }))} />
                  Termasuk Physio Voucher
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

      {/* Konfirmasi eksplisit — nama berisiko merusak deteksi Youngstars di sistem booking */}
      {showYoungstarsConfirm && (
        <div className="modal-overlay" style={{ zIndex: 60 }}>
          <div className="modal-box" style={{ maxWidth: 440 }}>
            <h3 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={18} color="#B91C1C" /> Yakin simpan nama ini?
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Nama <strong>{name}</strong> tidak diawali persis{' '}
              <strong style={{ fontFamily: 'monospace' }}>{YOUNGSTARS_NAME_MARKER}</strong>.
              {lostMarker
                ? ' Paket ini akan BERHENTI dikenali sebagai paket Youngstars oleh sistem booking:'
                : ' Kalau paket ini dimaksudkan sebagai paket Youngstars, sistem booking TIDAK akan mengenalinya:'}
            </p>
            <ul style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, paddingLeft: 20, margin: '8px 0 16px' }}>
              <li>Paket hilang dari tab HYROX Youngstars di booking.20fit.id</li>
              <li>Validasi redeem voucher paket Youngstars ikut rusak (voucher bisa dipakai ke kelas yang salah, atau ditolak)</li>
            </ul>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Lanjutkan hanya jika Anda yakin paket ini memang <strong>bukan</strong> paket Youngstars.
            </p>
            <div className="modal-footer">
              <button type="button" className="btn-secondary" onClick={() => setShowYoungstarsConfirm(false)}>Batal, perbaiki nama</button>
              <button
                type="button"
                onClick={doSave}
                disabled={saving}
                style={{ padding: '8px 20px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, cursor: saving ? 'default' : 'pointer', fontWeight: 600, opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Menyimpan...' : 'Ya, Simpan Nama Ini'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
