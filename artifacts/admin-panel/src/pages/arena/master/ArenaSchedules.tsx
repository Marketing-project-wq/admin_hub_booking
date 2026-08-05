import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useAuth } from '../../../context/AuthContext'
import { fmtDate, fmtTime } from '../../../lib/format'
import ConfirmModal from '../../../components/arena/ConfirmModal'

const UNIT_ID = '6e8f44a7-23d4-4602-90d4-980c63b3acc2'

interface Schedule {
  id: string; class_type_id: string; unit_id: string; schedule_date: string;
  start_time: string; end_time: string; instructor: string; quota: number;
  notes: string | null; is_cancelled: boolean; cancelled_reason: string | null;
  cutoff_minutes: number | null; created_at: string;
  class_type?: { id: string; name: string; color: string; duration_min: number };
  booked_count?: number;
}
interface ClassType { id: string; name: string; color: string; duration_min: number }
interface Coach { id: string; name: string }

const DAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

const emptyForm = () => ({
  class_type_id: '', instructor: '', schedule_date: '',
  start_time: '', end_time: '', quota: 10, notes: '',
  cutoff_minutes: '' as string | number,
})

const emptyBulk = () => ({
  class_type_id: '', instructor: '', start_time: '', quota: 10,
  days: [] as number[], date_from: '', date_to: '',
})

const todayStr = () => new Date().toISOString().slice(0, 10)
const next7Str = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

// Kandidat jadwal tujuan untuk opsi "pindahkan dulu, baru batalkan"
interface MoveTarget {
  id: string; schedule_date: string; start_time: string; end_time: string;
  instructor: string; quota: number; confirmed: number;
  class_type?: { name: string; color: string } | null;
}

