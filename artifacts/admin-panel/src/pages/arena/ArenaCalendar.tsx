import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate, fmtTime } from '../../lib/format'

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']
const VENUE_COLOR = '#374151'
const DEFAULT_CLASS_COLOR = '#C0392B'

type ClassTypeEmbed = { name: string; color: string | null }
interface Participant {
  id: string
  booking_code: string | null
  full_name: string
  phone: string | null
  status: string
}
interface ClassEvent {
  id: string
  schedule_date: string
  start_time: string
  end_time: string
  instructor: string | null
  is_cancelled: boolean
  quota: number
  // PostgREST returns the to-one embed as an object (older versions: an array)
  arena_class_types: ClassTypeEmbed | ClassTypeEmbed[] | null
  arena_class_bookings: Participant[]
}
interface VenueEvent {
  id: string
  booking_code: string
  full_name: string
  phone: string | null
  email: string | null
  customer_type: string
  booking_date: string
  start_time: string
  end_time: string
  price: number
  status: string
  payment_method: string | null
}

const STATUS_BADGE: Record<string, string> = {
  confirmed: 'badge-confirmed', pending_payment: 'badge-pending',
  cancelled: 'badge-cancelled', completed: 'badge-confirmed', no_show: 'badge-cancelled',
}
const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed', pending_payment: 'Pending',
  cancelled: 'Cancelled', completed: 'Completed', no_show: 'No Show',
}

