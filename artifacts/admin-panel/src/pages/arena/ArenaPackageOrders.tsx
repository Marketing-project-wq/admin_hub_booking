import React, { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDateTime, STATUS_LABEL, exportToCSV } from '../../lib/format'

const PAGE_SIZE = 20

export default function ArenaPackageOrders() {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const fetchData = useCallback(async () => {
    setLoading(true)
    let q = supabase
      .from('arena_package_orders')
      .select(`
        id, order_code, package_id, package_name, sessions, price,
        full_name, email, phone, notes, status, payment_method,
        payment_ref, paid_at, created_at, updated_at,
        arena_package_vouchers(
          voucher_code, total_sessions, used_sessions, is_active
        )
      `, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
    if (search) q = q.or(
      `full_name.ilike.%${search}%,` +
      `order_code.ilike.%${search}%,` +
      `phone.ilike.%${search}%,` +
      `email.ilike.%${search}%,` +
      `package_name.ilike.%${search}%`
    )
    const { data: rows, count } = await q
    setData(rows || [])
    setTotal(count || 0)
    setLoading(false)
  }, [page, search])

  useEffect(() => { fetchData() }, [fetchData])

  const openDetail = (row: Record<string, unknown>) => {
    setSelected(row)
  }

  const handleExport = async () => {
    const { data: all } = await supabase.from('arena_package_orders').select('*').order('created_at', { ascending: false })
    if (all) exportToCSV(all as Record<string, unknown>[], 'package_orders')
  }

  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Package Orders</h2>
        <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
      </div>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari nama, kode order, telp, paket..."
          value={searchInput}
          onChange={e => handleSearchChange(e.target.value)}
          style={{ minWidth: 240 }}
        />
        {search && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: '6px 12px' }}
            onClick={() => { setSearch(''); setSearchInput(''); setPage(0) }}
          >
            Reset
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Order Code</th>
              <th>Package</th>
              <th>Sessions</th>
              <th>Nama</th>
              <th>Telp</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Payment</th>
              <th>Voucher Code</th>
              <th>Dibuat</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={11}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={11} className="empty-state">Tidak ada data</td></tr>
            ) : data.map((row: Record<string, unknown>) => {
              const s = STATUS_LABEL[row.status as string] || { label: row.status, css: '' }
              return (
                <tr key={row.id as string}>
                  <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{row.order_code as string}</td>
                  <td>{row.package_name as string}</td>
                  <td style={{ textAlign: 'center' }}>{row.sessions as number}</td>
                  <td>{row.full_name as string}</td>
                  <td>{row.phone as string}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtRp(row.price as number)}</td>
                  <td><span className={`badge ${s.css}`}>{s.label}</span></td>
                  <td>{row.payment_method as string || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>
                    {((row.arena_package_vouchers as Record<string, unknown>[] | null)?.[0]?.voucher_code as string) || '-'}
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fmtDateTime(row.created_at as string)}</td>
                  <td><button className="action-btn detail" onClick={() => openDetail(row)}>Detail</button></td>
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

      {selected && (
        <div className="modal-overlay">
          <div className="modal-box" style={{ maxWidth: 500 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 20 }}>
              <h3 className="modal-title" style={{ margin: 0 }}>Detail Package Order</h3>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
            </div>
            <div className="detail-row"><span className="detail-label">Order Code</span><span className="detail-value" style={{ fontWeight: 700 }}>{selected.order_code as string}</span></div>
            <div className="detail-row"><span className="detail-label">Package</span><span className="detail-value">{selected.package_name as string}</span></div>
            <div className="detail-row"><span className="detail-label">Sessions</span><span className="detail-value">{selected.sessions as number}</span></div>
            <div className="modal-section">
              <div className="detail-row"><span className="detail-label">Customer</span><span className="detail-value">{selected.full_name as string}</span></div>
              <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{selected.email as string}</span></div>
              <div className="detail-row"><span className="detail-label">Telp</span><span className="detail-value">{selected.phone as string}</span></div>
              {!!selected.notes && <div className="detail-row"><span className="detail-label">Notes</span><span className="detail-value">{selected.notes as string}</span></div>}
            </div>
            <div className="modal-section">
              <div className="detail-row"><span className="detail-label">Harga</span><span className="detail-value">{fmtRp(selected.price as number)}</span></div>
              <div className="detail-row"><span className="detail-label">Status</span><span><span className={`badge ${(STATUS_LABEL[selected.status as string] || { css: '' }).css}`}>{(STATUS_LABEL[selected.status as string] || { label: selected.status }).label}</span></span></div>
              <div className="detail-row"><span className="detail-label">Payment</span><span className="detail-value">{selected.payment_method as string || '-'} / {selected.payment_ref as string || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Paid At</span><span className="detail-value">{fmtDateTime(selected.paid_at as string)}</span></div>
            </div>
            {(() => {
              const v = ((selected.arena_package_vouchers as Record<string, unknown>[] | null)?.[0]) ?? null
              if (!v) return null
              return (
                <div className="modal-section">
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Package Voucher</div>
                  <div className="detail-row"><span className="detail-label">Voucher Code</span><span className="detail-value" style={{ fontFamily: 'monospace' }}>{v.voucher_code as string}</span></div>
                  <div className="detail-row"><span className="detail-label">Total Sesi</span><span className="detail-value">{v.total_sessions as number}</span></div>
                  <div className="detail-row"><span className="detail-label">Terpakai</span><span className="detail-value">{v.used_sessions as number}</span></div>
                  <div className="detail-row"><span className="detail-label">Sisa</span><span className="detail-value">{Number(v.total_sessions) - Number(v.used_sessions)}</span></div>
                  <div className="detail-row"><span className="detail-label">Active</span><span className="detail-value">{v.is_active ? 'Ya' : 'Tidak'}</span></div>
                </div>
              )
            })()}
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setSelected(null)}>Tutup</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
