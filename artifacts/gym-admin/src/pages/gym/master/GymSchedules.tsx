import React, { useState, useEffect, useCallback } from 'react'
import { supabase, fmtTime, ConfirmModal } from '@workspace/admin-shared'

// Jadwal kelas gym per tanggal. Instruktur disimpan sbg TEXT (nama coach), pola
// sama arena_class_schedules.instructor. Booked = jumlah booking non-cancelled.
const todayISO = () => new Date().toISOString().slice(0, 10)
const shiftDay = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}
const HOURS = Array.from({ length: 16 }, (_, i) => 6 + i) // 6..21
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`
const nextHour = (start: string) => hh(parseInt(start.slice(0, 2)) + 1)
const fmtLongID = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

interface ClassTypeOpt { id: string; name: string; color: string; quota: number }
interface CoachOpt { id: string; name: string }
interface Schedule {
  id: string; class_type_id: string; instructor: string; schedule_date: string;
  start_time: string; end_time: string; quota: number; is_cancelled: boolean;
  class_type: { name: string; color: string } | null
}

export default function GymSchedules() {
  const [date, setDate] = useState(todayISO)
  const [rows, setRows] = useState<Schedule[]>([])
  const [booked, setBooked] = useState<Record<string, number>>({})
  const [classTypes, setClassTypes] = useState<ClassTypeOpt[]>([])
  const [coaches, setCoaches] = useState<CoachOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [classTypeId, setClassTypeId] = useState('')
  const [instructor, setInstructor] = useState('')
  const [startTime, setStartTime] = useState('07:00')
  const [endTime, setEndTime] = useState('08:00')
  const [quota, setQuota] = useState(10)
  const [saving, setSaving] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState<Schedule | null>(null)

  const fetchOptions = useCallback(async () => {
    const [ct, co] = await Promise.all([
      supabase.from('gym_class_types').select('id, name, color, quota').eq('is_active', true).order('name'),
      supabase.from('gym_coaches').select('id, name').eq('is_active', true).order('name'),
    ])
    setClassTypes((ct.data as ClassTypeOpt[]) || [])
    setCoaches((co.data as CoachOpt[]) || [])
  }, [])

  const fetchSchedules = useCallback(async () => {
    setLoading(true)
    const { data, error: err } = await supabase
      .from('gym_class_schedules')
      .select('id, class_type_id, instructor, schedule_date, start_time, end_time, quota, is_cancelled, class_type:gym_class_types(name, color)')
      .eq('schedule_date', date)
      .order('start_time')
    if (err) { setError(err.message); setLoading(false); return }
    const list = (data as unknown as Schedule[]) || []
    setRows(list)
    const ids = list.map(s => s.id)
    if (ids.length > 0) {
      const { data: bk } = await supabase
        .from('gym_class_bookings')
        .select('schedule_id, status')
        .in('schedule_id', ids)
        .neq('status', 'cancelled')
      const tally: Record<string, number> = {}
      ;(bk || []).forEach((b: Record<string, unknown>) => {
        const sid = b.schedule_id as string
        tally[sid] = (tally[sid] || 0) + 1
      })
      setBooked(tally)
    } else {
      setBooked({})
    }
    setError('')
    setLoading(false)
  }, [date])

  useEffect(() => { fetchOptions() }, [fetchOptions])
  useEffect(() => { fetchSchedules() }, [fetchSchedules])

  const onSelectClassType = (id: string) => {
    setClassTypeId(id)
    const ct = classTypes.find(c => c.id === id)
    if (ct) setQuota(ct.quota || 10)
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!classTypeId) { setError('Pilih tipe kelas'); return }
    if (!instructor) { setError('Pilih instruktur'); return }
    if (endTime <= startTime) { setError('Jam selesai harus setelah jam mulai'); return }
    setSaving(true)
    const { error: err } = await supabase.from('gym_class_schedules').insert({
      class_type_id: classTypeId, instructor, schedule_date: date,
      start_time: startTime, end_time: endTime, quota,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setError('')
    fetchSchedules()
  }

  const toggleCancel = async (s: Schedule) => {
    await supabase.from('gym_class_schedules').update({ is_cancelled: !s.is_cancelled }).eq('id', s.id)
    fetchSchedules()
  }

  const handleDelete = async (s: Schedule) => {
    const { error: err } = await supabase.from('gym_class_schedules').delete().eq('id', s.id)
    setConfirmDelete(null)
    if (err) { setError(err.message); return }
    fetchSchedules()
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Jadwal Kelas</h2>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <button className="btn-secondary" onClick={() => setDate(d => shiftDay(d, -1))}>← Sebelumnya</button>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{fmtLongID(date)}</div>
          {date !== todayISO() && (
            <button onClick={() => setDate(todayISO())} style={{ background: 'none', border: 'none', color: 'var(--red)', fontSize: 12, cursor: 'pointer', marginTop: 2 }}>
              Kembali ke hari ini
            </button>
          )}
        </div>
        <button className="btn-secondary" onClick={() => setDate(d => shiftDay(d, 1))}>Berikutnya →</button>
      </div>

      <div style={{ marginBottom: 24 }}>
        {loading ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Memuat...</div>
        ) : rows.length === 0 ? (
          <div className="card" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
            Belum ada jadwal untuk tanggal ini. Tambah di bawah.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {rows.map(s => {
              const used = booked[s.id] || 0
              const left = s.quota - used
              const color = s.is_cancelled ? '#6B7280' : left <= 0 ? '#DC2626' : left <= 2 ? '#D97706' : '#059669'
              return (
                <div key={s.id} className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', opacity: s.is_cancelled ? 0.6 : 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 15, fontWeight: 700, minWidth: 120 }}>
                      {fmtTime(s.start_time)}–{fmtTime(s.end_time)}
                    </span>
                    <span style={{ fontWeight: 600 }}>
                      <span style={{ color: s.class_type?.color || '#C0392B', marginRight: 6 }}>●</span>
                      {s.class_type?.name || '(kelas)'}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>👤 {s.instructor}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color }}>
                      {s.is_cancelled ? 'Dibatalkan' : `${used} / ${s.quota} terisi`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, whiteSpace: 'nowrap' }}>
                    <button className="action-btn" onClick={() => toggleCancel(s)}>
                      {s.is_cancelled ? 'Aktifkan' : 'Batalkan'}
                    </button>
                    {used === 0 && (
                      <button className="action-btn cancel" onClick={() => setConfirmDelete(s)}>Hapus</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 600 }}>Tambah Jadwal</h3>
        <form onSubmit={handleAdd}>
          <div className="form-row">
            <div className="form-group">
              <label>Tipe Kelas *</label>
              <select value={classTypeId} onChange={e => onSelectClassType(e.target.value)} required>
                <option value="">— Pilih kelas —</option>
                {classTypes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Instruktur *</label>
              <select value={instructor} onChange={e => setInstructor(e.target.value)} required>
                <option value="">— Pilih coach —</option>
                {coaches.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Jam Mulai</label>
              <select value={startTime} onChange={e => { setStartTime(e.target.value); if (endTime <= e.target.value) setEndTime(nextHour(e.target.value)) }}>
                {HOURS.map(h => <option key={h} value={hh(h)}>{hh(h)}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Jam Selesai</label>
              <select value={endTime} onChange={e => setEndTime(e.target.value)}>
                {HOURS.map(h => hh(h)).filter(t => t > startTime).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Kuota</label>
              <input type="number" min={1} value={quota} onChange={e => setQuota(Math.max(1, Number(e.target.value)))} />
            </div>
          </div>
          <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={saving || classTypes.length === 0}>
            {saving ? 'Menyimpan...' : 'Tambah Jadwal'}
          </button>
          {classTypes.length === 0 && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
              Belum ada tipe kelas aktif — tambah di menu Class Types dulu.
            </p>
          )}
        </form>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Hapus Jadwal"
          message={`Hapus jadwal ${confirmDelete.class_type?.name || ''} ${fmtTime(confirmDelete.start_time)}?`}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
          danger
        />
      )}
    </div>
  )
}
