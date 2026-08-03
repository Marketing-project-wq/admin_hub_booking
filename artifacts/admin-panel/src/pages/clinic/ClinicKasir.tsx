import React, { useState, useEffect, useCallback, useRef } from 'react'
import { ArrowLeft, ArrowRight, X } from 'lucide-react'
import { fmtRp, fmtDate, fmtTime, fmtDateTime, exportToCSV } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import { todayISO } from '../../lib/clinic'
import { useAuth } from '../../context/AuthContext'
import { listTransactions, getTodaySummary, updateClinicTransaction, cancelClinicPayment, parseHistoricalNotes, type ClinicTransaction } from '../../lib/clinicBilling'
import ClinicReceiptModal from '../../components/clinic/ClinicReceiptModal'
import ClinicCloseBillModal from '../../components/clinic/ClinicCloseBillModal'
import LockBadge from '../../components/clinic/LockBadge'

const PAGE_SIZE = 20

// ── Allowlist edit FINANSIAL transaksi (service_price/discount/admin_fee/method) ──
// SENGAJA allowlist email manual, BUKAN role-based: ketiganya ber-role 'admin',
// tapi TIDAK semua admin clinic boleh (mis. clinic@20fit.id & akun dokter tidak).
// Tambah/kurangi orang: cukup edit daftar ini. super_admin selalu boleh.
const FINANCE_EDIT_ALLOWLIST = ['reyhan@20fit.id', 'jonathan@20fit.id', 'zahra@20fit.id']

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

interface PendingVisit {
  id: string
  visit_code: string
  visit_date: string
  visit_time: string | null
  status: string
  payment_status: string
  patient: { id: string; full_name: string; patient_code: string; phone: string } | null
  services: { id: string; service_id: string; service_name: string; price: number }[]
  booking_payment_method?: string | null
  booking_status?: string | null
  booking_price?: number | null
  booking_service_id?: string | null
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

  // Edit transaksi (setelah unlock). Dua tingkat akses (frontend-level, konsisten
  // model kontrol akses app): field finansial untuk super_admin + email di
  // FINANCE_EDIT_ALLOWLIST; non-finansial (notes/kasir/detail bayar) untuk can_payment.
  const { user, hasPermission } = useAuth()
  const kasirRole: string | undefined = user?.role
  const isSuperAdmin = kasirRole === 'super_admin'
  const canEditFinance = isSuperAdmin || FINANCE_EDIT_ALLOWLIST.includes((user?.email ?? '').toLowerCase())
  const canEditTransaction = canEditFinance || hasPermission('can_payment')
  const [editTrx, setEditTrx] = useState<ClinicTransaction | null>(null)

  // Menunggu Pembayaran
  const [pendingVisits, setPendingVisits] = useState<PendingVisit[]>([])
  const [loadingPending, setLoadingPending] = useState(true)
  const [closeBillVisit, setCloseBillVisit] = useState<PendingVisit | null>(null)

  const fetchPending = useCallback(async () => {
    setLoadingPending(true)
    try {
      const { data, error: err } = await supabase
        .from('clinic_visits')
        .select(`
          id, visit_code, visit_date, visit_time, status, payment_status,
          patient:clinic_patients(id, full_name, patient_code, phone),
          services:clinic_visit_services(id, service_id, service_name, price),
          bookings:clinic_bookings!clinic_bookings_visit_id_fkey(payment_method, status, price, service_id)
        `)
        .eq('payment_status', 'unpaid')
        // in_progress/completed lintas tanggal, PLUS scheduled KHUSUS hari ini
        // (pasien kiosk yang belum ditriase tetap bisa ditagih). Scheduled masa
        // depan (follow-up appointment) & lampau (urusan carry-over Triase)
        // sengaja TIDAK ikut. todayISO() = tanggal lokal (bukan toISOString/UTC).
        .or(`status.in.(in_progress,completed),and(status.eq.scheduled,visit_date.eq.${todayISO()})`)
        .order('visit_date', { ascending: false })
        .order('visit_time', { ascending: true })
      if (err) throw err
      const visits = (data ?? []).map((v: any) => ({
        ...v,
        booking_payment_method: v.bookings?.[0]?.payment_method ?? null,
        booking_status: v.bookings?.[0]?.status ?? null,
        booking_price: v.bookings?.[0]?.price ?? null,
        booking_service_id: v.bookings?.[0]?.service_id ?? null,
      }))
      setPendingVisits(visits as unknown as PendingVisit[])
    } catch (e) {
      console.error('[ClinicKasir] fetch pending failed:', e)
    } finally {
      setLoadingPending(false)
    }
  }, [])

