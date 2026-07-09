import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate } from '../../lib/format'

// ─── Date helpers ────────────────────────────────────────────────────────────
const toDay          = () => new Date().toISOString().slice(0, 10)
const toYesterday    = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) }
const toDaysAgo      = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const toStartOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const toStartOfLastMonth = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const toEndOfLastMonth   = () => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0, 10) }

const PRESETS = [
  { label: 'Hari Ini',   getValue: () => ({ from: toDay(),           to: toDay() }) },
  { label: 'Kemarin',    getValue: () => ({ from: toYesterday(),      to: toYesterday() }) },
  { label: '7 Hari',     getValue: () => ({ from: toDaysAgo(6),       to: toDay() }) },
  { label: 'Bulan Ini',  getValue: () => ({ from: toStartOfMonth(),   to: toDay() }) },
  { label: 'Bulan Lalu', getValue: () => ({ from: toStartOfLastMonth(), to: toEndOfLastMonth() }) },
]

// ─── Sub-components ───────────────────────────────────────────────────────────
interface DayPoint { label: string; date: string; total: number }

function SalesBarChart({ data }: { data: DayPoint[] }) {
  if (!data || data.length === 0) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
      Tidak ada data
    </div>
  )
  const maxVal = Math.max(...data.map(d => d.total), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, padding: '0 4px' }}>
      {data.map((d, i) => {
        const h = Math.max((d.total / maxVal) * 100, d.total > 0 ? 4 : 0)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div
              title={`${d.label}: ${fmtRp(d.total)}`}
              style={{
                width: '100%', height: `${h}%`,
                background: 'linear-gradient(180deg, #C0392B 0%, #922B21 100%)',
                borderRadius: '3px 3px 0 0', minHeight: d.total > 0 ? 4 : 0,
                alignSelf: 'flex-end', cursor: 'pointer', transition: 'opacity 0.15s',
              }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.8')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

function RevenueLineChart({ data }: { data: DayPoint[] }) {
  if (!data || data.length === 0) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-faint)', fontSize: 13 }}>
      Tidak ada data
    </div>
  )
  const maxVal = Math.max(...data.map(d => d.total), 1)
  const W = 100 / (data.length - 1 || 1)
  const points = data.map((d, i) => ({ x: i * W, y: 100 - (d.total / maxVal) * 85, ...d }))
  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaD = `${pathD} L ${points[points.length - 1].x} 100 L 0 100 Z`
  const show  = (arr: DayPoint[]) => arr.filter((_, i) => i === 0 || i === Math.floor(arr.length / 2) || i === arr.length - 1)
  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: '100%', height: 100 }}>
        <defs>
          <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#C0392B" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#C0392B" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        <path d={areaD} fill="url(#areaGrad)" />
        <path d={pathD} fill="none" stroke="#C0392B" strokeWidth="1.5"
          vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="1.2" fill="#C0392B" vectorEffect="non-scaling-stroke" />
        ))}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
        {show(data).map((d, i) => (
          <span key={i} style={{ fontSize: 10, color: 'var(--text-faint)' }}>{d.label}</span>
        ))}
      </div>
    </div>
  )
}

function OccupancyGauge({ value, label, color }: { value: number; label?: string; color: string }) {
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <div style={{ position: 'relative', width: 90, height: 90 }}>
        <svg width="90" height="90" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx="45" cy="45" r={radius} fill="none" stroke="#F3F4F6" strokeWidth="8" />
          <circle cx="45" cy="45" r={radius} fill="none" stroke={color} strokeWidth="8"
            strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
            style={{ transition: 'stroke-dashoffset 0.6s ease' }} />
        </svg>
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 16, fontWeight: 700, color: 'var(--text-primary)',
        }}>
          {value}%
        </div>
      </div>
      {label && (
        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center', lineHeight: 1.3 }}>
          {label}
        </div>
      )}
    </div>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface SalesShape  { total: number; class: number; slot: number; venue: number; package: number }
