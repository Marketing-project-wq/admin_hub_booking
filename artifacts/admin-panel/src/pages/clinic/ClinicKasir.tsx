import React, { useState, useEffect, useCallback, useRef } from 'react'
import { fmtRp, fmtDate, fmtDateTime, exportToCSV } from '../../lib/format'
import { todayISO } from '../../lib/clinic'
import { listTransactions, getTodaySummary, type ClinicTransaction } from '../../lib/clinicBilling'
import ClinicReceiptModal from '../../components/clinic/ClinicReceiptModal'
import LockBadge from '../../components/clinic/LockBadge'

const PAGE_SIZE = 20

const METHOD_FILTERS = ['all', 'cash', 'transfer', 'qris', 'debit', 'kredit']
const METHOD_LABEL: Record<string, string> = { all: 'Semua', cash: 'Cash', transfer: 'Transfer', qris: 'QRIS', debit: 'Debit', kredit: 'Kredit' }

function methodBadgeStyle(method: string): React.CSSProperties {
  switch (method) {
    case 'cash': return { background: '#DCFCE7', color: '#166534' }
    case 'transfer': return { background: '#DBEAFE', color: '#1D4ED8' }
    case 'qris': return { background: '#EDE9FE', color: '#7C3AED' }
    case 'kredit': return { background: '#FEF3C7', color: '#92400E' }
    default: return { background: '#F3F4F6', color: '#6B7280' } // debit & fallback
  }
}

interface Summary {
  totalTransactions: number; totalRevenue: number
  byCash: number; byTransfer: number; byQris: number; byCard: number
}

export default function ClinicKasir() {
  const [rows, setRows] = useState<ClinicTransaction[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [summary, setSummary] = useState<Summary | null>(null)
  const [dateFrom, setDateFrom] = useState(todayISO())
  const [dateTo, setDateTo] = useState(todayISO())
  const [method, setMethod] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [receipt, setReceipt] = useState<ClinicTransaction | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { rows: r, count } = await listTransactions({
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        paymentMethod: method,
        search,
        page,
        pageSize: PAGE_SIZE,
      })
      setRows(r); setTotal(count); setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat transaksi')
    } finally {
      setLoading(false)
    }
  }, [dateFrom, dateTo, method, search, page])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    getTodaySummary().then(setSummary).catch(() => {})
  }, [rows])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const handleExport = async () => {
    try {
      const { rows: all } = await listTransactions({
        dateFrom: dateFrom || undefined, dateTo: dateTo || undefined,
        paymentMethod: method, search, page: 0, pageSize: 1000,
      })
      exportToCSV(all.map(t => ({
        Kode: t.transaction_code,
        Pasien: t.patient?.full_name ?? '',
        Layanan: t.service_name,
        Total: t.total_amount,
        Metode: t.payment_method,
        Tanggal: fmtDateTime(t.created_at),
      })), 'clinic_kasir')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal export CSV')
    }
  }

  const KPI = summary ? [
    { label: 'Total Transaksi', value: String(summary.totalTransactions), color: '#2563EB' },
    { label: 'Total Revenue', value: fmtRp(summary.totalRevenue), color: '#059669' },
    { label: 'Tunai', value: fmtRp(summary.byCash), color: '#166534' },
    { label: 'Non-Tunai', value: fmtRp(summary.byTransfer + summary.byQris + summary.byCard), color: '#7C3AED' },
  ] : []

  const from = total > 0 ? page * PAGE_SIZE + 1 : 0
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Kasir</h2>
        <button className="btn-secondary" style={{ width: 'auto', padding: '8px 16px' }} onClick={handleExport}>Export CSV</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="kpi-grid">
        {KPI.map(k => (
          <div key={k.label} className="kpi-card">
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: k.color, marginTop: 6 }}>{k.value}</div>
          </div>
        ))}
        <div style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'end', gridColumn: '1 / -1' }}>KPI menampilkan ringkasan hari ini.</div>
      </div>

      <div className="filter-bar">
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Dari</label>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} />
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sampai</label>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} />
        <select value={method} onChange={e => { setMethod(e.target.value); setPage(0) }}>
          {METHOD_FILTERS.map(m => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
        </select>
        <input type="text" placeholder="Cari kode / layanan..." value={searchInput} onChange={e => handleSearchChange(e.target.value)} style={{ minWidth: 200 }} />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Kode</th><th>Pasien</th><th>Layanan</th><th>Total</th><th>Metode</th><th>Tanggal</th><th>Status</th><th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={8}>Memuat data...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">Tidak ada transaksi</td></tr>
            ) : rows.map(t => {
              const lk = t as ClinicTransaction & { is_locked?: boolean; locked_at?: string | null; locked_by?: string | null }
              return (
              <tr key={t.id}>
                <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{t.transaction_code}</td>
                <td>{t.patient?.full_name || '-'}</td>
                <td>{t.service_name}</td>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(t.total_amount)}</td>
                <td><span className="badge" style={methodBadgeStyle(t.payment_method)}>{METHOD_LABEL[t.payment_method] || t.payment_method}</span></td>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(t.created_at)}</td>
                <td>
                  <LockBadge
                    isLocked={!!lk.is_locked}
                    lockedAt={lk.locked_at ?? null}
                    lockedBy={lk.locked_by ?? null}
                    recordId={t.id}
                    table="clinic_transactions"
                    onUnlocked={fetchData}
                    onRelocked={fetchData}
                  />
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="action-btn detail" onClick={() => setReceipt(t)}>Kwitansi</button>
                </td>
              </tr>
              )
            })}
          </tbody>
        </table>
        <div className="pagination">
          <span>{total > 0 ? `${from}–${to} dari ${total} hasil` : '0 hasil'}</span>
          <div className="pagination-btns">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>

      {receipt && <ClinicReceiptModal transaction={receipt} onClose={() => setReceipt(null)} />}
    </div>
  )
}
