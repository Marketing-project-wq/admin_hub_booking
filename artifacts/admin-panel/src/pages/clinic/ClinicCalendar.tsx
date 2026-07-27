import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { fmtDate, fmtTime } from '../../lib/format'
import { getClinicCalendarData, type CalendarItem } from '../../lib/clinic'

const DAY_LABELS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab']

// Warna dibedakan lewat kelas badge existing (badge-confirmed / badge-pending / badge-cancelled).
const STATUS_BADGE: Record<string, string> = {
  confirmed: 'badge-confirmed',
  pending_payment: 'badge-pending',
  arrived: 'badge-pending',
  scheduled: 'badge-pending',
  in_progress: 'badge-pending',
  completed: 'badge-confirmed',
  cancelled: 'badge-cancelled',
  no_show: 'badge-cancelled',
}
const STATUS_LABEL: Record<string, string> = {
  confirmed: 'Confirmed',
  pending_payment: 'Pending',
  arrived: 'Tiba',
  scheduled: 'Terjadwal',
  in_progress: 'Berjalan',
  completed: 'Selesai',
  cancelled: 'Batal',
  no_show: 'Tidak Hadir',
  checked_in: 'Check-in',
  paid: 'Lunas',
  unpaid: 'Belum Bayar',
}

const pad2 = (n: number) => String(n).padStart(2, '0')
const ymd = (y: number, m: number, d: number) => `${y}-${pad2(m + 1)}-${pad2(d)}`

export default function ClinicCalendar() {
  const [cursor, setCursor] = useState(() => {
    const n = new Date()
    return new Date(n.getFullYear(), n.getMonth(), 1)
  })
  const [data, setData] = useState<Record<string, CalendarItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const year = cursor.getFullYear()
  const month = cursor.getMonth()

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    const first = ymd(year, month, 1)
    const last = ymd(year, month, new Date(year, month + 1, 0).getDate())
    try {
      const res = await getClinicCalendarData(first, last)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat kalender')
    } finally {
      setLoading(false)
    }
  }, [year, month])

  useEffect(() => { fetchData() }, [fetchData])

  // Build the month grid: leading blanks + day numbers + trailing blanks to fill full weeks.
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

  const totalItems = useMemo(() => Object.values(data).reduce((s, arr) => s + arr.length, 0), [data])
  const selectedItems = selectedDate ? (data[selectedDate] || []) : []

  return (
    <div>
      {/* Header + navigasi bulan */}
      <div className="page-header">
        <h2 className="page-title">Kalender Clinic</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="btn-secondary" onClick={goToday} style={{ fontSize: 12, padding: '6px 12px' }}>Hari Ini</button>
          <button className="btn-secondary" onClick={goPrev} aria-label="Bulan sebelumnya" style={{ padding: '6px 14px', fontSize: 16, lineHeight: 1 }}>‹</button>
          <div style={{ minWidth: 150, textAlign: 'center', fontWeight: 700, fontSize: 15, textTransform: 'capitalize' }}>{monthLabel}</div>
          <button className="btn-secondary" onClick={goNext} aria-label="Bulan berikutnya" style={{ padding: '6px 14px', fontSize: 16, lineHeight: 1 }}>›</button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginBottom: 12, fontSize: 12, color: 'var(--text-muted)', flexWrap: 'wrap' }}>
        <span>Klik tanggal untuk melihat detail booking &amp; kunjungan hari itu.</span>
        {loading && <span style={{ marginLeft: 'auto' }}>Memuat…</span>}
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* Grid kalender — 7 kolom yang fit lebar viewport (tanpa horizontal scroll). */}
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
            const count = (data[dateStr] || []).length
            return (
              <button
                key={i}
                type="button"
                onClick={() => { if (count > 0) setSelectedDate(dateStr) }}
                title={count > 0 ? `${count} item` : undefined}
                style={{
                  background: 'var(--bg-card)', minHeight: 'clamp(84px, 12vh, 120px)', minWidth: 0, padding: 6,
                  display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'stretch',
                  border: 'none', textAlign: 'left', fontFamily: 'inherit',
                  cursor: count > 0 ? 'pointer' : 'default',
                }}
              >
                <div>
                  <span style={{
                    fontSize: 12, fontWeight: 700,
                    color: isToday ? '#fff' : isSunday ? 'var(--red)' : 'var(--text-primary)',
                    background: isToday ? 'var(--red)' : 'transparent',
                    minWidth: 20, height: 20, padding: '0 6px', borderRadius: 10,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>{d}</span>
                </div>
                {count > 0 && (
                  <span style={{
                    alignSelf: 'flex-start', fontSize: 11, fontWeight: 700,
                    background: 'var(--bg-elevated)', color: 'var(--text-secondary)',
                    borderRadius: 999, padding: '2px 8px',
                  }}>{count} item</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {!loading && totalItems === 0 && (
        <p className="empty-state" style={{ textAlign: 'center', marginTop: 16 }}>Tidak ada aktivitas di bulan ini.</p>
      )}

      {/* Detail hari */}
      {selectedDate && (
        <div className="modal-overlay" onClick={() => setSelectedDate(null)}>
          <div className="modal-box" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <h3 className="modal-title" style={{ margin: 0, textTransform: 'capitalize' }}>{fmtDate(selectedDate)}</h3>
              <button onClick={() => setSelectedDate(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>

            <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--text-muted)' }}>{selectedItems.length} item</div>

            <div className="table-wrap" style={{ maxHeight: 400, overflowY: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr><th>Jam</th><th>Pasien</th><th>Layanan</th><th>Tipe</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {selectedItems.length === 0 ? (
                    <tr><td colSpan={5} className="empty-state">Tidak ada item</td></tr>
                  ) : selectedItems.map(it => (
                    <tr key={`${it.kind}-${it.id}`}>
                      <td style={{ whiteSpace: 'nowrap' }}>{it.time ? fmtTime(it.time) : '-'}</td>
                      <td>{it.patientName}</td>
                      <td>{it.serviceName}</td>
                      <td>
                        <span className="badge" style={{ background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}>
                          {it.kind === 'booking' ? 'Booking' : 'Kunjungan'}
                        </span>
                      </td>
                      <td><span className={`badge ${STATUS_BADGE[it.status] || ''}`}>{STATUS_LABEL[it.status] || it.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="modal-footer" style={{ marginTop: 16 }}>
              <button className="btn-secondary" onClick={() => setSelectedDate(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
