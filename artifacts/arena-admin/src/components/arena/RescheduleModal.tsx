import React, { useState, useEffect } from 'react'
import { supabase } from '@workspace/admin-shared'
import { fmtDate, fmtTime } from '@workspace/admin-shared'

interface Props {
  booking: Record<string, unknown>
  onClose: () => void
  onRefresh: () => void
}

interface Schedule {
  id: string; schedule_date: string; start_time: string; end_time: string;
  instructor: string; quota: number; is_cancelled: boolean;
  class_type?: { id: string; name: string; color: string };
}

export default function RescheduleModal({ booking, onClose, onRefresh }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [bookedCounts, setBookedCounts] = useState<Record<string, number>>({})

  const currentSchedule = booking.schedule as Record<string, unknown> | undefined

  useEffect(() => {
    const fetchAvailableSchedules = async () => {
      setLoading(true)
      const today = new Date().toISOString().slice(0, 10)
      const { data, error: err } = await supabase
        .from('arena_class_schedules')
        .select(`
          id, schedule_date, start_time, end_time, instructor, quota, is_cancelled,
          class_type:arena_class_types(id, name, color)
        `)
        .eq('is_cancelled', false)
        .gte('schedule_date', today)
        .neq('id', booking.schedule_id as string)
        .order('schedule_date', { ascending: true })
        .order('start_time', { ascending: true })

      if (err) { setError(err.message); setLoading(false); return }

      const rows = (data || []) as unknown as Schedule[]
      const ids = rows.map(s => s.id)
      if (ids.length > 0) {
        const { data: bookings } = await supabase
          .from('arena_class_bookings')
          .select('schedule_id')
          .in('schedule_id', ids)
          .eq('status', 'confirmed')
        const counts: Record<string, number> = {}
        for (const b of (bookings || [])) counts[b.schedule_id] = (counts[b.schedule_id] || 0) + 1
        setBookedCounts(counts)
      }
      setSchedules(rows)
      setLoading(false)
    }
    fetchAvailableSchedules()
  }, [booking.schedule_id])

  const getSisa = (s: Schedule) => s.quota - (bookedCounts[s.id] || 0)

  const handleReschedule = async () => {
    if (!selected) { setError('Pilih jadwal tujuan dulu'); return }
    const target = schedules.find(s => s.id === selected)
    if (!target) return
    if (getSisa(target) <= 0) { setError('Jadwal ini sudah penuh, pilih jadwal lain'); return }
    setSubmitting(true)
    setError('')
    const { error: err } = await supabase
      .from('arena_class_bookings')
      .update({ schedule_id: selected, updated_at: new Date().toISOString() })
      .eq('id', booking.id as string)
    if (err) { setError(err.message); setSubmitting(false); return }
    onRefresh()
    onClose()
  }

  const currentCt = currentSchedule?.class_type as Record<string, unknown> | undefined

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Pindah Jadwal</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
        </div>

        {/* Info booking saat ini */}
        <div style={{
          background: 'var(--bg-page)', border: '1px solid var(--border)',
          borderRadius: 6, padding: '12px 16px', marginBottom: 20, fontSize: 14,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{booking.full_name as string}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12, fontFamily: 'monospace' }}>{booking.booking_code as string}</div>
          <div style={{ marginTop: 8, fontSize: 13 }}>
            <span style={{ color: 'var(--text-muted)' }}>Jadwal sekarang: </span>
            {!!currentCt?.color && <span style={{ color: currentCt.color as string, marginRight: 4 }}>●</span>}
            {currentCt?.name as string} — {fmtDate(currentSchedule?.schedule_date as string)}{' '}
            {fmtTime(currentSchedule?.start_time as string)}–{fmtTime(currentSchedule?.end_time as string)}{' '}
            ({currentSchedule?.instructor as string})
          </div>
        </div>

        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>Pilih Jadwal Baru</div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 14, padding: '20px 0' }}>Memuat jadwal...</p>
        ) : schedules.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 14, padding: '20px 0' }}>Tidak ada jadwal tersedia</p>
        ) : (
          <div style={{ maxHeight: 360, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
            <table className="data-table" style={{ margin: 0 }}>
              <thead>
                <tr>
                  <th style={{ width: 36 }}></th>
                  <th>Tanggal</th><th>Kelas</th><th>Instruktur</th><th>Waktu</th><th>Sisa</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => {
                  const sisa = getSisa(s)
                  const full = sisa <= 0
                  return (
                    <tr
                      key={s.id}
                      onClick={() => !full && setSelected(s.id)}
                      style={{
                        cursor: full ? 'not-allowed' : 'pointer',
                        opacity: full ? 0.5 : 1,
                        background: selected === s.id ? '#FEF3F2' : undefined,
                      }}
                    >
                      <td>
                        <input
                          type="radio"
                          checked={selected === s.id}
                          onChange={() => !full && setSelected(s.id)}
                          disabled={full}
                          style={{ accentColor: 'var(--red)' }}
                        />
                      </td>
                      <td style={{ fontSize: 13 }}>{fmtDate(s.schedule_date)}</td>
                      <td style={{ fontSize: 13 }}>
                        {s.class_type?.color && <span style={{ color: s.class_type.color, marginRight: 4 }}>●</span>}
                        {s.class_type?.name}
                      </td>
                      <td style={{ fontSize: 13 }}>{s.instructor}</td>
                      <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtTime(s.start_time)}–{fmtTime(s.end_time)}</td>
                      <td style={{ fontSize: 13 }}>
                        <span style={{ color: full || sisa <= 3 ? 'var(--red)' : 'inherit', fontWeight: sisa <= 3 ? 600 : 400 }}>
                          {full ? 'Penuh' : `${sisa} slot`}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={submitting}>Batal</button>
          <button
            className="btn-primary"
            onClick={handleReschedule}
            disabled={!selected || submitting}
          >
            {submitting ? 'Memproses...' : 'Pindah Jadwal'}
          </button>
        </div>
      </div>
    </div>
  )
}