interface RevenueShape { total: number; class: number; slot: number; venue: number; package: number }

// ─── Main component ───────────────────────────────────────────────────────────
export default function ArenaDashboard() {
  const [dateFrom,     setDateFrom]     = useState(toStartOfMonth)
  const [dateTo,       setDateTo]       = useState(toDay)
  const [activePreset, setActivePreset] = useState('Bulan Ini')
  const [showCustom,   setShowCustom]   = useState(false)

  const [loadingSales,   setLoadingSales]   = useState(true)
  const [loadingRevenue, setLoadingRevenue] = useState(true)

  const [sales,          setSales]          = useState<SalesShape>({ total: 0, class: 0, slot: 0, venue: 0, package: 0 })
  const [salesCount,     setSalesCount]     = useState(0)
  const [salesChartData, setSalesChartData] = useState<DayPoint[]>([])

  const [revenue,          setRevenue]          = useState<RevenueShape>({ total: 0, class: 0, slot: 0, venue: 0, package: 0 })
  const [revenueCount,     setRevenueCount]     = useState(0)
  const [revenueChartData, setRevenueChartData] = useState<DayPoint[]>([])

  const [venueOccupancy, setVenueOccupancy] = useState(0)
  const [classOccupancy, setClassOccupancy] = useState(0)

  // ── Helpers ──────────────────────────────────────────────────────────────
  const buildDailyChart = useCallback((
    rows: { date?: string; price?: number; session_revenue?: number }[],
    setter: (v: DayPoint[]) => void,
  ) => {
    const byDay: Record<string, number> = {}
    rows.forEach(r => {
      const d = r.date?.slice(0, 10)
      if (!d) return
      byDay[d] = (byDay[d] || 0) + Number(r.price ?? r.session_revenue ?? 0)
    })
    const result: DayPoint[] = []
    const start = new Date(dateFrom), end = new Date(dateTo)
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10)
      result.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, date: key, total: byDay[key] || 0 })
    }
    setter(result)
  }, [dateFrom, dateTo])

  // ── Sales ────────────────────────────────────────────────────────────────
  const fetchSales = useCallback(async () => {
    setLoadingSales(true)
    const start = dateFrom + 'T00:00:00+07:00'
    const end   = dateTo   + 'T23:59:59+07:00'

    const [cls, ind, corp, pkg] = await Promise.all([
      supabase.from('arena_class_bookings').select('price, paid_at, full_name')
        .eq('status', 'confirmed').not('paid_at', 'is', null).gte('paid_at', start).lte('paid_at', end),
      supabase.from('arena_bookings').select('price, paid_at')
        .eq('status', 'confirmed').eq('customer_type', 'individual').not('paid_at', 'is', null).gte('paid_at', start).lte('paid_at', end),
      supabase.from('arena_bookings').select('price, paid_at, full_name')
        .eq('status', 'confirmed').eq('customer_type', 'corporation').not('paid_at', 'is', null).gte('paid_at', start).lte('paid_at', end),
      supabase.from('arena_package_orders').select('price, paid_at')
        .eq('status', 'confirmed').not('paid_at', 'is', null).gte('paid_at', start).lte('paid_at', end),
    ])

    const sum = (d: { price: number }[] | null) => (d || []).reduce((s, r) => s + Number(r.price), 0)
    const clsAmt = sum(cls.data); const indAmt = sum(ind.data)
    const corpAmt = sum(corp.data); const pkgAmt = sum(pkg.data)

    setSales({ class: clsAmt, slot: indAmt, venue: corpAmt, package: pkgAmt, total: clsAmt + indAmt + corpAmt + pkgAmt })
    setSalesCount((cls.data?.length || 0) + (ind.data?.length || 0) + (corp.data?.length || 0) + (pkg.data?.length || 0))

    buildDailyChart([
      ...(cls.data  || []).map(r => ({ date: r.paid_at, price: Number(r.price) })),
      ...(ind.data  || []).map(r => ({ date: r.paid_at, price: Number(r.price) })),
      ...(corp.data || []).map(r => ({ date: r.paid_at, price: Number(r.price) })),
      ...(pkg.data  || []).map(r => ({ date: r.paid_at, price: Number(r.price) })),
    ], setSalesChartData)

    setLoadingSales(false)
  }, [dateFrom, dateTo, buildDailyChart])

  // ── Revenue ──────────────────────────────────────────────────────────────
  const fetchRevenue = useCallback(async () => {
    setLoadingRevenue(true)

    const [cls, ind, corp, pkgUsageResult] = await Promise.all([
      supabase.from('arena_class_bookings')
        .select('price, schedule:arena_class_schedules(schedule_date)')
        .eq('status', 'confirmed'),
      supabase.from('arena_bookings').select('price, booking_date')
        .eq('status', 'confirmed').eq('customer_type', 'individual')
        .gte('booking_date', dateFrom).lte('booking_date', dateTo),
      supabase.from('arena_bookings').select('price, booking_date')
        .eq('status', 'confirmed').eq('customer_type', 'corporation')
        .gte('booking_date', dateFrom).lte('booking_date', dateTo),
      supabase.from('arena_package_revenue_view').select('session_revenue, used_at')
        .gte('used_at', dateFrom + 'T00:00:00+07:00')
        .lte('used_at', dateTo   + 'T23:59:59+07:00'),
    ])

    type ClsRow = { price: number; schedule: { schedule_date: string } | { schedule_date: string }[] | null }
    const clsFiltered = (cls.data as ClsRow[] | null || []).filter(r => {
      const sch = Array.isArray(r.schedule) ? r.schedule[0] : r.schedule
      const sd  = sch?.schedule_date
      return sd && sd >= dateFrom && sd <= dateTo
    })

    const sumCls  = clsFiltered.reduce((s, r) => s + Number(r.price), 0)
    const sumInd  = (ind.data  || []).reduce((s, r) => s + Number(r.price), 0)
    const sumCorp = (corp.data || []).reduce((s, r) => s + Number(r.price), 0)
    const sumPkg  = pkgUsageResult.error ? 0 :
      (pkgUsageResult.data || []).reduce((s: number, r: { session_revenue: number }) => s + Number(r.session_revenue), 0)

    setRevenue({ class: sumCls, slot: sumInd, venue: sumCorp, package: sumPkg, total: sumCls + sumInd + sumCorp + sumPkg })
    setRevenueCount(
      clsFiltered.length + (ind.data?.length || 0) + (corp.data?.length || 0) +
      (pkgUsageResult.error ? 0 : pkgUsageResult.data?.length || 0)
    )

    buildDailyChart([
      ...clsFiltered.map(r => {
        const sch = Array.isArray(r.schedule) ? r.schedule[0] : r.schedule
        return { date: sch?.schedule_date, price: Number(r.price) }
      }),
      ...(ind.data  || []).map(r => ({ date: r.booking_date, price: Number(r.price) })),
      ...(corp.data || []).map(r => ({ date: r.booking_date, price: Number(r.price) })),
      ...(pkgUsageResult.error ? [] : (pkgUsageResult.data || []).map((r: { used_at: string; session_revenue: number }) => ({
        date: r.used_at?.slice(0, 10), price: Number(r.session_revenue),
      }))),
    ], setRevenueChartData)

    setLoadingRevenue(false)
  }, [dateFrom, dateTo, buildDailyChart])

  // ── Occupancy ────────────────────────────────────────────────────────────
  const fetchVenueOccupancy = useCallback(async () => {
    const startDate = new Date(dateFrom), endDate = new Date(dateTo)
    const days = Math.max(1, Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1)
    const totalSlots = days * 14

    const { data } = await supabase.from('arena_bookings')
      .select('booking_date, start_time, end_time')
      .eq('status', 'confirmed')
      .gte('booking_date', dateFrom).lte('booking_date', dateTo)

    if (!data || data.length === 0) { setVenueOccupancy(0); return }

    const hoursPerDay: Record<string, number> = {}
    data.forEach(b => {
      const date  = b.booking_date as string
      const startH = parseInt((b.start_time as string)?.slice(0, 2) || '0')
      const startM = parseInt((b.start_time as string)?.slice(3, 5) || '0')
      const endH   = parseInt((b.end_time   as string)?.slice(0, 2) || '0')
      const endM   = parseInt((b.end_time   as string)?.slice(3, 5) || '0')
      const dur    = ((endH * 60 + endM) - (startH * 60 + startM)) / 60
      hoursPerDay[date] = (hoursPerDay[date] || 0) + Math.max(0, dur)
    })
    const totalUsed = Object.values(hoursPerDay).reduce((sum, h) => sum + Math.min(h, 14), 0)
    setVenueOccupancy(Math.min(Math.round((totalUsed / totalSlots) * 100), 100))
  }, [dateFrom, dateTo])

  const fetchClassOccupancy = useCallback(async () => {
    const [schedulesRes, bookingsRes] = await Promise.all([
      supabase.from('arena_class_schedules').select('id', { count: 'exact', head: true })
        .eq('is_cancelled', false).gte('schedule_date', dateFrom).lte('schedule_date', dateTo),
      supabase.from('arena_class_bookings').select('id', { count: 'exact', head: true })
        .eq('status', 'confirmed').gte('paid_at', dateFrom + 'T00:00:00+07:00').lte('paid_at', dateTo + 'T23:59:59+07:00'),
    ])
    const totalCapacity = (schedulesRes.count || 0) * 40
    const rate = totalCapacity > 0 ? Math.round(((bookingsRes.count || 0) / totalCapacity) * 100) : 0
    setClassOccupancy(Math.min(rate, 100))
  }, [dateFrom, dateTo])

  // ── Effects ──────────────────────────────────────────────────────────────
  useEffect(() => {
    fetchSales()
    fetchRevenue()
    fetchVenueOccupancy()
    fetchClassOccupancy()
  }, [fetchSales, fetchRevenue, fetchVenueOccupancy, fetchClassOccupancy])

  // Auto-refresh every 30s
  const refreshRef = useRef({ fetchSales, fetchRevenue })
  refreshRef.current = { fetchSales, fetchRevenue }
  useEffect(() => {
    const id = setInterval(() => {
      refreshRef.current.fetchSales()
      refreshRef.current.fetchRevenue()
    }, 30000)
    return () => clearInterval(id)
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Arena Dashboard</h2>
      </div>

      {/* ── Period filter ─────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {PRESETS.map(p => (
          <button
            key={p.label}
            onClick={() => {
              const { from, to } = p.getValue()
              setDateFrom(from); setDateTo(to)
              setActivePreset(p.label); setShowCustom(false)
            }}
            style={{
              padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
              border: `1.5px solid ${activePreset === p.label ? 'var(--red)' : 'var(--border-strong)'}`,
              background: activePreset === p.label ? 'var(--red)' : 'var(--bg-input)',
              color: activePreset === p.label ? '#fff' : 'var(--text-primary)',
              fontSize: 13, fontWeight: 500, transition: 'all 0.15s',
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => { setShowCustom(!showCustom); setActivePreset('') }}
          style={{
            padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
            border: `1.5px solid ${showCustom ? 'var(--red)' : 'var(--border-strong)'}`,
            background: showCustom ? 'var(--red)' : 'var(--bg-input)',
            color: showCustom ? '#fff' : 'var(--text-muted)',
            fontSize: 13,
          }}
        >
          Custom ▾
        </button>
        {showCustom && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="date" value={dateFrom}
              onChange={e => { setDateFrom(e.target.value); setActivePreset('') }}
              style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 13 }}
            />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>s/d</span>
            <input type="date" value={dateTo}
              onChange={e => { setDateTo(e.target.value); setActivePreset('') }}
              style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 13 }}
            />
          </div>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {dateFrom === dateTo ? fmtDate(dateFrom) : `${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`}
        </span>
      </div>

      {/* ── SALES — dark theme ────────────────────────────────────────────── */}
      <div className="panel-dark" style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ background: '#111', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>💰</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>Sales</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Uang masuk berdasarkan tanggal transaksi</div>
          </div>
        </div>

        <div style={{ background: '#1a1a1a', padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {([
            { label: 'Total Sales', value: sales.total,   sub: `${salesCount} transaksi`,  color: '#fff' },
            { label: 'Class',       value: sales.class,   sub: 'Class booking',            color: '#60A5FA' },
            { label: 'Slot',        value: sales.slot,    sub: 'Individual',               color: '#34D399' },
            { label: 'Venue',       value: sales.venue,   sub: 'Korporasi',                color: '#F87171' },
            { label: 'Package',     value: sales.package, sub: 'Package orders',           color: '#A78BFA' },
          ] as { label: string; value: number; sub: string; color: string }[]).map((k, i) => (
            <div key={i} style={{ background: '#2a2a2a', borderRadius: 10, padding: '14px 16px', borderTop: `3px solid ${k.color}` }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: k.color }}>{loadingSales ? '...' : fmtRp(k.value)}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#111', padding: '20px 24px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Sales per Hari
          </div>
          <SalesBarChart data={salesChartData} />
        </div>
      </div>

      {/* ── REVENUE — red/light theme ─────────────────────────────────────── */}
      <div className="panel-light" style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{
          background: 'linear-gradient(135deg, var(--red) 0%, #922B21 100%)',
          padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ fontSize: 18 }}>📈</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>Revenue</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>Layanan terdelivered berdasarkan tanggal kelas/booking</div>
          </div>
        </div>

        <div style={{ background: '#FEF3F2', padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
          {([
            { label: 'Total Revenue', value: revenue.total,   sub: `${revenueCount} layanan`,  color: 'var(--text-primary)' },
            { label: 'Class',         value: revenue.class,   sub: 'Kelas berjalan',           color: '#2563EB' },
            { label: 'Slot',          value: revenue.slot,    sub: 'Individual',               color: '#059669' },
            { label: 'Venue',         value: revenue.venue,   sub: 'Korporasi',                color: 'var(--red)' },
            { label: 'Package',       value: revenue.package, sub: 'Sesi terpakai',            color: '#7C3AED' },
          ] as { label: string; value: number; sub: string; color: string }[]).map((k, i) => (
            <div key={i} style={{ background: '#fff', borderRadius: 10, padding: '14px 16px', borderTop: `3px solid ${k.color}`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: k.color }}>{loadingRevenue ? '...' : fmtRp(k.value)}</div>
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ background: '#FEF3F2', padding: '0 24px 24px', display: 'grid', gridTemplateColumns: '1fr 280px', gap: 20 }}>
          <div style={{ background: '#fff', borderRadius: 10, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Revenue per Hari</div>
            <RevenueLineChart data={revenueChartData} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ background: '#fff', borderRadius: 10, padding: 20, flex: 1, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Venue Occupancy</div>
              <OccupancyGauge value={venueOccupancy} color="var(--red)" />
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>dari 14 jam/hari</div>
            </div>
            <div style={{ background: '#fff', borderRadius: 10, padding: 20, flex: 1, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>Class Occupancy</div>
              <OccupancyGauge value={classOccupancy} color="#2563EB" />
              <div style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 8 }}>dari 40 peserta/kelas</div>
            </div>
          </div>
        </div>
      </div>

    </div>
  )
}
