import React, { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../../lib/supabase'
import { fmtDate, fmtTime } from '../../../lib/format'
import ConfirmModal from '../../../components/arena/ConfirmModal'

interface BlockedSlot { id: string; unit_id: string; blocked_date: string; start_time: string; end_time: string; reason: string; created_at: string }
interface Unit { id: string; name: string }

const emptyForm = () => ({ unit_id: '', blocked_date: '', start_time: '', end_time: '', reason: '' })

export default function ArenaBlockedSlots() {
  const [data, setData] = useState<BlockedSlot[]>([])
  const [units, setUnits] = useState<Unit[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<BlockedSlot | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [unitFilter, setUnitFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase.from('arena_blocked_slots').select('*').order('blocked_date', { ascending: false })
    if (unitFilter !== 'all') q = q.eq('unit_id', unitFilter)
    if (dateFrom) q = q.gte('blocked_date', dateFrom)
    if (dateTo) q = q.lte('blocked_date', dateTo)
    const { data: rows, error: err } = await q
    if (err) setError(err.message)
    else setData(rows as BlockedSlot[])
    setLoading(false)
  }, [unitFilter, dateFrom, dateTo])

  useEffect(() => {
    supabase.from('arena_booking_units').select('id, name').order('name').then(({ data }) => { if (data) setUnits(data as Unit[]) })
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.unit_id || !form.blocked_date || !form.start_time || !form.end_time) return setFormError('Semua field wajib diisi')
    setSaving(true)
    const { error: err } = await supabase.from('arena_blocked_slots').insert({ ...form, created_at: new Date().toISOString() })
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false); setForm(emptyForm()); fetchData()
  }

  const handleDelete = async (slot: BlockedSlot) => {
    await supabase.from('arena_blocked_slots').delete().eq('id', slot.id)
    setConfirmDelete(null); fetchData()
  }

  const unitMap = Object.fromEntries(units.map(u => [u.id, u.name]))

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Blocked Slots</h2>
        <button className="btn-primary" onClick={() => { setForm(emptyForm()); setFormError(''); setShowModal(true) }}>+ Tambah Block</button>
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <select value={unitFilter} onChange={e => setUnitFilter(e.target.value)}>
          <option value="all">Semua Unit</option>
          {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Dari tanggal" />
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Sampai tanggal" />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead><tr><th>Unit</th><th>Tanggal</th><th>Waktu</th><th>Alasan</th><th>Aksi</th></tr></thead>
          <tbody>
            {loading ? <tr className="loading-row"><td colSpan={5}>Memuat...</td></tr>
              : data.length === 0 ? <tr><td colSpan={5} className="empty-state">Tidak ada blocked slot</td></tr>
              : data.map(s => (
                <tr key={s.id}>
                  <td>{unitMap[s.unit_id] || s.unit_id}</td>
                  <td>{fmtDate(s.blocked_date)}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(s.start_time)} – {fmtTime(s.end_time)}</td>
                  <td>{s.reason}</td>
                  <td>
                    <button className="action-btn cancel" onClick={() => setConfirmDelete(s)}>Hapus</button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 480 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Tambah Blocked Slot</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Unit *</label>
                <select value={form.unit_id} onChange={e => setForm(p => ({ ...p, unit_id: e.target.value }))} required>
                  <option value="">Pilih unit...</option>
                  {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>
              <div className="form-group"><label>Tanggal *</label><input type="date" value={form.blocked_date} onChange={e => setForm(p => ({ ...p, blocked_date: e.target.value }))} required /></div>
              <div className="form-row">
                <div className="form-group"><label>Jam Mulai *</label><input type="time" value={form.start_time} onChange={e => setForm(p => ({ ...p, start_time: e.target.value }))} required /></div>
                <div className="form-group"><label>Jam Selesai *</label><input type="time" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} required /></div>
              </div>
              <div className="form-group"><label>Alasan</label><input value={form.reason} onChange={e => setForm(p => ({ ...p, reason: e.target.value }))} /></div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelete && (
        <ConfirmModal
          title="Hapus Blocked Slot"
          message={`Hapus blocked slot tanggal ${fmtDate(confirmDelete.blocked_date)}?`}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}
    </div>
  )
}
