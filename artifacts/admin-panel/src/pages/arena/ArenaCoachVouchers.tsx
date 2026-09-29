import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { fmtDate, exportToCSV } from '../../lib/format'

// Coach PACKAGE vouchers (coach_package_vouchers). RLS service-role only → read via the
// `coach-admin-vouchers` edge function. The "Pakai 1 sesi" (redeem) action calls
// `coach-redeem-session`, which increments used_sessions and stamps first_used_at on the
// FIRST redeem (expiry-first-use). Redeem returns HTTP 200 with { ok: false, error } for
// business rejections (exhausted/expired/inactive/conflict) so the reason is always readable.
const PAGE_SIZE = 20

interface VoucherRow {
  id: string
  voucher_code: string
  coach_name: string | null
  tier: string
  total_sessions: number
  used_sessions: number
  remaining: number
  validity_months: number | null
  first_used_at: string | null
  expires_at: string | null
  is_active: boolean
  created_at: string
  order_code: string | null
  customer_name: string | null
  customer_wa: string | null
}

interface RedeemResult {
  ok: boolean
  error?: string
  remaining?: number
  used_sessions?: number
  first_used_at?: string | null
  expires_at?: string | null
}

const tierLabel = (t: string) => (t === 'head_coach' ? 'Head Coach' : t === 'coach' ? 'Coach' : t)

const REDEEM_ERR: Record<string, string> = {
  not_found: 'Voucher tidak ditemukan',
  inactive: 'Voucher tidak aktif',
  exhausted: 'Semua sesi sudah terpakai',
  expired: 'Voucher sudah kedaluwarsa',
  conflict: 'Ada perubahan bersamaan — muat ulang lalu coba lagi',
  invalid_code: 'Kode voucher tidak valid',
  update_failed: 'Gagal menyimpan — coba lagi',
  query_failed: 'Gagal memuat voucher — coba lagi',
}

