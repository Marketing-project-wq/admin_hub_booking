import React, { useState, useEffect, useCallback } from 'react'
import { fmtRp, exportToCSV } from '../../lib/format'
import { getReportSummary, ymd, type ReportSummary } from '../../lib/clinic'

type Preset = 'this_month' | 'last_month' | 'last_3_months' | 'custom'

const PRESETS: { value: Preset; label: string }[] = [
  { value: 'this_month', label: 'Bulan Ini' },
  { value: 'last_month', label: 'Bulan Lalu' },
  { value: 'last_3_months', label: '3 Bulan Terakhir' },
  { value: 'custom', label: 'Custom' },
]

function presetRange(preset: Preset): { from: string; to: string } {
  const now = new Date()
  const y = now.getFullYear()
  const m = now.getMonth()
  if (preset === 'this_month') {
    return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) }
  }
  if (preset === 'last_month') {
    return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) }
  }
  // last_3_months: start of the month two months ago → today
  return { from: ymd(new Date(y, m - 2, 1)), to: ymd(now) }
}

export default function ClinicReports() {
  const [preset, setPreset] = useState<Preset>('this_month')
  const initial = presetRange('this_month')
  const [from, setFrom] = useState(initial.from)
  const [to, setTo] = useState(initial.to)

  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      setSummary(await getReportSummary(from, to))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat laporan')
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { fetchData() }, [fetchData])

  const handlePreset = (p: Preset) => {
    setPreset(p)
    if (p !== 'custom') {
      const r = presetRange(p)
      setFrom(r.from); setTo(r.to)
    }
  }

  const KPI = summary ? [
    { label: 'Total Revenue', value: fmtRp(summary.totalRevenue), color: '#059669' },
    { label: 'Total Kunjungan', value: String(summary.totalVisits), color: '#2563EB' },
    { label: 'Total Pasien Aktif', value: String(summary.totalPatients), color: '#7C3AED' },
    { label: 'Avg Revenue / Kunjungan', value: fmtRp(summary.avgRevenuePerVisit), color: '#D97706' },
  ] : []

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Laporan Clinic</h2>
      </div>

      <div className="filter-bar">
        <select value={preset} onChange={e => handlePreset(e.target.value as Preset)}>
          {PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Dari</label>
        <input type="date" value={from} onChange={e => { setPreset('custom'); setFrom(e.target.value) }} />
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sampai</label>
        <input type="date" value={to} onChange={e => { setPreset('custom'); setTo(e.target.value) }} />
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {loading ? (
        <p style={{ color: 'var(--text-muted)' }}>Memuat data...</p>
      ) : !summary ? null : (
        <>
          <div className="kpi-grid">
            {KPI.map(k => (
              <div key={k.label} className="kpi-card">
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{k.label}</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: k.color, marginTop: 6 }}>{k.value}</div>
              </div>
            ))}
          </div>

          <ReportTable
            title="Revenue per Layanan"
            onExport={() => exportToCSV(
              summary.byService.map(r => ({
                Layanan: r.name, Kunjungan: r.count, Revenue: r.revenue,
                Persen: summary.totalRevenue > 0 ? `${((r.revenue / summary.totalRevenue) * 100).toFixed(1)}%` : '0%',
              })),
              'clinic_revenue_per_layanan',
            )}
            head={['Layanan', 'Kunjungan', 'Revenue', '% dari Total']}
            rows={summary.byService.map(r => [
              r.name,
              String(r.count),
              fmtRp(r.revenue),
              summary.totalRevenue > 0 ? `${((r.revenue / summary.totalRevenue) * 100).toFixed(1)}%` : '0%',
            ])}
          />

          <ReportTable
            title="Revenue per Staff"
            onExport={() => exportToCSV(
              summary.byStaff.map(r => ({ Staff: r.name, Kunjungan: r.count, Revenue: r.revenue })),
              'clinic_revenue_per_staff',
            )}
            head={['Staff', 'Kunjungan', 'Revenue']}
            rows={summary.byStaff.map(r => [r.name, String(r.count), fmtRp(r.revenue)])}
          />

          <ReportTable
            title="Metode Pembayaran"
            onExport={() => exportToCSV(
              summary.byPaymentMethod.map(r => ({ Metode: r.method, Jumlah: r.count, Revenue: r.revenue })),
              'clinic_metode_pembayaran',
            )}
            head={['Metode', 'Jumlah', 'Total']}
            rows={summary.byPaymentMethod.map(r => [r.method, String(r.count), fmtRp(r.revenue)])}
          />
        </>
      )}
    </div>
  )
}

function ReportTable({ title, head, rows, onExport }: {
  title: string; head: string[]; rows: string[][]; onExport: () => void
}) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{title}</h3>
        <button className="btn-secondary" onClick={onExport} disabled={rows.length === 0}>Export CSV</button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>{head.map((h, i) => <th key={i} style={i > 0 ? { textAlign: 'right' } : undefined}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={head.length} className="empty-state">Tidak ada data</td></tr>
            ) : rows.map((r, ri) => (
              <tr key={ri}>
                {r.map((c, ci) => (
                  <td key={ci} style={ci > 0 ? { textAlign: 'right', whiteSpace: 'nowrap' } : undefined}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
