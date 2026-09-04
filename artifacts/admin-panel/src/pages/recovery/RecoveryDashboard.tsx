import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fmtRp, fmtDate, fmtDateTime, STATUS_LABEL } from '../../lib/format'

// RECOVERY CENTER — Dashboard unit.
// Recovery Center memakai ulang infrastruktur Clinic: booking = clinic_bookings
// dengan channel='recovery_center', layanan = clinic_services (service_group=
// 'Recovery Center'). Semua query HANYA menyentuh subset itu (isolasi per unit).
const CHANNEL = 'recovery_center'
const SERVICE_GROUP = 'Recovery Center'

type Row = Record<string, unknown>

const todayStr = () => new Date().toISOString().slice(0, 10)
const monthStartStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

export default function RecoveryDashboard() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({ revenueMonth: 0, paidMonth: 0, incomingMonth: 0, pendingCount: 0 })
  const [recent, setRecent] = useState<Row[]>([])
  const [services, setServices] = useState<Row[]>([])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const monthStart = monthStartStr() + 'T00:00:00+07:00'
    const monthEnd = todayStr() + 'T23:59:59+07:00'

    const [paidRes, incomingRes, pendingRes, recentRes, svcRes] = await Promise.all([
      // Booking lunas (confirmed) bulan ini → omzet + jumlah
      supabase.from('clinic_bookings').select('price')
        .eq('channel', CHANNEL).eq('status', 'confirmed').not('paid_at', 'is', null)
        .gte('paid_at', monthStart).lte('paid_at', monthEnd),
      // Booking masuk bulan ini (semua status, by created_at)
      supabase.from('clinic_bookings').select('id', { count: 'exact', head: true })
        .eq('channel', CHANNEL).gte('created_at', monthStart).lte('created_at', monthEnd),
      // Menunggu bayar (live, semua)
      supabase.from('clinic_bookings').select('id', { count: 'exact', head: true })
        .eq('channel', CHANNEL).eq('status', 'pending_payment'),
      // Booking terbaru
      supabase.from('clinic_bookings')
        .select('id, booking_code, full_name, email, phone, price, status, paid_at, created_at, service:clinic_services(name, code)')
        .eq('channel', CHANNEL).order('created_at', { ascending: false }).limit(8),
      // Katalog layanan Recovery Center (harga tayang live)
      supabase.from('clinic_services')
        .select('code, name, price, duration_minutes')
        .eq('service_group', SERVICE_GROUP).order('sort_order', { ascending: true }),
    ])

    const paidRows = (paidRes.data || []) as { price: number }[]
    setStats({
      revenueMonth: paidRows.reduce((s, r) => s + Number(r.price || 0), 0),
      paidMonth: paidRows.length,
      incomingMonth: incomingRes.count || 0,
      pendingCount: pendingRes.count || 0,
    })
    setRecent((recentRes.data as Row[]) || [])
    setServices((svcRes.data as Row[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const kpis = [
    { label: 'Omzet (Bln Ini)', value: stats.revenueMonth, sub: 'Dari booking lunas', color: 'var(--green)', money: true },
    { label: 'Booking Masuk', value: stats.incomingMonth, sub: 'Bulan ini', color: 'var(--blue)', money: false },
    { label: 'Menunggu Bayar', value: stats.pendingCount, sub: 'Belum lunas (total)', color: 'var(--amber)', money: false },
    { label: 'Lunas (Bln Ini)', value: stats.paidMonth, sub: 'Booking confirmed', color: '#7C3AED', money: false },
  ]

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Recovery Center Dashboard</h2>
      </div>
      <p style={{ color: 'var(--text-muted)', marginTop: -8, marginBottom: 24 }}>
        Selamat datang, {user?.full_name} — {user?.role}
      </p>

      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 12, marginBottom: 24 }}>
        {kpis.map((k, i) => (
          <div key={i} style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: k.color, flex: '0 0 auto' }} />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 700 }}>{k.label}</div>
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 20, color: 'var(--text-primary)' }}>
              {loading ? '...' : k.money ? fmtRp(k.value) : k.value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick nav */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
        <Link to="/recovery/bookings" className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>Booking →</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Daftar booking Recovery Center: nama, email, status &amp; jam bayar, konfirmasi, batalkan, export.</p>
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, alignItems: 'start' }}>
        {/* Recent bookings */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 15 }}>Booking Terbaru</div>
          <div className="table-wrap" style={{ margin: 0 }}>
            <table className="data-table">
              <thead>
                <tr><th>Layanan</th><th>Nama</th><th>Email</th><th>Amount</th><th>Status</th><th>Jam Bayar</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="loading-row"><td colSpan={6}>Memuat...</td></tr>
                ) : recent.length === 0 ? (
                  <tr><td colSpan={6} className="empty-state">Belum ada booking</td></tr>
                ) : recent.map(row => {
                  const s = STATUS_LABEL[row.status as string] || { label: row.status as string, css: '' }
                  const svc = row.service as Row | undefined
                  return (
                    <tr key={row.id as string}>
                      <td>{(svc?.name as string) || '-'}</td>
                      <td>{row.full_name as string}</td>
                      <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(row.email as string) || '-'}</td>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(row.price as number)}</td>
                      <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                      <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: 'var(--text-muted)' }}>{row.paid_at ? fmtDateTime(row.paid_at as string) : '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Layanan & Harga */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', fontWeight: 700, fontSize: 15 }}>Layanan &amp; Harga Tayang</div>
          <div className="table-wrap" style={{ margin: 0 }}>
            <table className="data-table">
              <thead>
                <tr><th>Layanan</th><th>Durasi</th><th style={{ textAlign: 'right' }}>Harga</th></tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr className="loading-row"><td colSpan={3}>Memuat...</td></tr>
                ) : services.length === 0 ? (
                  <tr><td colSpan={3} className="empty-state">Belum ada layanan</td></tr>
                ) : services.map((s, i) => (
                  <tr key={i}>
                    <td>{s.name as string}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.duration_minutes ? `${s.duration_minutes} mnt` : '—'}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(s.price as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
