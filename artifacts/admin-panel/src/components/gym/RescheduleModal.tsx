import React, { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtDate, fmtTime } from '../../lib/format'

// GYM — Pindah jadwal (reschedule) satu booking kelas. Pola sama dengan
// components/arena/RescheduleModal, TAPI hanya baca/tulis tabel gym_*.
// Yang diubah hanya schedule_id; status, pembayaran & kuota membership tidak disentuh.

interface Props {
  booking: Record<string, unknown>
  onClose: () => void
  onRefresh: () => void
}

interface Schedule {
  id: string; class_type_id: string; schedule_date: string; start_time: string; end_time: string;
  instructor: string; quota: number;
  class_type?: { id: string; name: string; color: string };
}

// Tanggal & jam lokal (WIB di browser admin), bukan UTC dari toISOString().
const pad = (n: number) => String(n).padStart(2, '0')
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const localNowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

const countConfirmed = async (scheduleIds: string[]) => {
  const counts: Record<string, number> = {}
  if (scheduleIds.length === 0) return counts
  const { data } = await supabase
    .from('gym_class_bookings')
    .select('schedule_id')
    .in('schedule_id', scheduleIds)
    .eq('status', 'confirmed')
  for (const b of (data || [])) counts[b.schedule_id] = (counts[b.schedule_id] || 0) + 1
  return counts
}

export default function RescheduleModal({ booking, onClose, onRefresh }: Props) {
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [bookedCounts, setBookedCounts] = useState<Record<string, number>>({})
  const [sameClassOnly, setSameClassOnly] = useState(true)

  const currentSchedule = booking.schedule as Record<string, unknown> | undefined
  const currentCt = currentSchedule?.class_type as Record<string, unknown> | undefined
  const currentClassTypeId = currentSchedule?.class_type_id as string | undefined

  useEffect(() => {
    const fetchAvailableSchedules = async () => {
      setLoading(true)
      const today = localToday()
      const { data, error: err } = await supabase
        .from('gym_class_schedules')
        .select(`
          id, class_type_id, schedule_date, start_time, end_time, instructor, quota,
          class_type:gym_class_types(id, name, color)
        `)
        .eq('is_cancelled', false)
        .gte('schedule_date', today)
        .neq('id', booking.schedule_id as string)
        .order('schedule_date', { ascending: true })
        .order('start_time', { ascending: true })

      if (err) { setError(err.message); setLoading(false); return }

      // Jadwal hari ini yang jamnya sudah lewat tidak bisa jadi tujuan.
      const now = localNowTime()
      const rows = ((data || []) as unknown as Schedule[])
        .filter(s => s.schedule_date > today || (s.start_time || '').slice(0, 5) > now)
      setBookedCounts(await countConfirmed(rows.map(s => s.id)))
      setSchedules(rows)
      setLoading(false)
    }
    fetchAvailableSchedules()
  }, [booking.schedule_id])

  const getSisa = (s: Schedule) => s.quota - (bookedCounts[s.id] || 0)

  const visible = sameClassOnly && currentClassTypeId
    ? schedules.filter(s => s.class_type_id === currentClassTypeId)
    : schedules

  const handleReschedule = async () => {
    if (!selected) { setError('Pilih jadwal tujuan dulu'); return }
    const target = schedules.find(s => s.id === selected)
    if (!target) return
    setSubmitting(true)
    setError('')
    // Cek ulang kuota tujuan secara fresh (daftar bisa basi sejak modal dibuka).
    const fresh = await countConfirmed([target.id])
    if (target.quota - (fresh[target.id] || 0) <= 0) {
      setBookedCounts(c => ({ ...c, ...fresh }))
      setError('Jadwal ini sudah penuh, pilih jadwal lain')
      setSubmitting(false)
      return
    }
    const { error: err } = await supabase
      .from('gym_class_bookings')
      .update({ schedule_id: target.id, updated_at: new Date().toISOString() })
      .eq('id', booking.id as string)
    if (err) { setError(err.message); setSubmitting(false); return }
    onRefresh()
    onClose()
  }

  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 640 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Reschedule Booking</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
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
            {!!currentCt?.color && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: currentCt.color as string, marginRight: 4 }} />}
            {(currentCt?.name as string) || '-'} — {fmtDate(currentSchedule?.schedule_date as string)}{' '}
            {fmtTime(currentSchedule?.start_time as string)}–{fmtTime(currentSchedule?.end_time as string)}
            {!!currentSchedule?.instructor && <> ({currentSchedule.instructor as string})</>}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Pilih Jadwal Baru</div>
          {!!currentClassTypeId && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={sameClassOnly}
                onChange={e => { setSameClassOnly(e.target.checked); setSelected(null) }}
                style={{ accentColor: 'var(--red)' }}
              />
              Hanya kelas yang sama
            </label>
          )}
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

        {loading ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 14, padding: '20px 0' }}>Memuat jadwal...</p>
        ) : visible.length === 0 ? (
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
                {visible.map(s => {
                  const sisa = getSisa(s)
                  const full = sisa <= 0
                  return (
                    <tr
                      key={s.id}
                      onClick={() => !full && setSelected(s.id)}
                      style={{
                        cursor: full ? 'not-allowed' : 'pointer',
                        opacity: full ? 0.5 : 1,
                        background: selected === s.id ? 'var(--bg-card-hover)' : undefined,
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
                      <td style={{ fontSize: 13, whiteSpace: 'nowrap' }}>{fmtDate(s.schedule_date)}</td>
                      <td style={{ fontSize: 13 }}>
                        {s.class_type?.color && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: s.class_type.color, marginRight: 4 }} />}
                        {s.class_type?.name}
                      </td>
                      <td style={{ fontSize: 13 }}>{s.instructor || '-'}</td>
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
            {submitting ? 'Memproses...' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  )
}
