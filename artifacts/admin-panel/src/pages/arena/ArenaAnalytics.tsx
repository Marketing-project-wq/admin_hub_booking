import React, { useState } from 'react'

const REPORTS = [
  {
    id: 'overview',
    label: 'Overview',
    url: 'https://analytics.google.com/analytics/web/#/p{PROPERTY_ID}/reports/reportinghub',
  },
  {
    id: 'realtime',
    label: 'Real-time',
    url: 'https://analytics.google.com/analytics/web/#/p{PROPERTY_ID}/reports/realtime',
  },
  {
    id: 'pages',
    label: 'Pages & Screens',
    url: 'https://analytics.google.com/analytics/web/#/p{PROPERTY_ID}/reports/explorer?params=_u..nav%3Dmaui&r=all-pages-and-screens',
  },
  {
    id: 'events',
    label: 'Events',
    url: 'https://analytics.google.com/analytics/web/#/p{PROPERTY_ID}/reports/explorer?params=_u..nav%3Dmaui&r=key-events',
  },
  {
    id: 'funnel',
    label: 'Booking Funnel',
    url: 'https://analytics.google.com/analytics/web/#/p{PROPERTY_ID}/reports/explorer?params=_u..nav%3Dmaui&r=key-events',
  },
]

const GA_MEASUREMENT_ID = 'G-70JD631GZC'
const GA_PROPERTY_ID = '{{GA_PROPERTY_ID}}' // perlu diisi manual dari GA dashboard

export default function ArenaAnalytics() {
  const [activeReport, setActiveReport] = useState('overview')
  const [showGuide, setShowGuide] = useState(false)

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Analytics</h1>
          <p style={{ fontSize: 13, color: '#6B7280', marginTop: 4 }}>
            Booking app traffic & user behavior · GA4: {GA_MEASUREMENT_ID}
          </p>
        </div>
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="btn-secondary"
          style={{ width: 'auto' }}
        >
          {showGuide ? 'Sembunyikan' : '? Cara Buka'}
        </button>
      </div>

      {/* Guide */}
      {showGuide && (
        <div style={{ background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 12, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#1D4ED8', marginBottom: 8 }}>
            Cara melihat data Analytics:
          </div>
          <ol style={{ fontSize: 13, color: '#374151', lineHeight: 2, margin: 0, paddingLeft: 20 }}>
            <li>Klik tombol "Buka Google Analytics →" di bawah</li>
            <li>Login dengan akun Google yang punya akses ke property 20FIT</li>
            <li>Data booking, page views, dan events akan tampil di sana</li>
          </ol>
          <div style={{ marginTop: 12, fontSize: 12, color: '#6B7280' }}>
            Measurement ID: <strong style={{ fontFamily: 'monospace' }}>{GA_MEASUREMENT_ID}</strong>
          </div>
        </div>
      )}

      {/* KPI Cards - dari GA4 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Lihat data di', value: 'Google Analytics', sub: 'Real-time tersedia', color: '#1D4ED8' },
          { label: 'Tracking', value: 'Active', sub: GA_MEASUREMENT_ID, color: '#065F46' },
          { label: 'Events tracked', value: '8 events', sub: 'booking, click, discover', color: '#92400E' },
          { label: 'Booking funnel', value: 'Configured', sub: 'select → checkout → confirm', color: '#5B21B6' },
        ].map(card => (
          <div key={card.label} style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: '14px 16px' }}>
            <div style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{card.label}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: card.color }}>{card.value}</div>
            <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 2 }}>{card.sub}</div>
          </div>
        ))}
      </div>

      {/* Quick links */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20, marginBottom: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 16 }}>Quick Access</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {[
            { label: '📊 Overview Dashboard', url: 'https://analytics.google.com/analytics/web/#/p489797954/reports/reportinghub', desc: 'Summary semua metrics' },
            { label: '🔴 Real-time', url: 'https://analytics.google.com/analytics/web/#/p489797954/realtime/overview', desc: 'User aktif sekarang' },
            { label: '📄 Pages & Screens', url: 'https://analytics.google.com/analytics/web/#/p489797954/reports/explorer?r=all-pages-and-screens', desc: 'Halaman paling banyak dikunjungi' },
            { label: '🎯 Key Events', url: 'https://analytics.google.com/analytics/web/#/p489797954/reports/explorer?r=key-events', desc: 'Booking, click, discover' },
            { label: '👥 Users', url: 'https://analytics.google.com/analytics/web/#/p489797954/reports/explorer?r=user-demographics-overview', desc: 'Demografi pengunjung' },
            { label: '📱 Devices', url: 'https://analytics.google.com/analytics/web/#/p489797954/reports/explorer?r=tech-overview', desc: 'Mobile vs desktop' },
          ].map(link => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'block', padding: '12px 14px',
                border: '1px solid #E5E7EB', borderRadius: 10,
                textDecoration: 'none', color: DARK,
                transition: 'border-color 0.2s',
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 2 }}>{link.label}</div>
              <div style={{ fontSize: 11, color: '#9CA3AF' }}>{link.desc}</div>
            </a>
          ))}
        </div>
      </div>

      {/* Main CTA */}
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <a
          href="https://analytics.google.com/analytics/web/#/p489797954/reports/reportinghub"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 8,
            padding: '14px 32px', background: '#C0392B', color: '#fff',
            borderRadius: 12, textDecoration: 'none',
            fontWeight: 700, fontSize: 15,
          }}
        >
          Buka Google Analytics →
        </a>
        <p style={{ fontSize: 12, color: '#9CA3AF', marginTop: 8 }}>
          Login dengan akun Google yang memiliki akses ke property 20FIT
        </p>
      </div>

      {/* Events Reference */}
      <div style={{ background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12, padding: 20 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Events yang Di-track</div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E5E7EB' }}>
              <th style={{ textAlign: 'left', padding: '8px 0', color: '#6B7280', fontWeight: 600 }}>Event Name</th>
              <th style={{ textAlign: 'left', padding: '8px 0', color: '#6B7280', fontWeight: 600 }}>Trigger</th>
              <th style={{ textAlign: 'left', padding: '8px 0', color: '#6B7280', fontWeight: 600 }}>Parameters</th>
            </tr>
          </thead>
          <tbody>
            {[
              { event: 'select_service', trigger: 'Klik Book Arena/Gym/Clinic', params: 'service_name' },
              { event: 'select_date', trigger: 'Pilih tanggal booking', params: 'selected_date' },
              { event: 'add_to_cart', trigger: 'Tambah class ke cart', params: 'item_name, value' },
              { event: 'begin_checkout', trigger: 'Klik Checkout', params: 'value, currency' },
              { event: 'purchase', trigger: 'Booking berhasil', params: 'transaction_id, value, booking_type' },
              { event: 'open_discover', trigger: 'Klik Discover button', params: '-' },
              { event: 'select_discover_category', trigger: 'Pilih kategori discover', params: 'category' },
              { event: 'click_app_store', trigger: 'Klik download App Store', params: '-' },
              { event: 'click_play_store', trigger: 'Klik download Play Store', params: '-' },
            ].map(row => (
              <tr key={row.event} style={{ borderBottom: '1px solid #F3F4F6' }}>
                <td style={{ padding: '10px 0', fontFamily: 'monospace', fontSize: 12, color: '#C0392B' }}>{row.event}</td>
                <td style={{ padding: '10px 0', color: '#374151' }}>{row.trigger}</td>
                <td style={{ padding: '10px 0', fontFamily: 'monospace', fontSize: 11, color: '#6B7280' }}>{row.params}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const DARK = '#080808'
