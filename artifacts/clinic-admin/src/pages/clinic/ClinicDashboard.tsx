import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fmtRp, fmtDate, fmtTime, STATUS_LABEL } from '@workspace/admin-shared'
import {
  getDashboardStats, getRecentBookings, serviceName,
  type ClinicStats, type ClinicBooking,
} from '../../lib/clinic'

const KPI = [
  { key: 'today',     label: 'Booking Hari Ini', icon: '📅', color: '#2563EB' },
  { key: 'week',      label: 'Minggu Ini',       icon: '🗓️', color: '#7C3AED' },
  { key: 'pending',   label: 'Pending Payment',  icon: '⏳', color: '#D97706' },
  { key: 'confirmed', label: 'Confirmed',        icon: '✅', color: '#059669' },
] as const

export default function ClinicDashboard() {
  const navigate = useNavigate()
  const [stats, setStats] = useState<ClinicStats>({ today: 0, week: 0, pending: 0, confirmed: 0 })
  const [recent, setRecent] = useState<ClinicBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchAll = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([getDashboardStats(), getRecentBookings(10)])
      setStats(s)
      setRecent(r)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Auto-refresh every 30s
  const ref = useRef(fetchAll)
  ref.current = fetchAll
  useEffect(() => {
    const id = setInterval(() => ref.current(), 30000)
    return () => clearInterval(id)
  }, [])

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Clinic Dashboard</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-secondary" onClick={() => navigate('/clinic/slots')}>Manage Slots</button>
          <button className="btn-primary" onClick={() => navigate('/clinic/bookings')}>View All Bookings</button>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* ── KPI cards ────────────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {KPI.map(k => (
          <div key={k.key} className="card" style={{ borderTop: `3px solid ${k.color}`, display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{ fontSize: 26 }}>{k.icon}</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: 26, color: k.color, lineHeight: 1 }}>
                {loading ? '...' : stats[k.key]}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginTop: 6 }}>
                {k.label}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Recent bookings ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Booking Terbaru</h3>
        <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }} onClick={() => navigate('/clinic/bookings')}>
          Lihat Semua
        </button>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Booking Code</th><th>Layanan</th><th>Nama</th>
              <th>Jadwal</th><th>Status</th><th>Harga</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={6}>Memuat data...</td></tr>
            ) : recent.length === 0 ? (
              <tr><td colSpan={6} className="empty-state">Belum ada booking</td></tr>
            ) : recent.map(b => {
              const s = STATUS_LABEL[b.status] || { label: b.status, css: '' }
              return (
                <tr key={b.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{b.booking_code}</td>
                  <td>{serviceName(b)}</td>
                  <td>{b.full_name}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>
                    {fmtDate(b.slot_date)} {fmtTime(b.slot_time)}
                  </td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(b.price)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
