import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '@workspace/admin-shared'
import { fmtDateTime } from '@workspace/admin-shared'
import { listAuditLogs, type AuditLog } from '../../lib/clinic'

const PAGE_SIZE = 20

const RECORD_TYPES = ['all', 'clinic_screenings', 'clinic_consents', 'clinic_assessments', 'clinic_transactions']
const RECORD_LABEL: Record<string, string> = {
  all: 'Semua',
  clinic_screenings: 'Screening',
  clinic_consents: 'Consent',
  clinic_assessments: 'Assessment',
  clinic_transactions: 'Transaksi',
}

function ActionBadge({ action }: { action: string }) {
  const map: Record<string, { label: string; style: React.CSSProperties }> = {
    unlock: { label: '🔓 Dibuka', style: { background: '#FEF3C7', color: '#92400E' } },
    relock: { label: '🔒 Dikunci', style: { background: '#D1FAE5', color: '#065F46' } },
  }
  const m = map[action] ?? { label: action, style: { background: '#F3F4F6', color: '#374151' } }
  return <span className="badge" style={m.style}>{m.label}</span>
}

export default function ClinicAuditLog() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'super_admin'

  const [rows, setRows] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [recordType, setRecordType] = useState('all')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const { rows: r, count } = await listAuditLogs({
        recordType: recordType === 'all' ? undefined : recordType,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search || undefined,
        page,
        pageSize: PAGE_SIZE,
      })
      setRows(r); setTotal(count); setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal memuat audit log')
    } finally {
      setLoading(false)
    }
  }, [recordType, dateFrom, dateTo, search, page])

  useEffect(() => { if (isSuperAdmin) fetchData() }, [isSuperAdmin, fetchData])

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  if (!isSuperAdmin) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
        🔒 Akses ditolak. Halaman ini hanya untuk super admin.
      </div>
    )
  }

  const from = total > 0 ? page * PAGE_SIZE + 1 : 0
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <div>
          <h2 className="page-title" style={{ margin: 0 }}>Audit Log</h2>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '2px 0 0' }}>Riwayat perubahan data terkunci</p>
        </div>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <select value={recordType} onChange={e => { setRecordType(e.target.value); setPage(0) }}>
          {RECORD_TYPES.map(t => <option key={t} value={t}>{RECORD_LABEL[t]}</option>)}
        </select>
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Dari</label>
        <input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(0) }} />
        <label style={{ fontSize: 13, color: 'var(--text-muted)' }}>Sampai</label>
        <input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(0) }} />
        <input type="text" placeholder="Cari nama yang melakukan..." value={searchInput} onChange={e => handleSearchChange(e.target.value)} style={{ minWidth: 200 }} />
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Tanggal</th><th>Aksi</th><th>Tipe Record</th><th>Record ID</th><th>Dilakukan Oleh</th><th>Role</th><th>Alasan</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={7}>Memuat data...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="empty-state">Tidak ada log</td></tr>
            ) : rows.map(r => (
              <tr key={r.id}>
                <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDateTime(r.created_at)}</td>
                <td><ActionBadge action={r.action} /></td>
                <td>{RECORD_LABEL[r.record_type] || r.record_type}</td>
                <td style={{ fontFamily: 'monospace', fontSize: 10 }}>{r.record_id}</td>
                <td>{r.performed_by}</td>
                <td>{r.performed_by_role || '-'}</td>
                <td style={{ fontSize: 12, maxWidth: 280 }}>{r.reason || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="pagination">
          <span>{total > 0 ? `${from}–${to} dari ${total} log` : '0 log'}</span>
          <div className="pagination-btns">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  )
}