export default function ArenaCoachVouchers() {
  const [data, setData] = useState<VoucherRow[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [redeemingId, setRedeemingId] = useState<string | null>(null)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleSearchChange = (val: string) => {
    setSearchInput(val)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => { setSearch(val); setPage(0) }, 300)
  }

  const fetchData = useCallback(async () => {
    setLoading(true); setError('')
    const { data: res, error: err } = await supabase.functions.invoke<{ rows: VoucherRow[]; total: number }>(
      'coach-admin-vouchers', { body: { page: page + 1, pageSize: PAGE_SIZE, search } },
    )
    if (err) { setError(err.message || 'Gagal memuat data'); setData([]); setTotal(0); setLoading(false); return }
    setData(res?.rows ?? [])
    setTotal(res?.total ?? 0)
    setLoading(false)
  }, [page, search])

  useEffect(() => { fetchData() }, [fetchData])

  const isExpired = (v: VoucherRow) => (v.expires_at ? new Date(v.expires_at).getTime() < Date.now() : false)
  const canRedeem = (v: VoucherRow) => v.is_active && v.remaining > 0 && !isExpired(v)

  const handleRedeem = async (v: VoucherRow) => {
    if (!canRedeem(v) || redeemingId) return
    const firstUseNote = v.first_used_at
      ? ''
      : '\n\nIni sesi PERTAMA — masa berlaku mulai berjalan hari ini.'
    if (!window.confirm(
      `Pakai 1 sesi dari voucher ${v.voucher_code}?\n` +
      `Sisa: ${v.remaining} → ${v.remaining - 1}.${firstUseNote}\n\n` +
      `Aksi ini tidak bisa dibatalkan.`,
    )) return

    setRedeemingId(v.id); setError(''); setNotice('')
    const { data: res, error: err } = await supabase.functions.invoke<RedeemResult>(
      'coach-redeem-session', { body: { voucher_code: v.voucher_code } },
    )
    setRedeemingId(null)
    if (err) { setError('Gagal redeem — coba lagi'); return }
    if (!res?.ok) {
      setError(REDEEM_ERR[res?.error ?? ''] || 'Redeem ditolak')
      fetchData() // refresh so the row reflects current state
      return
    }
    setNotice(`✓ 1 sesi dipakai dari ${v.voucher_code}. Sisa ${res.remaining}.`)
    fetchData()
  }

  const handleExport = async () => {
    const all: VoucherRow[] = []
    for (let p = 1; ; p++) {
      const { data: res, error: err } = await supabase.functions.invoke<{ rows: VoucherRow[]; total: number }>(
        'coach-admin-vouchers', { body: { page: p, pageSize: 100, search } },
      )
      if (err) break
      const rows = res?.rows ?? []
      all.push(...rows)
      if (rows.length === 0 || all.length >= (res?.total ?? 0)) break
    }
    if (all.length) exportToCSV(all as unknown as Record<string, unknown>[], 'coach_package_vouchers')
  }

  const from = page * PAGE_SIZE + 1
  const to = Math.min((page + 1) * PAGE_SIZE, total)

  const statusBadge = (v: VoucherRow) => {
    if (!v.is_active) return <span className="badge badge-cancelled">Nonaktif</span>
    if (isExpired(v)) return <span className="badge badge-cancelled">Expired</span>
    if (v.remaining <= 0) return <span className="badge badge-pending">Habis</span>
    return <span className="badge badge-confirmed">Aktif</span>
  }

  return (
    <div>
      <div className="page-header">
        <h2 className="page-title">Coach Vouchers</h2>
        <button className="btn-secondary" onClick={handleExport}>Export CSV</button>
      </div>

      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      {notice && <p style={{ color: 'var(--green, #16A34A)', fontSize: 13, marginBottom: 12 }}>{notice}</p>}

      <div className="filter-bar">
        <input
          type="text"
          placeholder="Cari voucher code..."
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
              <th>Voucher Code</th>
              <th>Coach</th>
              <th>Tier</th>
              <th>Total</th>
              <th>Terpakai</th>
              <th>Sisa</th>
              <th>Masa</th>
              <th>Sesi Pertama</th>
              <th>Expiry</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr className="loading-row"><td colSpan={11}>Memuat data...</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={11} className="empty-state">Tidak ada data</td></tr>
            ) : data.map(v => {
              const redeemable = canRedeem(v)
              const busy = redeemingId === v.id
              return (
                <tr key={v.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700 }}>{v.voucher_code}</td>
                  <td>{v.coach_name || '-'}</td>
                  <td>{tierLabel(v.tier)}</td>
                  <td style={{ textAlign: 'center' }}>{v.total_sessions}</td>
                  <td style={{ textAlign: 'center' }}>{v.used_sessions}</td>
                  <td style={{ textAlign: 'center', fontWeight: 700 }}>{v.remaining}</td>
                  <td style={{ textAlign: 'center' }}>{v.validity_months != null ? `${v.validity_months} bln` : '-'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{v.first_used_at ? fmtDate(v.first_used_at) : 'belum mulai'}</td>
                  <td style={{ fontSize: 12, color: isExpired(v) ? 'var(--red)' : 'var(--text-muted)' }}>{v.expires_at ? fmtDate(v.expires_at) : '-'}</td>
                  <td>{statusBadge(v)}</td>
                  <td>
                    <button
                      className="action-btn detail"
                      disabled={!redeemable || busy}
                      onClick={() => handleRedeem(v)}
                      title={redeemable ? 'Pakai 1 sesi dari voucher ini' : 'Tidak bisa redeem (nonaktif / habis / expired)'}
                      style={{ opacity: redeemable && !busy ? 1 : 0.5, cursor: redeemable && !busy ? 'pointer' : 'not-allowed' }}
                    >
                      {busy ? '...' : 'Pakai 1 sesi'}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="pagination">
          <span>{total > 0 ? `${from}–${to} dari ${total} hasil` : '0 hasil'}</span>
          <div className="pagination-btns">
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}><ArrowLeft size={13} style={{ verticalAlign: -2 }} /> Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
          </div>
        </div>
      </div>
    </div>
  )
}