  // Auto-refresh section "Menunggu Pembayaran" tiap 30 detik.
  useEffect(() => {
    fetchPending()
    const t = window.setInterval(fetchPending, 30000)
    return () => window.clearInterval(t)
  }, [fetchPending])

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
        Pasien: t.patient?.full_name ?? parseHistoricalNotes(t.notes).pasien ?? '',
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

      {/* ── Menunggu Pembayaran ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 12px' }}>Menunggu Pembayaran</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Pasien</th><th>Layanan</th><th>Total</th><th>Jam</th><th>Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loadingPending ? (
                <tr className="loading-row"><td colSpan={5}>Memuat data...</td></tr>
              ) : pendingVisits.length === 0 ? (
                <tr><td colSpan={5} className="empty-state">Tidak ada pasien menunggu pembayaran hari ini</td></tr>
              ) : pendingVisits.map(v => {
                const vTotal = v.services.reduce((sum, s) => sum + (Number(s.price) || 0), 0)
                return (
                  <tr key={v.id}>
                    <td>
                      {v.patient?.full_name || '-'}
                      {v.patient?.patient_code && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{v.patient.patient_code}</div>
                      )}
                    </td>
                    <td>{v.services.map(s => s.service_name).join(', ') || '-'}</td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{fmtRp(vTotal)}</td>
                    <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{v.visit_time ? fmtTime(v.visit_time) : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn-primary" style={{ width: 'auto', padding: '6px 14px', background: 'var(--red)' }} onClick={() => setCloseBillVisit(v)}>Close Bill</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
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
                {/* Fallback transaksi historis (patient_id null): nama dari notes "Pasien: ..." */}
                <td>{t.patient?.full_name || parseHistoricalNotes(t.notes).pasien || '-'}</td>
                <td>
                  {t.service_name}
                  {t.visit?.patient_package_id && (
                    <span className="badge" style={{ background: '#DBEAFE', color: '#1D4ED8', marginLeft: 6 }}>Paket</span>
                  )}
                </td>
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
                  {!lk.is_locked && canEditTransaction && (
                    <button className="action-btn" style={{ color: 'var(--red)', marginRight: 6 }} onClick={() => setEditTrx(t)}>Edit</button>
                  )}
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
            <button disabled={page === 0} onClick={() => setPage(p => p - 1)}><ArrowLeft size={13} style={{ verticalAlign: -2 }} /> Prev</button>
            <button disabled={to >= total} onClick={() => setPage(p => p + 1)}>Next <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
          </div>
        </div>
      </div>

      {receipt && <ClinicReceiptModal transaction={receipt} onClose={() => setReceipt(null)} />}
      {editTrx && (
        <EditTransactionModal
          trx={editTrx}
          canEditFinance={canEditFinance}
          performedBy={user?.full_name ?? '-'}
          performedByRole={kasirRole ?? null}
          onClose={() => setEditTrx(null)}
          onSaved={() => { setEditTrx(null); fetchData() }}
          // Setelah batal bayar: transaksi hilang dari riwayat DAN visit muncul
          // lagi di daftar pending Close Bill — refresh keduanya.
          onCancelled={() => { setEditTrx(null); fetchData(); fetchPending() }}
        />
      )}

