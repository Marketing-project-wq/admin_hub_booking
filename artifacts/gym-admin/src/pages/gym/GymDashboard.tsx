import React, { useState, useEffect, useCallback } from 'react'
import { supabase, fmtRp, fmtDate, fmtTime, STATUS_LABEL } from '@workspace/admin-shared'

// ─── Date helpers ────────────────────────────────────────────────────────────
const toDay = () => new Date().toISOString().slice(0, 10)
const toYesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10) }
const toDaysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const toStartOfMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const toStartOfLastMonth = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01` }
const toEndOfLastMonth = () => { const d = new Date(); d.setDate(0); return d.toISOString().slice(0, 10) }

const PRESETS = [
  { label: 'Hari Ini', getValue: () => ({ from: toDay(), to: toDay() }) },
  { label: 'Kemarin', getValue: () => ({ from: toYesterday(), to: toYesterday() }) },
  { label: '7 Hari', getValue: () => ({ from: toDaysAgo(6), to: toDay() }) },
  { label: 'Bulan Ini', getValue: () => ({ from: toStartOfMonth(), to: toDay() }) },
  { label: 'Bulan Lalu', getValue: () => ({ from: toStartOfLastMonth(), to: toEndOfLastMonth() }) },
]

interface DayPoint { label: string; date: string; total: number }
type Row = Record<string, unknown>

function SalesBarChart({ data }: { data: DayPoint[] }) {
  if (!data || data.length === 0) return (
    <div style={{ textAlign: 'center', padding: 40, color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>Tidak ada data</div>
  )
  const maxVal = Math.max(...data.map(d => d.total), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 120, padding: '0 4px' }}>
      {data.map((d, i) => {
        const h = Math.max((d.total / maxVal) * 100, d.total > 0 ? 4 : 0)
        return (
          <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div title={`${d.label}: ${fmtRp(d.total)}`} style={{
              width: '100%', height: `${h}%`,
              background: 'linear-gradient(180deg, #C0392B 0%, #922B21 100%)',
              borderRadius: '3px 3px 0 0', minHeight: d.total > 0 ? 4 : 0, alignSelf: 'flex-end',
            }} />
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.4)', whiteSpace: 'nowrap' }}>{d.label}</div>
          </div>
        )
      })}
    </div>
  )
}

export default function GymDashboard() {
  const [dateFrom, setDateFrom] = useState(toStartOfMonth)
  const [dateTo, setDateTo] = useState(toDay)
  const [activePreset, setActivePreset] = useState('Bulan Ini')
  const [showCustom, setShowCustom] = useState(false)

  const [loading, setLoading] = useState(true)
  const [sales, setSales] = useState({ total: 0, class: 0, membership: 0 })
  const [counts, setCounts] = useState({ class: 0, membership: 0 })
  const [activeMembers, setActiveMembers] = useState(0)
  const [chart, setChart] = useState<DayPoint[]>([])
  const [recent, setRecent] = useState<Row[]>([])

  const fetchData = useCallback(async () => {
    setLoading(true)
    const start = dateFrom + 'T00:00:00+07:00'
    const end = dateTo + 'T23:59:59+07:00'

    const [cls, mem, activeRes, recentRes] = await Promise.all([
      supabase.from('gym_class_bookings').select('price, paid_at')
        .eq('status', 'confirmed').not('paid_at', 'is', null).gte('paid_at', start).lte('paid_at', end),
      supabase.from('gym_membership_orders').select('price, paid_at')
        .eq('status', 'confirmed').not('paid_at', 'is', null).gte('paid_at', start).lte('paid_at', end),
      supabase.from('gym_memberships').select('id', { count: 'exact', head: true })
        .eq('is_active', true).gte('end_date', toDay()),
      supabase.from('gym_class_bookings')
        .select('id, booking_code, full_name, price, status, created_at, schedule:gym_class_schedules(schedule_date, start_time, class_type:gym_class_types(name, color))')
        .order('created_at', { ascending: false }).limit(8),
    ])

    const sum = (d: { price: number }[] | null) => (d || []).reduce((s, r) => s + Number(r.price), 0)
    const clsAmt = sum(cls.data as { price: number }[] | null)
    const memAmt = sum(mem.data as { price: number }[] | null)
    setSales({ total: clsAmt + memAmt, class: clsAmt, membership: memAmt })
    setCounts({ class: cls.data?.length || 0, membership: mem.data?.length || 0 })
    setActiveMembers(activeRes.count || 0)
    setRecent((recentRes.data as Row[]) || [])

    // Daily chart (gabungan class + membership sales)
    const byDay: Record<string, number> = {}
    ;[...(cls.data || []), ...(mem.data || [])].forEach((r: { paid_at?: string; price?: number }) => {
      const d = r.paid_at?.slice(0, 10)
      if (d) byDay[d] = (byDay[d] || 0) + Number(r.price || 0)
    })
    const points: DayPoint[] = []
    const s = new Date(dateFrom), e = new Date(dateTo)
    for (const d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
      const key = d.toISOString().slice(0, 10)
      points.push({ label: `${d.getDate()}/${d.getMonth() + 1}`, date: key, total: byDay[key] || 0 })
    }
    setChart(points)
    setLoading(false)
  }, [dateFrom, dateTo])

  useEffect(() => { fetchData() }, [fetchData])

  const kpis = [
    { label: 'Total Sales', value: fmtRp(sales.total), sub: `${counts.class + counts.membership} transaksi`, color: '#fff' },
    { label: 'Class', value: fmtRp(sales.class), sub: `${counts.class} booking`, color: '#60A5FA' },
    { label: 'Membership', value: fmtRp(sales.membership), sub: `${counts.membership} order`, color: '#A78BFA' },
    { label: 'Member Aktif', value: String(activeMembers), sub: 'per hari ini', color: '#34D399' },
  ]

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Gym Dashboard</h2>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 24 }}>
        {PRESETS.map(p => (
          <button key={p.label} onClick={() => { const { from, to } = p.getValue(); setDateFrom(from); setDateTo(to); setActivePreset(p.label); setShowCustom(false) }}
            style={{
              padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
              border: `1.5px solid ${activePreset === p.label ? 'var(--text-primary)' : 'var(--border)'}`,
              background: activePreset === p.label ? 'var(--text-primary)' : '#fff',
              color: activePreset === p.label ? '#fff' : 'var(--text-primary)', fontSize: 13, fontWeight: 500,
            }}>
            {p.label}
          </button>
        ))}
        <button onClick={() => { setShowCustom(!showCustom); setActivePreset('') }}
          style={{
            padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
            border: `1.5px solid ${showCustom ? 'var(--text-primary)' : 'var(--border)'}`,
            background: showCustom ? 'var(--text-primary)' : '#fff',
            color: showCustom ? '#fff' : 'var(--text-muted)', fontSize: 13,
          }}>
          Custom ▾
        </button>
        {showCustom && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setActivePreset('') }}
              style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
            <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>s/d</span>
            <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setActivePreset('') }}
              style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
          </div>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {dateFrom === dateTo ? fmtDate(dateFrom) : `${fmtDate(dateFrom)} — ${fmtDate(dateTo)}`}
        </span>
      </div>

      {/* Sales panel (dark) */}
      <div style={{ borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
        <div style={{ background: 'var(--text-primary)', padding: '16px 24px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>💰</span>
          <div>
            <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>Sales</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)' }}>Uang masuk (confirmed) berdasarkan tanggal bayar</div>
          </div>
        </div>
        <div style={{ background: '#1a1a1a', padding: '20px 24px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {kpis.map((k, i) => (
            <div key={i} style={{ background: '#2a2a2a', borderRadius: 10, padding: '14px 16px', borderTop: `3px solid ${k.color}` }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{k.label}</div>
              <div style={{ fontWeight: 700, fontSize: 18, color: k.color }}>{loading ? '...' : k.value}</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>{k.sub}</div>
            </div>
          ))}
        </div>
        <div style={{ background: '#111', padding: '20px 24px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginBottom: 16, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Sales per Hari</div>
          <SalesBarChart data={chart} />
        </div>
      </div>

      {/* Recent bookings */}
      <div className="table-wrap">
        <div style={{ padding: '14px 18px', fontWeight: 600, fontSize: 15, borderBottom: '1px solid var(--border)' }}>Booking Terbaru</div>
        <table className="data-table">
          <thead>
            <tr><th>Booking Code</th><th>Kelas</th><th>Jadwal</th><th>Nama</th><th>Amount</th><th>Status</th></tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={6}>Memuat data...</td></tr>
            ) : recent.length === 0 ? (
              <tr><td colSpan={6} className="empty-state">Belum ada booking</td></tr>
            ) : recent.map(row => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status as string, css: '' }
              const sch = row.schedule as Row | undefined
              const ct = sch?.class_type as Row | undefined
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.booking_code as string}</td>
                  <td>{!!ct?.color && <span style={{ color: ct.color as string, marginRight: 4 }}>●</span>}{(ct?.name as string) || '-'}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(sch?.schedule_date as string)} {fmtTime(sch?.start_time as string)}</td>
                  <td>{row.full_name as string}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(row.price as number)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
