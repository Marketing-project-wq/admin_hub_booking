import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase, fmtDate, exportToCSV } from '@workspace/admin-shared'

const PAGE_SIZE = 20
type Row = Record<string, unknown>
const todayISO = () => new Date().toISOString().slice(0, 10)

// Status keanggotaan diturunkan dari is_active + end_date (bukan kolom tunggal):
// aktif & belum lewat end_date = Aktif; aktif tapi lewat = Kedaluwarsa; else Nonaktif.
function memberStatus(m: Row): { label: string; css: string } {
  const active = m.is_active as boolean
  const end = m.end_date as string
  if (!active) return { label: 'Nonaktif', css: 'badge-cancelled' }
  if (end && end < todayISO()) return { label: 'Kedaluwarsa', css: 'badge-pending' }
  return { label: 'Aktif', css: 'badge-confirmed' }
}

export default function GymMemberships() {
  const [data, setData] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [error, setError] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('gym_memberships')
      .select('id, plan_id, full_name, email, phone, duration_months, start_date, end_date, is_active, source, plan:gym_membership_plans(name)', { count: 'exact' })
      .order('end_date', { ascending: false })
    if (statusFilter === 'active') q = q.eq('is_active', true).gte('end_date', todayISO())
    else if (statusFilter === 'expired') q = q.eq('is_active', true).lt('end_date', todayISO())
    else if (statusFilter === 'inactive') q = q.eq('is_active', false)
    if (search) q = q.or(`full_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`)
    q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    const { data: rows, count, error: err } = await q
    if (err) { setError(err.message); setLoading(false); return }
    setData((rows as Row[]) || []); setTotal(count || 0); setError(''); setLoading(false)
  }, [page, search, statusFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const handleExport = async () => {
    const { data: all } = await supabase.from('gym_memberships').select('*').order('end_date', { ascending: false })
    if (all) exportToCSV(all as Row[], 'gym_memberships')
  }

  const hasFilter = !!(search || statusFilter !== 'active')
  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Members</h2>
        <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      <div className="filter-bar">
        <input type="text" placeholder="Cari nama, email, telp..." value={searchInput}
          onChange={e => handleSearchChange(e.target.value)} style={{ minWidth: 220 }} />
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(0) }}>
          <option value="active">Aktif</option>
          <option value="expired">Kedaluwarsa</option>
          <option value="inactive">Nonaktif</option>
          <option value="all">Semua</option>
        </select>
        {hasFilter && (
          <button className="btn-secondary" style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setSearchInput(''); setStatusFilter('active'); setPage(0) }}>Reset</button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nama</th><th>Plan</th><th>Telp</th><th>Mulai</th><th>Berakhir</th><th>Sisa</th><th>Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={7}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={7} className="empty-state">Tidak ada member</td></tr>
            ) : data.map(row => {
              const st = memberStatus(row)
              const end = row.end_date as string
              const daysLeft = end ? Math.ceil((new Date(end + 'T00:00:00').getTime() - new Date(todayISO() + 'T00:00:00').getTime()) / 86400000) : null
              const plan = row.plan as Row | undefined
              return (
                <tr key={row.id as string}>
                  <td style={{ fontWeight: 600 }}>{row.full_name as string}</td>
                  <td>{(plan?.name as string) || '-'} <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>({row.duration_months as number} bln)</span></td>
                  <td>{row.phone as string}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(row.start_date as string)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{fmtDate(end)}</td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12, color: daysLeft != null && daysLeft <= 7 ? 'var(--red)' : 'var(--text-muted)' }}>
                    {daysLeft != null ? (daysLeft >= 0 ? `${daysLeft} hari` : 'lewat') : '-'}
                  </td>
                  <td><span className={`badge ${st.css}`}>{st.label}</span></td>
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
    </div>
  )
}