      {closeBillVisit && closeBillVisit.patient && (
        <ClinicCloseBillModal
          visitId={closeBillVisit.id}
          patientId={closeBillVisit.patient.id}
          patientName={closeBillVisit.patient.full_name}
          patientCode={closeBillVisit.patient.patient_code}
          patientPhone={closeBillVisit.patient.phone}
          services={closeBillVisit.services.map(s => ({ service_id: s.service_id, service_name: s.service_name, price: s.price }))}
          paidOnline={
            // Guard: 'mayar' hanya dianggap paid-online kalau price > 0. Booking voucher
            // (price 0) yang payment_method-nya tertimpa 'mayar' oleh proses eksternal
            // TIDAK boleh mencatat total penuh sebagai revenue Mayar fiktif.
            closeBillVisit.booking_payment_method === 'mayar' && (closeBillVisit.booking_price ?? 0) > 0
          }
          paidWithVoucher={closeBillVisit.booking_payment_method === 'voucher' && closeBillVisit.booking_price === 0}
          bookingServiceId={closeBillVisit.booking_service_id ?? null}
          onClose={() => setCloseBillVisit(null)}
          onSuccess={() => { setCloseBillVisit(null); fetchPending(); fetchData() }}
        />
      )}
    </div>
  )
}

// ─── Edit Transaksi (setelah unlock) ─────────────────────────────────────────
// Simpan lewat RPC atomik update_clinic_transaction: validasi + update + sinkron
// clinic_visits + audit diff + RE-LOCK otomatis dalam satu transaksi DB.
// Field finansial hanya aktif untuk super_admin; non-finansial untuk can_payment.
const EDIT_METHODS = ['cash', 'transfer', 'qris', 'debit', 'kredit']

