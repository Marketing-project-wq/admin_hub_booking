import React, { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { fmtRp, fmtDate, fmtTime } from '../../lib/format'

// GYM — Dashboard unit. Ringkasan operasional gym; HANYA membaca tabel gym_*.

interface TodayClass {
  id: string; start_time: string; end_time: string; instructor: string; quota: number;
  class_type?: { name: string; color: string } | null; booked: number;
}

const todayStr = () => new Date().toISOString().slice(0, 10)
const plusDaysStr = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const monthStartStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }

export default function GymDashboard() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [today, setToday] = useState<TodayClass[]>([])
  const [stats, setStats] = useState({
    todayCount: 0, upcomingCount: 0,
    confirmedMonth: 0, pendingCount: 0, revenueMonth: 0,
  })

  const fetchAll = useCallback(async () => {
    setLoading(true)
    const t = todayStr()
    const monthStart = monthStartStr() + 'T00:00:00+07:00'
    const monthEnd = todayStr() + 'T23:59:59+07:00'

    const [todayRes, upcomingRes, confirmedRes, pendingRes] = await Promise.all([
      // Kelas hari ini (aktif)
      supabase.from('gym_class_schedules')
        .select('id, start_time, end_time, instructor, quota, class_type:gym_class_types(name, color)')
        .eq('schedule_date', t).eq('is_cancelled', false)
        .order('start_time', { ascending: true }),
      // Jadwal aktif 7 hari ke depan
      supabase.from('gym_class_schedules')
        .select('id', { count: 'exact', head: true })
        .eq('is_cancelled', false).gte('schedule_date', t).lte('schedule_date', plusDaysStr(7)),
      // Booking confirmed bulan ini (untuk count + revenue)
      supabase.from('gym_class_bookings')
        .select('price')
        .eq('status', 'confirmed').not('paid_at', 'is', null)
        .gte('paid_at', monthStart).lte('paid_at', monthEnd),
      // Pending payment (semua)
      supabase.from('gym_class_bookings')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_payment'),
    ])

    const todayRows = (todayRes.data || []) as unknown as TodayClass[]
    // Booked count untuk kelas hari ini
    const bookedMap: Record<string, number> = {}
    if (todayRows.length > 0) {
      const ids = todayRows.map(r => r.id)
      const { data: bk } = await supabase.from('gym_class_bookings')
        .select('schedule_id').in('schedule_id', ids).eq('status', 'confirmed')
      for (const b of (bk || [])) {
        const sid = (b as { schedule_id: string }).schedule_id
        bookedMap[sid] = (bookedMap[sid] || 0) + 1
      }
    }
    setToday(todayRows.map(r => ({ ...r, booked: bookedMap[r.id] || 0 })))

    const confirmedRows = (confirmedRes.data || []) as { price: number }[]
    setStats({
      todayCount: todayRows.length,
      upcomingCount: upcomingRes.count || 0,
      confirmedMonth: confirmedRows.length,
      revenueMonth: confirmedRows.reduce((s, r) => s + Number(r.price || 0), 0),
      pendingCount: pendingRes.count || 0,
    })
    setLoading(false)
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const kpis = [
    { label: 'Kelas Hari Ini', value: stats.todayCount, sub: fmtDate(todayStr()), color: 'var(--red)', money: false },
    { label: 'Jadwal 7 Hari', value: stats.upcomingCount, sub: 'Aktif mendatang', color: 'var(--blue)', money: false },
    { label: 'Confirmed (Bln Ini)', value: stats.confirmedMonth, sub: 'Booking lunas', color: 'var(--green)', money: false },
    { label: 'Pending Payment', value: stats.pendingCount, sub: 'Menunggu bayar', color: 'var(--amber)', money: false },
    { label: 'Revenue (Bln Ini)', value: stats.revenueMonth, sub: 'Dari booking confirmed', color: '#7C3AED', money: true },
  ]

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Gym Dashboard</h2>
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
        <Link to="/gym/schedules" className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>Kelola Jadwal →</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Input, edit, batalkan, dan buat jadwal kelas berulang.</p>
        </Link>
        <Link to="/gym/class-bookings" className="card" style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
          <h3 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700 }}>Transaksi →</h3>
          <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>Daftar booking kelas gym: filter, konfirmasi, batalkan, export.</p>
        </Link>
      </div>

      {/* Today's classes */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>Kelas Hari Ini</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDate(todayStr())}</div>
        </div>
        <div className="table-wrap" style={{ margin: 0 }}>
          <table className="data-table">
            <thead>
              <tr><th>Waktu</th><th>Kelas</th><th>Instruktur</th><th>Booked</th><th>Sisa</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr className="loading-row"><td colSpan={5}>Memuat...</td></tr>
              ) : today.length === 0 ? (
                <tr><td colSpan={5} className="empty-state">Tidak ada kelas aktif hari ini</td></tr>
              ) : today.map(c => {
                const sisa = c.quota - c.booked
                return (
                  <tr key={c.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(c.start_time)}–{fmtTime(c.end_time)}</td>
                    <td>
                      {c.class_type?.color && <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 999, background: c.class_type.color, marginRight: 6 }} />}
                      {c.class_type?.name || '-'}
                    </td>
                    <td>{c.instructor}</td>
                    <td style={{ textAlign: 'center' }}>{c.booked}</td>
                    <td style={{ textAlign: 'center', color: sisa === 0 ? 'var(--red)' : 'inherit', fontWeight: sisa === 0 ? 700 : 400 }}>{sisa}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
