import React, { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface AnalyticsSummary {
  totalSessions: number
  totalPageViews: number
  totalEvents: number
  avgTimeOnPage: number
  mobilePercent: number
  desktopPercent: number
}

interface TopPage {
  page_path: string
  views: number
  avg_duration: number
}

interface EventCount {
  event_name: string
  count: number
}

interface FunnelStep {
  label: string
  event: string
  count: number
  percent: number
}

interface DailyStats {
  date: string
  sessions: number
  pageViews: number
}

export default function ArenaAnalytics() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null)
  const [topPages, setTopPages] = useState<TopPage[]>([])
  const [eventCounts, setEventCounts] = useState<EventCount[]>([])
  const [funnel, setFunnel] = useState<FunnelStep[]>([])
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([])
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState<'today' | '7d' | '30d'>('7d')

  const fetchAnalytics = async () => {
    setLoading(true)
    try {
      const now = new Date()
      const from = new Date()
      if (dateRange === 'today') from.setHours(0, 0, 0, 0)
      else if (dateRange === '7d') from.setDate(now.getDate() - 7)
      else from.setDate(now.getDate() - 30)
      const fromISO = from.toISOString()

      // Fetch semua events dalam range
      const { data: events } = await supabase
        .from('analytics_events')
        .select('*')
        .gte('created_at', fromISO)
        .order('created_at', { ascending: false })

      if (!events) return

      // Summary
      const sessions = new Set(events.map(e => e.session_id)).size
      const pageViews = events.filter(e => e.event_name === 'page_view').length
      const totalEvents = events.filter(e => e.event_name !== 'page_view' && e.event_name !== 'page_leave').length
      const leaveEvents = events.filter(e => e.event_name === 'page_leave' && e.properties?.duration_seconds)
      const avgTime = leaveEvents.length > 0
        ? Math.round(leaveEvents.reduce((sum, e) => sum + (e.properties.duration_seconds as number), 0) / leaveEvents.length)
        : 0
      const mobile = events.filter(e => e.device_type === 'mobile').length
      const desktop = events.filter(e => e.device_type === 'desktop').length
      const total = mobile + desktop || 1

      setSummary({
        totalSessions: sessions,
        totalPageViews: pageViews,
        totalEvents,
        avgTimeOnPage: avgTime,
        mobilePercent: Math.round(mobile / total * 100),
        desktopPercent: Math.round(desktop / total * 100),
      })

      // Top pages
      const pageMap: Record<string, { views: number; durations: number[] }> = {}
      events.filter(e => e.event_name === 'page_view').forEach(e => {
        const path = e.page_path ?? '/'
        if (!pageMap[path]) pageMap[path] = { views: 0, durations: [] }
        pageMap[path].views++
      })
      events.filter(e => e.event_name === 'page_leave').forEach(e => {
        const path = e.page_path ?? '/'
        if (pageMap[path] && e.properties?.duration_seconds) {
          pageMap[path].durations.push(e.properties.duration_seconds as number)
        }
      })
      const topPagesData = Object.entries(pageMap)
        .map(([path, data]) => ({
          page_path: path,
          views: data.views,
          avg_duration: data.durations.length > 0
            ? Math.round(data.durations.reduce((a, b) => a + b, 0) / data.durations.length)
            : 0,
        }))
        .sort((a, b) => b.views - a.views)
        .slice(0, 8)
      setTopPages(topPagesData)

      // Event counts
      const eventMap: Record<string, number> = {}
      events
        .filter(e => e.event_name !== 'page_view' && e.event_name !== 'page_leave')
        .forEach(e => {
          eventMap[e.event_name] = (eventMap[e.event_name] ?? 0) + 1
        })
      const eventData = Object.entries(eventMap)
        .map(([event_name, count]) => ({ event_name, count }))
        .sort((a, b) => b.count - a.count)
      setEventCounts(eventData)

      // Funnel
      const funnelEvents = ['page_view', 'select_service', 'begin_checkout', 'purchase']
      const funnelLabels = ['Landing Page', 'Pilih Service', 'Checkout', 'Booking Selesai']
      const funnelCounts = funnelEvents.map(ev =>
        ev === 'page_view'
          ? new Set(events.filter(e => e.event_name === 'page_view' && e.page_path === '/').map(e => e.session_id)).size
          : new Set(events.filter(e => e.event_name === ev).map(e => e.session_id)).size
      )
      const maxCount = funnelCounts[0] || 1
      setFunnel(funnelEvents.map((ev, i) => ({
        label: funnelLabels[i],
        event: ev,
        count: funnelCounts[i],
        percent: Math.round(funnelCounts[i] / maxCount * 100),
      })))

      // Daily stats (last 7 or 30 days)
      const days = dateRange === 'today' ? 1 : dateRange === '7d' ? 7 : 30
      const dailyMap: Record<string, { sessions: Set<string>; pageViews: number }> = {}
      for (let i = 0; i < days; i++) {
        const d = new Date()
        d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        dailyMap[key] = { sessions: new Set(), pageViews: 0 }
      }
      events.forEach(e => {
        const key = e.created_at.slice(0, 10)
        if (dailyMap[key]) {
          dailyMap[key].sessions.add(e.session_id)
          if (e.event_name === 'page_view') dailyMap[key].pageViews++
        }
      })
      const dailyData = Object.entries(dailyMap)
        .map(([date, data]) => ({
          date,
          sessions: data.sessions.size,
          pageViews: data.pageViews,
        }))
        .sort((a, b) => a.date.localeCompare(b.date))
      setDailyStats(dailyData)

    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAnalytics() }, [dateRange])

  return (
    <div className="page-container">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            Booking app traffic & user behavior
          </p>
        </div>
        {/* Date range selector */}
        <div style={{ display: 'flex', gap: 8 }}>
          {(['today', '7d', '30d'] as const).map(range => (
            <button
              key={range}
              onClick={() => setDateRange(range)}
              style={{
                padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                border: `1px solid ${dateRange === range ? '#C0392B' : '#E5E7EB'}`,
                background: dateRange === range ? '#C0392B' : '#fff',
                color: dateRange === range ? '#fff' : '#374151',
                cursor: 'pointer',
              }}
            >
              {range === 'today' ? 'Hari Ini' : range === '7d' ? '7 Hari' : '30 Hari'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#9CA3AF' }}>Memuat data...</div>
      ) : (
        <>
          {/* Summary KPI */}
          {summary && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 24 }}>
              {[
                { label: 'Sessions', value: summary.totalSessions, icon: '👥', color: '#1D4ED8' },
                { label: 'Page Views', value: summary.totalPageViews, icon: '👁', color: '#065F46' },
                { label: 'Events', value: summary.totalEvents, icon: '🎯', color: '#92400E' },
                { label: 'Avg Time (detik)', value: summary.avgTimeOnPage + 's', icon: '⏱', color: '#5B21B6' },
                { label: 'Mobile', value: summary.mobilePercent + '%', icon: '📱', color: '#C0392B' },
                { label: 'Desktop', value: summary.desktopPercent + '%', icon: '🖥', color: '#374151' },
              ].map(card => (
                <div key={card.label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
                  <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                    {card.icon} {card.label}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: card.color }}>{card.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Booking Funnel */}
          {funnel.length > 0 && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Booking Funnel</div>
              {funnel.map((step, i) => (
                <div key={step.event} style={{ marginBottom: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
                    <span style={{ color: '#374151', fontWeight: 500 }}>{i + 1}. {step.label}</span>
                    <span style={{ color: '#6B7280', fontFamily: 'monospace' }}>{step.count} ({step.percent}%)</span>
                  </div>
                  <div style={{ background: '#F3F4F6', borderRadius: 999, height: 8, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 999,
                      background: i === 0 ? '#1D4ED8' : i === 1 ? '#059669' : i === 2 ? '#F59E0B' : '#C0392B',
                      width: `${step.percent}%`,
                      transition: 'width 0.5s ease',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Daily chart (simple bar) */}
          {dailyStats.length > 1 && (
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Page Views per Hari</div>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80 }}>
                {dailyStats.map(day => {
                  const maxViews = Math.max(...dailyStats.map(d => d.pageViews), 1)
                  const height = Math.max((day.pageViews / maxViews) * 80, 2)
                  return (
                    <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                      <div style={{ fontSize: 9, color: '#9CA3AF' }}>{day.pageViews || ''}</div>
                      <div style={{ width: '100%', background: '#C0392B', borderRadius: 3, height }} title={`${day.date}: ${day.pageViews} views`} />
                      <div style={{ fontSize: 8, color: '#9CA3AF', transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>
                        {day.date.slice(5)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Top Pages & Events side by side */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
            {/* Top Pages */}
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Top Pages</div>
              {topPages.length === 0 ? (
                <p style={{ color: '#9CA3AF', fontSize: 13 }}>Belum ada data</p>
              ) : topPages.map(page => (
                <div key={page.page_path} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F3F4F6', fontSize: 12 }}>
                  <span style={{ color: '#374151', fontFamily: 'monospace', fontSize: 11 }}>{page.page_path}</span>
                  <div style={{ display: 'flex', gap: 12, flexShrink: 0 }}>
                    <span style={{ color: '#1D4ED8', fontWeight: 600 }}>{page.views}x</span>
                    <span style={{ color: '#9CA3AF' }}>{page.avg_duration}s</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Events */}
            <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Top Events</div>
              {eventCounts.length === 0 ? (
                <p style={{ color: '#9CA3AF', fontSize: 13 }}>Belum ada data</p>
              ) : eventCounts.map(ev => (
                <div key={ev.event_name} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #F3F4F6', fontSize: 12 }}>
                  <span style={{ color: '#C0392B', fontFamily: 'monospace', fontSize: 11 }}>{ev.event_name}</span>
                  <span style={{ color: '#374151', fontWeight: 600 }}>{ev.count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Empty state */}
          {summary?.totalPageViews === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px', color: '#9CA3AF' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📊</div>
              <p>Belum ada data untuk periode ini.</p>
              <p style={{ fontSize: 12 }}>Data akan muncul setelah ada pengunjung di booking.20fit.id</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