export default function ArenaSchedules() {
  const { user } = useAuth()
  const [data, setData] = useState<Schedule[]>([])
  const [classTypes, setClassTypes] = useState<ClassType[]>([])
  const [coaches, setCoaches] = useState<Coach[]>([])
  const [unitCutoff, setUnitCutoff] = useState(60)
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState(emptyForm())
  const [bulk, setBulk] = useState(emptyBulk())
  const [bulkPreview, setBulkPreview] = useState<string[]>([])
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmCancel, setConfirmCancel] = useState<Schedule | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<Schedule | null>(null)

  // Guard cancel: jumlah booking confirmed di-fetch FRESH saat modal dibuka
  // (booked_count dari list bisa basi). null = masih memeriksa.
  const [cancelConfirmedCount, setCancelConfirmedCount] = useState<number | null>(null)
  const [ackCancel, setAckCancel] = useState(false)
  const [cancelBusy, setCancelBusy] = useState(false)
  const [cancelError, setCancelError] = useState('')
  // Opsi "pindahkan dulu, baru batalkan" (pola RescheduleModal, versi massal)
  const [moveMode, setMoveMode] = useState(false)
  const [moveTargets, setMoveTargets] = useState<MoveTarget[]>([])
  const [moveTargetsLoading, setMoveTargetsLoading] = useState(false)
  const [moveTargetId, setMoveTargetId] = useState<string | null>(null)
  // Guard bulk cancel: daftar jadwal terpilih yang masih punya booking confirmed
  const [bulkAffected, setBulkAffected] = useState<{ s: Schedule; count: number }[]>([])
  const [ackBulk, setAckBulk] = useState(false)
  const [bulkChecking, setBulkChecking] = useState(false)

  // Filters
  const [dateFrom, setDateFrom] = useState(todayStr)
  const [dateTo, setDateTo] = useState(next7Str)
  const [ctFilter, setCtFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('active')
  const [search, setSearch] = useState('')

  // Bulk select
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showBulkConfirm, setShowBulkConfirm] = useState(false)
  const [bulkLoading, setBulkLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('arena_class_types').select('id, name, color, duration_min').order('name'),
      supabase.from('arena_coaches').select('id, name').eq('is_active', true).order('name'),
      supabase.from('arena_booking_units').select('cutoff_minutes').eq('id', UNIT_ID).single(),
    ]).then(([ct, c, unit]) => {
      if (ct.data) setClassTypes(ct.data as ClassType[])
      if (c.data) setCoaches(c.data as Coach[])
      if (unit.data) setUnitCutoff((unit.data as { cutoff_minutes: number }).cutoff_minutes ?? 60)
    })
  }, [])

  // Clear selection when filters change
  useEffect(() => {
    setSelected(new Set())
  }, [dateFrom, dateTo, ctFilter, statusFilter])

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('arena_class_schedules')
      .select(`
        id, class_type_id, unit_id, schedule_date, start_time, end_time,
        instructor, quota, notes, is_cancelled, cancelled_reason, cutoff_minutes, created_at,
        class_type:arena_class_types(id, name, color, duration_min)
      `)
      .gte('schedule_date', dateFrom)
      .lte('schedule_date', dateTo)
      .order('schedule_date', { ascending: true })
      .order('start_time', { ascending: true })
    if (ctFilter !== 'all') q = q.eq('class_type_id', ctFilter)
    if (statusFilter === 'active') q = q.eq('is_cancelled', false)
    if (statusFilter === 'cancelled') q = q.eq('is_cancelled', true)

    const { data: rows, error: err } = await q
    if (err) { setError(err.message); setLoading(false); return }

    const schedules = (rows || []) as unknown as Schedule[]
    if (schedules.length > 0) {
      const ids = schedules.map(s => s.id)
      const { data: bookings } = await supabase
        .from('arena_class_bookings')
        .select('schedule_id')
        .in('schedule_id', ids)
        .eq('status', 'confirmed')
      const counts: Record<string, number> = {}
      for (const b of (bookings || [])) counts[b.schedule_id] = (counts[b.schedule_id] || 0) + 1
      setData(schedules.map(s => ({ ...s, booked_count: counts[s.id] || 0 })))
    } else {
      setData([])
    }
    setLoading(false)
  }, [dateFrom, dateTo, ctFilter, statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const autoEndTime = (start: string, ctId: string) => {
    const ct = classTypes.find(c => c.id === ctId)
    if (!start || !ct) return ''
    const [h, m] = start.split(':').map(Number)
    const total = h * 60 + m + ct.duration_min
    return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
  }

  const openAdd = () => { setForm(emptyForm()); setEditId(null); setFormError(''); setShowModal(true) }
  const openEdit = (s: Schedule) => {
    setForm({
      class_type_id: s.class_type_id, instructor: s.instructor,
      schedule_date: s.schedule_date, start_time: s.start_time.slice(0, 5),
      end_time: s.end_time.slice(0, 5), quota: s.quota, notes: s.notes || '',
      cutoff_minutes: s.cutoff_minutes !== null ? s.cutoff_minutes : '',
    })
    setEditId(s.id); setFormError(''); setShowModal(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.class_type_id || !form.instructor || !form.schedule_date || !form.start_time || !form.end_time) {
      return setFormError('Semua field wajib diisi')
    }
    setSaving(true)
    const cutoffVal = form.cutoff_minutes === '' ? null : Number(form.cutoff_minutes)
    const payload = {
      class_type_id: form.class_type_id,
      unit_id: UNIT_ID,
      schedule_date: form.schedule_date,
      start_time: form.start_time,
      end_time: form.end_time,
      instructor: form.instructor,
      quota: Number(form.quota) || 10,
      notes: form.notes || null,
      cutoff_minutes: cutoffVal,
      is_cancelled: false,
      updated_at: new Date().toISOString(),
    }
    const { error: err } = editId
      ? await supabase.from('arena_class_schedules').update(payload).eq('id', editId)
      : await supabase.from('arena_class_schedules').insert({
          ...payload,
          created_by: user?.full_name || 'admin',
          created_at: new Date().toISOString(),
        })
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowModal(false); fetchData()
  }

  // Buka modal cancel/reaktivasi + fetch FRESH jumlah booking confirmed (guard)
  const openCancelModal = async (s: Schedule) => {
    setConfirmCancel(s); setCancelReason(''); setCancelError('')
    setAckCancel(false); setMoveMode(false); setMoveTargetId(null); setMoveTargets([])
    if (s.is_cancelled) { setCancelConfirmedCount(0); return }   // arah reaktivasi — tanpa guard
    setCancelConfirmedCount(null)
    const { count } = await supabase
      .from('arena_class_bookings')
      .select('id', { count: 'exact', head: true })
      .eq('schedule_id', s.id)
      .eq('status', 'confirmed')
    setCancelConfirmedCount(count ?? 0)
  }

  const closeCancelModal = () => {
    setConfirmCancel(null); setCancelReason(''); setCancelError('')
    setAckCancel(false); setMoveMode(false); setMoveTargetId(null); setMoveTargets([])
    setCancelConfirmedCount(null)
  }

  // Jadwal tujuan pemindahan: aktif, mendatang, bukan jadwal ini (pola RescheduleModal)
  const fetchMoveTargets = async (current: Schedule) => {
    setMoveTargetsLoading(true)
    const { data: rows } = await supabase
      .from('arena_class_schedules')
      .select('id, schedule_date, start_time, end_time, instructor, quota, class_type:arena_class_types(name, color)')
      .eq('is_cancelled', false)
      .gte('schedule_date', todayStr())
      .neq('id', current.id)
      .order('schedule_date', { ascending: true })
      .order('start_time', { ascending: true })
    const targets = (rows || []) as unknown as MoveTarget[]
    const ids = targets.map(t => t.id)
    const counts: Record<string, number> = {}
    if (ids.length > 0) {
      const { data: bookings } = await supabase
        .from('arena_class_bookings')
        .select('schedule_id')
        .in('schedule_id', ids)
        .eq('status', 'confirmed')
      for (const b of (bookings || [])) counts[b.schedule_id] = (counts[b.schedule_id] || 0) + 1
    }
    setMoveTargets(targets.map(t => ({ ...t, confirmed: counts[t.id] || 0 })))
    setMoveTargetsLoading(false)
  }

  const handleToggleCancel = async (s: Schedule) => {
    setCancelBusy(true); setCancelError('')
    try {
      const { error: err } = s.is_cancelled
        ? await supabase.from('arena_class_schedules').update({
            is_cancelled: false, cancelled_reason: null, updated_at: new Date().toISOString(),
          }).eq('id', s.id)
        : await supabase.from('arena_class_schedules').update({
            is_cancelled: true, cancelled_reason: cancelReason || null, updated_at: new Date().toISOString(),
          }).eq('id', s.id)
      if (err) throw err
      closeCancelModal(); fetchData()
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Gagal memproses')
    } finally {
      setCancelBusy(false)
    }
  }

  // Pindahkan SEMUA booking confirmed ke jadwal tujuan, LALU batalkan jadwal.
  // Urutan aman: kalau pemindahan gagal, jadwal tidak jadi dibatalkan.
  const handleMoveAndCancel = async () => {
    if (!confirmCancel || !moveTargetId) return
    setCancelBusy(true); setCancelError('')
    try {
      const { error: mvErr } = await supabase
        .from('arena_class_bookings')
        .update({ schedule_id: moveTargetId, updated_at: new Date().toISOString() })
        .eq('schedule_id', confirmCancel.id)
        .eq('status', 'confirmed')
      if (mvErr) throw mvErr
      const { error: cErr } = await supabase.from('arena_class_schedules').update({
        is_cancelled: true, cancelled_reason: cancelReason || null, updated_at: new Date().toISOString(),
      }).eq('id', confirmCancel.id)
      if (cErr) throw new Error(`Peserta sudah dipindahkan, tapi jadwal gagal dibatalkan: ${cErr.message}. Coba Cancel lagi.`)
      closeCancelModal(); fetchData()
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : 'Gagal memindahkan peserta')
    } finally {
      setCancelBusy(false)
    }
  }

  // Guard bulk: cek booking confirmed semua jadwal terpilih sebelum konfirmasi
  const openBulkConfirm = async () => {
    setBulkChecking(true); setAckBulk(false)
    const ids = Array.from(selected)
    const { data: bookings } = await supabase
      .from('arena_class_bookings')
      .select('schedule_id')
      .in('schedule_id', ids)
      .eq('status', 'confirmed')
    const counts: Record<string, number> = {}
    for (const b of (bookings || [])) counts[b.schedule_id] = (counts[b.schedule_id] || 0) + 1
    const affected = data
      .filter(s => selected.has(s.id) && (counts[s.id] || 0) > 0)
      .map(s => ({ s, count: counts[s.id] || 0 }))
    setBulkAffected(affected)
    setBulkChecking(false)
    setShowBulkConfirm(true)
  }

  const handleDelete = async (s: Schedule) => {
    await supabase.from('arena_class_schedules').delete().eq('id', s.id)
    setConfirmDelete(null); fetchData()
  }

  const handleBulkCancel = async () => {
    setBulkLoading(true)
    try {
      const ids = Array.from(selected)
      const { error: err } = await supabase
        .from('arena_class_schedules')
        .update({
          is_cancelled: true,
          cancelled_reason: 'Dibatalkan oleh admin',
          updated_at: new Date().toISOString(),
        })
        .in('id', ids)
      if (err) throw err
      setSelected(new Set())
      setShowBulkConfirm(false)
      fetchData()
    } catch (err) {
      console.error('Bulk cancel error:', err)
    } finally {
      setBulkLoading(false)
    }
  }

  const resetFilters = () => {
    setDateFrom(todayStr())
    setDateTo(next7Str())
    setCtFilter('all')
    setStatusFilter('active')
    setSearch('')
  }

  // Bulk preview for recurring schedule creation
  useEffect(() => {
    if (!bulk.date_from || !bulk.date_to || bulk.days.length === 0) { setBulkPreview([]); return }
    const dates: string[] = []
    const cur = new Date(bulk.date_from)
    const end = new Date(bulk.date_to)
    while (cur <= end) {
      if (bulk.days.includes(cur.getDay())) dates.push(cur.toISOString().slice(0, 10))
      cur.setDate(cur.getDate() + 1)
    }
    setBulkPreview(dates)
  }, [bulk.date_from, bulk.date_to, bulk.days])

  const handleBulkSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!bulk.class_type_id || !bulk.instructor || !bulk.start_time || bulkPreview.length === 0) {
      return setFormError('Lengkapi semua field')
    }
    setSaving(true)
    const endTime = autoEndTime(bulk.start_time, bulk.class_type_id)
    const rows = bulkPreview.map(d => ({
      class_type_id: bulk.class_type_id,
      unit_id: UNIT_ID,
      schedule_date: d,
      start_time: bulk.start_time,
      end_time: endTime,
      instructor: bulk.instructor,
      quota: bulk.quota,
      notes: null,
      cutoff_minutes: null,
      is_cancelled: false,
      created_by: user?.full_name || 'admin',
      created_at: new Date().toISOString(),
    }))
    const { error: err } = await supabase.from('arena_class_schedules').insert(rows)
    setSaving(false)
    if (err) { setFormError(err.message); return }
    setShowBulk(false); setBulk(emptyBulk()); setBulkPreview([]); fetchData()
  }

  const activeRows = data.filter(r => !r.is_cancelled)
  const allActiveSelected = activeRows.length > 0 && activeRows.every(r => selected.has(r.id))

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Schedules</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => { setBulk(emptyBulk()); setFormError(''); setShowBulk(true) }}>
            Buat Jadwal Berulang
          </button>
          <button className="btn-primary" onClick={openAdd}>+ Tambah Jadwal</button>
        </div>
      </div>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari instruktur atau nama kelas..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ minWidth: 220 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} title="Dari tanggal" />
          <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>s/d</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} title="Sampai tanggal" />
        </div>
        <select value={ctFilter} onChange={e => setCtFilter(e.target.value)}>
          <option value="all">Semua Class Type</option>
          {classTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="active">Aktif</option>
          <option value="cancelled">Dibatalkan</option>
          <option value="all">Semua Status</option>
        </select>
        <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={resetFilters}>
          Reset
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 40 }}>
                <input
                  type="checkbox"
                  checked={allActiveSelected}
                  onChange={e => {
                    const ids = activeRows.map(r => r.id)
                    if (e.target.checked) {
                      setSelected(prev => new Set([...prev, ...ids]))
                    } else {
                      setSelected(prev => {
                        const next = new Set(prev)
                        ids.forEach(id => next.delete(id))
                        return next
                      })
                    }
                  }}
                />
              </th>
              <th>Tanggal</th><th>Kelas</th><th>Instruktur</th><th>Waktu</th>
              <th>Quota</th><th>Booked</th><th>Sisa</th><th>Cut-off</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const sl = search.toLowerCase()
              const displayData = search
                ? data.filter(s =>
                    s.instructor?.toLowerCase().includes(sl) ||
                    s.class_type?.name?.toLowerCase().includes(sl)
                  )
                : data
              if (loading) return <tr className="loading-row"><td colSpan={11}>Memuat...</td></tr>
              if (displayData.length === 0) return <tr><td colSpan={11} className="empty-state">{search ? 'Tidak ada hasil' : 'Tidak ada jadwal'}</td></tr>
              return displayData.map(s => {
                const booked = s.booked_count || 0
                const sisa = s.quota - booked
                const isSelected = selected.has(s.id)
                const hasOverride = s.cutoff_minutes !== null
                return (
                  <tr key={s.id} className={isSelected ? 'row-selected' : ''}>
                    <td>
                      {!s.is_cancelled && (
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={e => {
                            setSelected(prev => {
                              const next = new Set(prev)
                              e.target.checked ? next.add(s.id) : next.delete(s.id)
                              return next
                            })
                          }}
                        />
                      )}
                    </td>
                    <td>{fmtDate(s.schedule_date)}</td>
                    <td>
                      {s.class_type?.color && (
                        <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: s.class_type.color, marginRight: 6 }} />
                      )}
                      {s.class_type?.name || '-'}
                    </td>
                    <td>{s.instructor}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(s.start_time)}–{fmtTime(s.end_time)}</td>
                    <td style={{ textAlign: 'center' }}>{s.quota}</td>
                    <td style={{ textAlign: 'center' }}>{booked}</td>
                    <td style={{ textAlign: 'center', color: sisa === 0 ? 'var(--red)' : 'inherit', fontWeight: sisa === 0 ? 700 : 400 }}>{sisa}</td>
                    <td style={{ fontSize: 12, color: hasOverride ? 'var(--text-primary)' : 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                      {hasOverride ? `${s.cutoff_minutes}m *` : `${unitCutoff}m`}
                    </td>
                    <td>
                      {s.is_cancelled
                        ? <span className="badge badge-cancelled">Dibatalkan</span>
                        : <span className="badge badge-confirmed">Aktif</span>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="action-btn detail" onClick={() => openEdit(s)}>Edit</button>
                      <button className="action-btn" onClick={() => openCancelModal(s)}>
                        {s.is_cancelled ? 'Aktifkan' : 'Cancel'}
                      </button>
                      {booked === 0 && (
                        <button className="action-btn cancel" onClick={() => setConfirmDelete(s)}>Hapus</button>
                      )}
                    </td>
                  </tr>
                )
              })
            })()} 
          </tbody>
        </table>
      </div>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--text-primary)', color: '#FFFFFF', borderRadius: 8,
          padding: '14px 24px', display: 'flex', alignItems: 'center', gap: 16,
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)', zIndex: 100, whiteSpace: 'nowrap',
        }}>
          <span style={{ fontSize: 14 }}><strong>{selected.size}</strong> jadwal dipilih</span>
          <button className="btn-danger" style={{ padding: '8px 16px', fontSize: 13 }} onClick={openBulkConfirm} disabled={bulkChecking}>
            {bulkChecking ? 'Memeriksa booking...' : 'Cancel Semua'}
          </button>
          <button
            style={{
              background: 'transparent', border: '1px solid rgba(255,255,255,0.3)',
              color: '#FFFFFF', borderRadius: 4, padding: '8px 16px', fontSize: 13,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
            onClick={() => setSelected(new Set())}
          >
            Batal Pilih
          </button>
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal-box">
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>{editId ? 'Edit Jadwal' : 'Tambah Jadwal'}</h3>
              <button onClick={() => setShowModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Class Type *</label>
                <select value={form.class_type_id} onChange={e => {
                  const id = e.target.value
                  setForm(p => ({ ...p, class_type_id: id, end_time: autoEndTime(p.start_time, id) }))
                }} required>
                  <option value="">Pilih kelas...</option>
                  {classTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name} ({ct.duration_min} mnt)</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Instruktur *</label>
                <select value={form.instructor} onChange={e => setForm(p => ({ ...p, instructor: e.target.value }))} required>
                  <option value="">Pilih coach...</option>
                  {coaches.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Tanggal *</label>
                  <input type="date" value={form.schedule_date} onChange={e => setForm(p => ({ ...p, schedule_date: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Quota</label>
                  <input type="number" min={1} value={form.quota} onChange={e => setForm(p => ({ ...p, quota: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Jam Mulai *</label>
                  <input type="time" value={form.start_time} onChange={e => {
                    const t = e.target.value
                    setForm(p => ({ ...p, start_time: t, end_time: autoEndTime(t, p.class_type_id) }))
                  }} required />
                </div>
                <div className="form-group">
                  <label>Jam Selesai *</label>
                  <input type="time" value={form.end_time} onChange={e => setForm(p => ({ ...p, end_time: e.target.value }))} required />
                </div>
              </div>
              <div className="form-group">
                <label>Cut-off Override (menit) <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>— opsional</span></label>
                <input
                  type="number" min={0} max={1440}
                  placeholder={`Default: ${unitCutoff} menit (dari setting unit)`}
                  value={form.cutoff_minutes}
                  onChange={e => setForm(p => ({
                    ...p,
                    cutoff_minutes: e.target.value === '' ? '' : Number(e.target.value),
                  }))}
                />
                <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 4, display: 'block' }}>
                  Kosongkan untuk pakai default unit. Isi jika jadwal ini perlu cut-off berbeda.
                </small>
              </div>
              <div className="form-group">
                <label>Notes</label>
                <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} rows={2} />
              </div>
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowModal(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Menyimpan...' : 'Simpan'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk Create Modal */}
      {showBulk && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 580 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Buat Jadwal Berulang</h3>
              <button onClick={() => setShowBulk(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
            </div>
            {formError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{formError}</p>}
            <form onSubmit={handleBulkSubmit}>
              <div className="form-row">
                <div className="form-group">
                  <label>Class Type *</label>
                  <select value={bulk.class_type_id} onChange={e => setBulk(p => ({ ...p, class_type_id: e.target.value }))} required>
                    <option value="">Pilih kelas...</option>
                    {classTypes.map(ct => <option key={ct.id} value={ct.id}>{ct.name} ({ct.duration_min} mnt)</option>)}
                  </select>
                </div>
                <div className="form-group">
                  <label>Instruktur *</label>
                  <select value={bulk.instructor} onChange={e => setBulk(p => ({ ...p, instructor: e.target.value }))} required>
                    <option value="">Pilih coach...</option>
                    {coaches.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Jam Mulai *</label>
                  <input type="time" value={bulk.start_time} onChange={e => setBulk(p => ({ ...p, start_time: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Quota</label>
                  <input type="number" min={1} value={bulk.quota} onChange={e => setBulk(p => ({ ...p, quota: Number(e.target.value) }))} />
                </div>
              </div>
              <div className="form-group">
                <label>Hari</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                  {DAYS.map((d, i) => (
                    <label key={i} style={{
                      display: 'flex', gap: 4, alignItems: 'center', fontSize: 13, cursor: 'pointer',
                      padding: '4px 10px', border: `1px solid ${bulk.days.includes(i) ? 'var(--red)' : 'var(--border-strong)'}`,
                      borderRadius: 4, background: bulk.days.includes(i) ? '#fef2f2' : 'transparent',
                    }}>
                      <input type="checkbox" style={{ display: 'none' }} checked={bulk.days.includes(i)} onChange={e => {
                        setBulk(p => ({ ...p, days: e.target.checked ? [...p.days, i] : p.days.filter(x => x !== i) }))
                      }} />
                      {d}
                    </label>
                  ))}
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Dari Tanggal *</label>
                  <input type="date" value={bulk.date_from} onChange={e => setBulk(p => ({ ...p, date_from: e.target.value }))} required />
                </div>
                <div className="form-group">
                  <label>Sampai Tanggal *</label>
                  <input type="date" value={bulk.date_to} onChange={e => setBulk(p => ({ ...p, date_to: e.target.value }))} required />
                </div>
              </div>
              {bulkPreview.length > 0 && (
                <div style={{ background: 'var(--bg-page)', border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
                    Preview: {bulkPreview.length} jadwal akan dibuat
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, maxHeight: 120, overflowY: 'auto' }}>
                    {bulkPreview.map(d => (
                      <span key={d} style={{ fontSize: 11, padding: '2px 8px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 3 }}>
                        {fmtDate(d)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="modal-footer">
                <button type="button" className="btn-secondary" onClick={() => setShowBulk(false)}>Batal</button>
                <button type="submit" className="btn-primary" disabled={saving || bulkPreview.length === 0}>
                  {saving ? 'Menyimpan...' : `Buat ${bulkPreview.length} Jadwal`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Cancel confirmation with reason input + guard booking confirmed */}
      {confirmCancel && (() => {
        const cnt = cancelConfirmedCount
        const hasConfirmed = !confirmCancel.is_cancelled && (cnt ?? 0) > 0
        const eligibleTargets = moveTargets.filter(t => t.quota - t.confirmed >= (cnt ?? 0))
        return (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: hasConfirmed && moveMode ? 640 : 460 }}>
            <h3 className="modal-title">{confirmCancel.is_cancelled ? 'Reaktivasi Jadwal' : 'Cancel Jadwal'}</h3>
            <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>
              {confirmCancel.is_cancelled
                ? `Aktifkan kembali jadwal ${fmtDate(confirmCancel.schedule_date)}?`
                : `Batalkan jadwal ${fmtDate(confirmCancel.schedule_date)} ${fmtTime(confirmCancel.start_time)}?`}
            </p>

            {cancelError && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{cancelError}</p>}

            {!confirmCancel.is_cancelled && cnt === null && (
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>Memeriksa booking confirmed...</p>
            )}

            {hasConfirmed && (
              <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                <p style={{ margin: 0, fontSize: 13, color: '#991B1B', lineHeight: 1.6 }}>
                  <strong>⚠ Jadwal ini masih punya {cnt} peserta confirmed</strong> yang sudah booking/bayar.
                  Membatalkan jadwal <strong>TIDAK</strong> memindahkan atau memberi tahu mereka — booking
                  tetap ada tapi hilang dari tampilan Kalender, dan uang yang sudah masuk tidak otomatis
                  di-refund. Pindahkan peserta ke jadwal lain dulu, atau lanjutkan hanya jika benar-benar yakin.
                </p>
              </div>
            )}

            {!confirmCancel.is_cancelled && (
              <div className="form-group">
                <label>Alasan Pembatalan</label>
                <input type="text" value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Opsional..." />
              </div>
            )}

            {hasConfirmed && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginBottom: 4 }}>
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
                  <input
                    type="checkbox"
                    checked={moveMode}
                    onChange={e => {
                      setMoveMode(e.target.checked); setMoveTargetId(null)
                      if (e.target.checked && moveTargets.length === 0) fetchMoveTargets(confirmCancel)
                    }}
                    style={{ width: 'auto' }}
                  />
                  Pindahkan {cnt} peserta ke jadwal lain dulu (direkomendasikan)
                </label>

                {moveMode && (
                  <div style={{ marginTop: 10 }}>
                    {moveTargetsLoading ? (
                      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Memuat jadwal tujuan...</p>
                    ) : eligibleTargets.length === 0 ? (
                      <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        Tidak ada jadwal aktif mendatang dengan sisa kuota ≥ {cnt}.
                      </p>
                    ) : (
                      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                        {eligibleTargets.map(t => {
                          const sisa = t.quota - t.confirmed
                          return (
                            <label key={t.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                              <input type="radio" name="move-target" checked={moveTargetId === t.id} onChange={() => setMoveTargetId(t.id)} style={{ width: 'auto', accentColor: 'var(--red)' }} />
                              {t.class_type?.color && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: t.class_type.color, flexShrink: 0 }} />}
                              <span style={{ flex: 1 }}>
                                {fmtDate(t.schedule_date)} — {fmtTime(t.start_time)}–{fmtTime(t.end_time)} — {t.class_type?.name || 'Kelas'} ({t.instructor})
                              </span>
                              <span style={{ color: sisa <= 3 ? 'var(--red)' : 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{sisa} slot</span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                    <small style={{ color: 'var(--text-muted)', fontSize: 11, marginTop: 6, display: 'block' }}>
                      Hanya jadwal dengan sisa kuota ≥ {cnt} yang ditampilkan. Peserta TIDAK menerima notifikasi otomatis — kabari manual bila perlu.
                    </small>
                  </div>
                )}

                {!moveMode && (
                  <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13, marginTop: 10, color: '#991B1B' }}>
                    <input type="checkbox" checked={ackCancel} onChange={e => setAckCancel(e.target.checked)} style={{ width: 'auto', marginTop: 2 }} />
                    Saya mengerti {cnt} peserta confirmed akan tetap menempel di jadwal yang dibatalkan dan harus ditangani manual.
                  </label>
                )}
              </div>
            )}

            <div className="modal-footer">
              <button className="btn-secondary" onClick={closeCancelModal} disabled={cancelBusy}>Batal</button>
              {hasConfirmed && moveMode ? (
                <button
                  className="btn-danger"
                  onClick={handleMoveAndCancel}
                  disabled={cancelBusy || !moveTargetId}
                >
                  {cancelBusy ? 'Memproses...' : `Pindahkan ${cnt} Peserta & Batalkan`}
                </button>
              ) : (
                <button
                  className={confirmCancel.is_cancelled ? 'btn-primary' : 'btn-danger'}
                  onClick={() => handleToggleCancel(confirmCancel)}
                  disabled={cancelBusy || cnt === null || (hasConfirmed && !ackCancel)}
                >
                  {cancelBusy ? 'Memproses...' : 'Konfirmasi'}
                </button>
              )}
            </div>
          </div>
        </div>
        )
      })()}

      {confirmDelete && (
        <ConfirmModal
          title="Hapus Jadwal"
          message={`Hapus jadwal ${fmtDate(confirmDelete.schedule_date)} permanen?`}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}

      {showBulkConfirm && bulkAffected.length === 0 && (
        <ConfirmModal
          title="Cancel Jadwal"
          message={`Batalkan ${selected.size} jadwal yang dipilih? Tindakan ini tidak bisa dibatalkan.`}
          onConfirm={handleBulkCancel}
          onCancel={() => setShowBulkConfirm(false)}
          danger
          loading={bulkLoading}
        />
      )}

      {/* Bulk cancel dengan jadwal terdampak (masih ada booking confirmed) */}
      {showBulkConfirm && bulkAffected.length > 0 && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 520 }}>
            <h3 className="modal-title">Cancel {selected.size} Jadwal</h3>
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '12px 14px', marginBottom: 12 }}>
              <p style={{ margin: 0, fontSize: 13, color: '#991B1B', lineHeight: 1.6 }}>
                <strong>⚠ {bulkAffected.length} dari {selected.size} jadwal masih punya total{' '}
                {bulkAffected.reduce((n, a) => n + a.count, 0)} peserta confirmed</strong> yang sudah
                booking/bayar. Membatalkan TIDAK memindahkan atau memberi tahu mereka. Untuk memindahkan
                peserta, batalkan jadwal tersebut satu per satu lewat tombol Cancel di barisnya.
              </p>
            </div>
            <div style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 12 }}>
              {bulkAffected.map(({ s, count }) => (
                <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 12px', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
                  <span>{fmtDate(s.schedule_date)} — {fmtTime(s.start_time)} — {s.class_type?.name || 'Kelas'}</span>
                  <span style={{ color: 'var(--red)', fontWeight: 700, whiteSpace: 'nowrap' }}>{count} confirmed</span>
                </div>
              ))}
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', fontSize: 13, color: '#991B1B', marginBottom: 4 }}>
              <input type="checkbox" checked={ackBulk} onChange={e => setAckBulk(e.target.checked)} style={{ width: 'auto', marginTop: 2 }} />
              Saya mengerti peserta confirmed di jadwal-jadwal tersebut akan tetap menempel dan harus ditangani manual.
            </label>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowBulkConfirm(false)} disabled={bulkLoading}>Batal</button>
              <button className="btn-danger" onClick={handleBulkCancel} disabled={bulkLoading || !ackBulk}>
                {bulkLoading ? 'Memproses...' : `Batalkan ${selected.size} Jadwal`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