function EditTransactionModal({ trx, canEditFinance, performedBy, performedByRole, onClose, onSaved, onCancelled }: {
  trx: ClinicTransaction
  canEditFinance: boolean
  performedBy: string
  performedByRole: string | null
  onClose: () => void
  onSaved: () => void
  onCancelled: () => void
}) {
  const [servicePrice, setServicePrice] = useState(trx.service_price)
  const [discount, setDiscount] = useState(trx.discount)
  const [adminFee, setAdminFee] = useState(trx.admin_fee ?? 0)
  const [payMethod, setPayMethod] = useState(trx.payment_method)
  const [transferRef, setTransferRef] = useState(trx.payment_detail?.transfer_ref ?? '')
  const [cardLast4, setCardLast4] = useState(trx.payment_detail?.card_last4 ?? '')
  const [bankName, setBankName] = useState(trx.payment_detail?.bank_name ?? '')
  const [notes, setNotes] = useState(trx.notes ?? '')
  const [cashierName, setCashierName] = useState(trx.cashier_name ?? '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Batalkan Pembayaran — konfirmasi 2 langkah (destruktif: hapus baris transaksi).
  const [showCancelConfirm, setShowCancelConfirm] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  // Total SELALU turunan komponen (read-only) — persamaan yang sama di-enforce RPC.
  const total = servicePrice - discount + adminFee
  // Simpan hanya aktif kalau ada perubahan nyata vs nilai awal (alasan tidak dihitung) —
  // selaras perilaku RPC yang no-op saat tidak ada perubahan.
  const isDirty =
    servicePrice !== trx.service_price ||
    discount !== trx.discount ||
    adminFee !== (trx.admin_fee ?? 0) ||
    payMethod !== trx.payment_method ||
    transferRef !== (trx.payment_detail?.transfer_ref ?? '') ||
    cardLast4 !== (trx.payment_detail?.card_last4 ?? '') ||
    bankName !== (trx.payment_detail?.bank_name ?? '') ||
    notes !== (trx.notes ?? '') ||
    cashierName !== (trx.cashier_name ?? '')
  const isCard = payMethod === 'debit' || payMethod === 'kredit'
  const numStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box' }
  const label: React.CSSProperties = { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }
  const parseNum = (s: string) => Number(s.replace(/\D/g, '')) || 0

  const handleCancelPayment = async () => {
    setError('')
    if (!cancelReason.trim()) { setError('Alasan pembatalan wajib diisi.'); return }
    setCancelling(true)
    try {
      await cancelClinicPayment({
        transaction_id: trx.id,
        reason: cancelReason.trim(),
        performed_by: performedBy,
        performed_by_role: performedByRole,
      })
      onCancelled()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal membatalkan pembayaran')
    } finally {
      setCancelling(false)
    }
  }

  const handleSave = async () => {
    setError('')
    if (!reason.trim()) { setError('Alasan perubahan wajib diisi.'); return }
    if (!payMethod.trim()) { setError('Metode pembayaran wajib diisi.'); return }
    if (discount > servicePrice) { setError('Diskon tidak boleh melebihi harga layanan.'); return }
    if (adminFee < 0) { setError('Biaya admin tidak boleh negatif.'); return }
    setSaving(true)
    try {
      const payment_detail: Record<string, string> = {}
      if (payMethod === 'transfer' && transferRef.trim()) payment_detail.transfer_ref = transferRef.trim()
      if (isCard) {
        if (cardLast4.trim()) payment_detail.card_last4 = cardLast4.trim()
        if (bankName.trim()) payment_detail.bank_name = bankName.trim()
      }
      await updateClinicTransaction({
        transaction_id: trx.id,
        service_price: servicePrice,
        discount,
        admin_fee: adminFee,
        total_amount: total,
        payment_method: payMethod,
        payment_detail,
        notes: notes.trim() || null,
        cashier_name: cashierName.trim() || null,
        reason: reason.trim(),
        performed_by: performedBy,
        performed_by_role: performedByRole,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal menyimpan perubahan')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 className="modal-title" style={{ margin: 0 }}>Edit Transaksi</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={18} /></button>
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
          {trx.transaction_code} · {trx.service_name}
        </div>

        {!canEditFinance && (
          <p style={{ fontSize: 12, color: 'var(--text-muted)', background: 'var(--bg-elevated)', borderRadius: 8, padding: '8px 10px', margin: '0 0 12px' }}>
            Field finansial hanya bisa diubah akun berwenang (super admin / allowlist) — Anda dapat mengubah catatan, nama kasir, dan detail pembayaran.
          </p>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={label}>Harga Layanan</label>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={String(servicePrice)} disabled={!canEditFinance}
              onFocus={e => e.target.select()} onChange={e => setServicePrice(parseNum(e.target.value))} style={numStyle} />
          </div>
          <div>
            <label style={label}>Diskon</label>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={String(discount)} disabled={!canEditFinance}
              onFocus={e => e.target.select()} onChange={e => setDiscount(parseNum(e.target.value))} style={numStyle} />
          </div>
          <div>
            <label style={label}>Biaya Admin</label>
            <input type="text" inputMode="numeric" pattern="[0-9]*" value={String(adminFee)} disabled={!canEditFinance}
              onFocus={e => e.target.select()} onChange={e => setAdminFee(parseNum(e.target.value))} style={numStyle} />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={label}>Metode Pembayaran</label>
            <select value={payMethod} disabled={!canEditFinance} onChange={e => setPayMethod(e.target.value)} style={numStyle}>
              {!EDIT_METHODS.includes(trx.payment_method) && (
                <option value={trx.payment_method}>{trx.payment_method}</option>
              )}
              {EDIT_METHODS.map(m => <option key={m} value={m}>{METHOD_LABEL[m] ?? m}</option>)}
            </select>
          </div>
          <div style={{ alignSelf: 'end', textAlign: 'right' }}>
            <label style={label}>Total (otomatis)</label>
            <div style={{ fontWeight: 800, fontSize: 18, color: discount > servicePrice ? 'var(--red)' : 'var(--text-primary)' }}>{fmtRp(total)}</div>
          </div>
        </div>

        {payMethod === 'transfer' && (
          <div style={{ marginBottom: 12 }}>
            <label style={label}>Ref Transfer</label>
            <input type="text" value={transferRef} onChange={e => setTransferRef(e.target.value)} style={numStyle} />
          </div>
        )}
        {isCard && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div>
              <label style={label}>Bank</label>
              <input type="text" value={bankName} onChange={e => setBankName(e.target.value)} style={numStyle} />
            </div>
            <div>
              <label style={label}>4 Digit Kartu</label>
              <input type="text" value={cardLast4} maxLength={4} onChange={e => setCardLast4(e.target.value)} style={numStyle} />
            </div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label style={label}>Nama Kasir</label>
            <input type="text" value={cashierName} onChange={e => setCashierName(e.target.value)} style={numStyle} />
          </div>
          <div>
            <label style={label}>Catatan</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} style={numStyle} />
          </div>
        </div>

        <div style={{ marginBottom: 12 }}>
          <label style={label}>Alasan Perubahan (wajib)</label>
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2}
            placeholder="Mis. salah input diskon saat Close Bill..." style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical' }} />
        </div>

        {error && <p style={{ color: 'var(--red)', fontSize: 13, margin: '0 0 10px' }}>{error}</p>}

        <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          Setelah disimpan, transaksi otomatis terkunci kembali dan perubahan tercatat di Audit Log
          (field, nilai lama, nilai baru). Total tagihan visit ikut disinkronkan.
        </p>

        {/* ── Batalkan Pembayaran (destruktif — reset total, beda dari edit).
            Hanya utk akun finansial; modal ini sendiri hanya terbuka saat
            transaksi sudah di-unlock. Konfirmasi 2 langkah + alasan wajib. ── */}
        {canEditFinance && (
          <div style={{ borderTop: '1px dashed var(--border-strong)', paddingTop: 12, marginBottom: 4 }}>
            {!showCancelConfirm ? (
              <button type="button" onClick={() => { setShowCancelConfirm(true); setError('') }}
                disabled={saving || cancelling}
                style={{ background: 'none', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                Batalkan Pembayaran…
              </button>
            ) : (
              <div style={{ background: '#FEE2E2', border: '1px solid #DC2626', borderRadius: 8, padding: 12 }}>
                <div style={{ fontWeight: 800, fontSize: 13, color: '#991B1B', marginBottom: 6 }}>
                  Batalkan pembayaran {trx.transaction_code}?
                </div>
                <ul style={{ fontSize: 12, color: '#991B1B', margin: '0 0 10px', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Transaksi <strong>dihapus permanen</strong> dari riwayat (tidak bisa dikembalikan).</li>
                  <li>Visit kembali berstatus <strong>belum dibayar</strong> dan muncul lagi di daftar Menunggu Pembayaran untuk di-Close Bill ulang.</li>
                  <li>Paket yang dibeli lewat transaksi ini ikut terhapus; sesi paket yang terpotong dikembalikan (bila terekam).</li>
                  <li>Pembatalan tercatat di Audit Log beserta alasan.</li>
                </ul>
                <label style={{ fontSize: 11, color: '#991B1B', textTransform: 'uppercase', letterSpacing: 1, display: 'block', marginBottom: 4 }}>
                  Alasan Pembatalan (wajib)
                </label>
                <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} rows={2}
                  placeholder="Mis. salah pilih jenis pemeriksaan saat Close Bill..."
                  style={{ width: '100%', boxSizing: 'border-box', resize: 'vertical', marginBottom: 10 }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button type="button" className="btn-secondary" style={{ width: 'auto', padding: '7px 14px' }}
                    onClick={() => { setShowCancelConfirm(false); setCancelReason('') }} disabled={cancelling}>
                    Jangan Batalkan
                  </button>
                  <button type="button" onClick={handleCancelPayment}
                    disabled={cancelling || !cancelReason.trim()}
                    title={cancelReason.trim() ? undefined : 'Isi alasan pembatalan dulu'}
                    style={{ background: '#DC2626', border: 'none', color: '#fff', borderRadius: 8, padding: '7px 14px', fontSize: 12.5, fontWeight: 700, cursor: cancelReason.trim() ? 'pointer' : 'not-allowed', opacity: cancelling || !cancelReason.trim() ? 0.6 : 1 }}>
                    {cancelling ? 'Membatalkan...' : 'Ya, Hapus & Batalkan Pembayaran'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose} disabled={saving || cancelling}>Batal</button>
          <button className="btn-primary" onClick={handleSave} disabled={saving || cancelling || !isDirty}
            title={isDirty ? undefined : 'Belum ada perubahan'}>
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </button>
        </div>
      </div>
    </div>
  )
}