const sectionTitle: React.CSSProperties = {
  fontWeight: 600, fontSize: 11, textTransform: 'uppercase',
  letterSpacing: '0.06em', color: 'var(--text-muted)', margin: '14px 0 4px',
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`

const classTypeOf = (s: ClassEvent): ClassTypeEmbed | null => {
  const ct = s.arena_class_types
  return Array.isArray(ct) ? (ct[0] ?? null) : ct
}

// Pick readable text color for a given hex background
const contrastText = (hex?: string | null) => {
  if (!hex) return '#fff'
  const h = hex.replace('#', '')
  if (h.length !== 6) return '#fff'
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return lum > 0.62 ? '#111' : '#fff'
}

// Bookings that count as participants (exclude cancelled)
const activeParts = (s: ClassEvent) => (s.arena_class_bookings || []).filter(p => p.status !== 'cancelled')

export default function ArenaCalendar() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [schedules, setSchedules] = useState<ClassEvent[]>([])
  const [venues, setVenues] = useState<VenueEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedClass, setSelectedClass] = useState<ClassEvent | null>(null)
  const [selectedVenue, setSelectedVenue] = useState<VenueEvent | null>(null)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    const first = ymd(year, month, 1)
    const last = ymd(year, month, new Date(year, month + 1, 0).getDate())
    const [clsRes, venRes] = await Promise.all([
      supabase
        .from('arena_class_schedules')
        .select(`
          id, schedule_date, start_time, end_time, instructor, is_cancelled, quota,
          arena_class_types ( name, color ),
          arena_class_bookings ( id, booking_code, full_name, phone, status )
        `)
        .gte('schedule_date', first)
        .lte('schedule_date', last)
        .eq('is_cancelled', false)
        .order('start_time', { ascending: true }),
      supabase
        .from('arena_bookings')
        .select('id, booking_code, full_name, phone, email, customer_type, booking_date, start_time, end_time, price, status, payment_method')
        .gte('booking_date', first)
        .lte('booking_date', last)
        .neq('status', 'cancelled')
        .order('start_time', { ascending: true }),
    ])
    if (clsRes.error) { setError(clsRes.error.message); setLoading(false); return }
    if (venRes.error) { setError(venRes.error.message); setLoading(false); return }
    setSchedules((clsRes.data || []) as unknown as ClassEvent[])
    setVenues((venRes.data || []) as unknown as VenueEvent[])
    setLoading(false)
  }, [year, month])

  useEffect(() => { fetchData() }, [fetchData])

  const classByDate = useMemo(() => {
    const m: Record<string, ClassEvent[]> = {}
    for (const s of schedules) (m[s.schedule_date] ||= []).push(s)
    for (const k in m) m[k].sort((a, b) => a.start_time.localeCompare(b.start_time))
    return m
  }, [schedules])

  const venueByDate = useMemo(() => {
    const m: Record<string, VenueEvent[]> = {}
    for (const v of venues) (m[v.booking_date] ||= []).push(v)
    for (const k in m) m[k].sort((a, b) => a.start_time.localeCompare(b.start_time))
    return m
  }, [venues])

  // Build the month grid: leading blanks + day numbers + trailing blanks to fill full weeks
  const cells: (number | null)[] = []
  const startWeekday = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)

  const now = new Date()
  const todayStr = ymd(now.getFullYear(), now.getMonth(), now.getDate())
  const monthLabel = cursor.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })

  const goPrev = () => setCursor(c => new Date(c.getFullYear(), c.getMonth() - 1, 1))
  const goNext = () => setCursor(c => new Date(c.getFullYear(), c.getMonth() + 1, 1))
  const goToday = () => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)) }

  const modalParts = selectedClass
    ? activeParts(selectedClass).slice().sort((a, b) => {
        if (a.status !== b.status) return a.status === 'confirmed' ? -1 : b.status === 'confirmed' ? 1 : 0
        return a.full_name.localeCompare(b.full_name)
      })
    : []
  const confirmedCount = modalParts.filter(p => p.status === 'confirmed').length
  const pendingCount = modalParts.filter(p => p.status === 'pending_payment').length

  return (
    <div>
      {/* Header + month navigation */}
      <div className="page-header">
        <h2 className="page-title">Kalender Arena</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn-secondary" onClick={goToday} style={{ fontSize: 12, padding: '6px 12px' }}>Hari Ini</button>
          <button className="btn-secondary" onClick={goPrev} aria-label="Bulan sebelumnya" style={{ padding: '6px 14px', fontSize: 16, lineHeight: 1 }}>‹</button>
          <div style={{ minWidth: 150, textAlign: 'center', fontWeight: 700, fontSize: 15, textTransform: 'capitalize' }}>{monthLabel}</div>
          <button className="btn-secondary" onClick={goNext} aria-label="Bulan berikutnya" style={{ padding: '6px 14px', fontSize: 16, lineHeight: 1 }}>›</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: DEFAULT_CLASS_COLOR, display: 'inline-block' }} /> Kelas
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 12, height: 12, borderRadius: 3, background: VENUE_COLOR, display: 'inline-block' }} /> Venue Booking
        </span>
        {loading && <span style={{ marginLeft: 'auto' }}>Memuat…</span>}
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* Calendar grid — 7 equal columns that fit the viewport width (no horizontal scroll);
          only grows vertically. minmax(0,1fr) lets columns shrink so cell text ellipsizes. */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', background: 'var(--bg-page)', borderBottom: '1px solid var(--border)' }}>
          {DAY_LABELS.map((d, i) => (
            <div key={d} style={{ padding: '8px 10px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: i === 0 ? 'var(--red)' : 'var(--text-muted)' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 1, background: 'var(--border)' }}>
            {cells.map((d, i) => {
              if (d === null) return <div key={i} style={{ background: 'var(--bg-page)', minHeight: 'clamp(84px, 12vh, 120px)' }} />
              const dateStr = ymd(year, month, d)
              const isToday = dateStr === todayStr
              const isSunday = i % 7 === 0
              const cls = classByDate[dateStr] || []
              const ven = venueByDate[dateStr] || []
              return (
                <div key={i} style={{ background: 'var(--bg-card)', minHeight: 'clamp(84px, 12vh, 120px)', minWidth: 0, padding: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <div style={{ marginBottom: 2 }}>
                    <span style={{
                      fontSize: 12, fontWeight: 700,
                      color: isToday ? '#fff' : isSunday ? 'var(--red)' : 'var(--text-primary)',
                      background: isToday ? 'var(--red)' : 'transparent',
                      minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10,
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    }}>{d}</span>
                  </div>
                  {cls.map(s => {
                    const ct = classTypeOf(s)
                    const color = ct?.color || DEFAULT_CLASS_COLOR
                    const name = ct?.name || 'Kelas'
                    const count = activeParts(s).length
                    return (
                      <button
                        key={s.id}
                        onClick={() => setSelectedClass(s)}
                        title={`${fmtTime(s.start_time)} ${name}${s.instructor ? ' — ' + s.instructor : ''} (${count} peserta)`}
                        style={{
                          background: color, color: contrastText(color), border: 'none', borderRadius: 4,
                          padding: '3px 6px', fontSize: 11, cursor: 'pointer', display: 'flex', gap: 4,
                          alignItems: 'center', width: '100%', fontFamily: 'inherit', lineHeight: 1.3,
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>
                          {fmtTime(s.start_time)} {name}
                        </span>
                        <span style={{ background: 'rgba(255,255,255,0.28)', borderRadius: 8, padding: '0 5px', fontWeight: 700, fontSize: 10 }}>{count}</span>
                      </button>
                    )
                  })}
                  {ven.map(v => (
                    <button
                      key={v.id}
                      onClick={() => setSelectedVenue(v)}
                      title={`${fmtTime(v.start_time)}-${fmtTime(v.end_time)} ${v.full_name} (${v.customer_type === 'corporation' ? 'korporasi' : 'individual'})`}
                      style={{
                        background: VENUE_COLOR, color: '#fff', border: 'none', borderRadius: 4,
                        padding: '3px 6px', fontSize: 11, cursor: 'pointer', width: '100%', textAlign: 'left',
                        fontFamily: 'inherit', lineHeight: 1.3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}
                    >
                      {fmtTime(v.start_time)}-{fmtTime(v.end_time)} {v.full_name}
                    </button>
                  ))}
                </div>
              )
            })}
        </div>
      </div>

      {!loading && schedules.length === 0 && venues.length === 0 && (
        <p style={{ textAlign: 'center', color: 'var(--text-faint)', fontSize: 13, marginTop: 16 }}>
          Tidak ada aktivitas di bulan ini.
        </p>
      )}

      {/* Class detail modal */}
      {selectedClass && (() => {
        const ct = classTypeOf(selectedClass)
        const color = ct?.color || DEFAULT_CLASS_COLOR
        return (
          <div className="modal-overlay">
            <div className="modal-box" style={{ maxWidth: 620 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: color, display: 'inline-block', marginTop: 5 }} />
                  <div>
                    <h3 className="modal-title" style={{ margin: 0 }}>{ct?.name || 'Kelas'}</h3>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                      {fmtDate(selectedClass.schedule_date)} · {fmtTime(selectedClass.start_time)}–{fmtTime(selectedClass.end_time)} · {selectedClass.instructor || '-'}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedClass(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
              </div>

              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                <span className="badge badge-confirmed">{confirmedCount} confirmed</span>
                <span className="badge badge-pending">{pendingCount} pending</span>
                <span className="badge" style={{ background: 'var(--bg-page)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  {activeParts(selectedClass).length} / {selectedClass.quota} kuota
                </span>
              </div>

              <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr><th>Booking Code</th><th>Nama</th><th>Telp</th><th>Status</th></tr>
                  </thead>
                  <tbody>
                    {modalParts.length === 0 ? (
                      <tr><td colSpan={4} className="empty-state">Belum ada peserta</td></tr>
                    ) : modalParts.map(p => (
                      <tr key={p.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{p.booking_code || '-'}</td>
                        <td>{p.full_name}</td>
                        <td>{p.phone || '-'}</td>
                        <td><span className={`badge ${STATUS_BADGE[p.status] || ''}`}>{STATUS_LABEL[p.status] || p.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="modal-footer" style={{ marginTop: 16 }}>
                <button className="btn-secondary" onClick={() => setSelectedClass(null)}>Tutup</button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Venue detail modal */}
      {selectedVenue && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 460 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>{selectedVenue.booking_code}</div>
                <span className={`badge ${STATUS_BADGE[selectedVenue.status] || ''}`}>{STATUS_LABEL[selectedVenue.status] || selectedVenue.status}</span>
              </div>
              <button onClick={() => setSelectedVenue(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>

            <div style={sectionTitle}>Pemesan</div>
            <div className="detail-row"><span>Nama</span><span>{selectedVenue.full_name}</span></div>
            <div className="detail-row"><span>Tipe</span><span>{selectedVenue.customer_type === 'corporation' ? 'Korporasi' : 'Individual'}</span></div>
            <div className="detail-row"><span>Telp</span><span>{selectedVenue.phone || '-'}</span></div>
            {selectedVenue.email && selectedVenue.email !== 'noemail@20fit.id' && (
              <div className="detail-row"><span>Email</span><span>{selectedVenue.email}</span></div>
            )}

            <div style={sectionTitle}>Jadwal</div>
            <div className="detail-row"><span>Tanggal</span><span>{fmtDate(selectedVenue.booking_date)}</span></div>
            <div className="detail-row"><span>Waktu</span><span>{fmtTime(selectedVenue.start_time)} – {fmtTime(selectedVenue.end_time)}</span></div>

            <div style={sectionTitle}>Pembayaran</div>
            <div className="detail-row"><span>Status</span><span>{STATUS_LABEL[selectedVenue.status] || selectedVenue.status}</span></div>
            <div className="detail-row"><span>Metode</span><span>{selectedVenue.payment_method || '-'}</span></div>
            <div className="detail-row" style={{ fontWeight: 700 }}><span>Harga</span><span>{fmtRp(selectedVenue.price)}</span></div>

            <div className="modal-footer" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setSelectedVenue(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
