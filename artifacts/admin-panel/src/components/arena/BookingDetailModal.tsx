import React, { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { fmtRp, fmtDate, fmtDateTime, fmtTime, STATUS_LABEL } from '../../lib/format'
import ConfirmModal from './ConfirmModal'

interface Props {
  type: 'slot' | 'class'
  booking: Record<string, unknown>
  onClose: () => void
  onRefresh: () => void
}

interface GroupMember {
  id: string; booking_code: string; full_name: string; price: number; status: string;
}

function GroupMembersInline({ groupId, currentId }: { groupId: string; currentId: string }) {
  const [members, setMembers] = useState<GroupMember[]>([])

  useEffect(() => {
    supabase
      .from('arena_class_bookings')
      .select('id, booking_code, full_name, price, status')
      .eq('group_id', groupId)
      .neq('id', currentId)
      .then(({ data }) => setMembers((data || []) as GroupMember[]))
  }, [groupId, currentId])

  if (members.length === 0) return null

  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
        Tiket lain dalam grup ini:
      </div>
      {members.map(m => (
        <div key={m.id} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '6px 0', borderTop: '1px solid var(--border)', fontSize: 13, gap: 8,
        }}>
          <span style={{ fontFamily: 'monospace', fontSize: 11, flexShrink: 0 }}>{m.booking_code}</span>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.full_name}</span>
          <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>{fmtRp(m.price)}</span>
          <span className={`badge ${m.status === 'confirmed' ? 'badge-confirmed' : m.status === 'cancelled' ? 'badge-cancelled' : 'badge-pending'}`} style={{ flexShrink: 0 }}>
            {m.status}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function BookingDetailModal({ type, booking, onClose, onRefresh }: Props) {
  const [confirmAction, setConfirmAction] = useState<null | 'confirm' | 'cancel'>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const table = type === 'slot' ? 'arena_bookings' : 'arena_class_bookings'
  const status = booking.status as string
  const statusInfo = STATUS_LABEL[status] || { label: status, css: '' }

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    const { error } = await supabase.from(table).update({
      status: 'confirmed', payment_method: 'cash',
      paid_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    setLoading(false)
    if (error) { setError(error.message); return }
    setConfirmAction(null); onRefresh(); onClose()
  }

  const handleCancel = async () => {
    setLoading(true)
    setError('')
    const { error } = await supabase.from(table).update({
      status: 'cancelled', updated_at: new Date().toISOString(),
    }).eq('id', booking.id)
    setLoading(false)
    if (error) { setError(error.message); return }
    setConfirmAction(null); onRefresh(); onClose()
  }

  const schedule = booking.schedule as Record<string, unknown> | undefined
  const classType = schedule?.class_type as Record<string, unknown> | undefined
  const unit = booking.unit as Record<string, unknown> | undefined
  const groupId = booking.group_id as string | null | undefined

  return (
    <>
      <div className="modal-overlay">
        <div className="modal-box" style={{ maxWidth: 560 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
            <h3 className="modal-title" style={{ margin: 0 }}>
              {type === 'slot' ? 'Detail Slot Booking' : 'Detail Class Booking'}
            </h3>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>
          </div>

          {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

          <div className="detail-row">
            <span className="detail-label">Booking Code</span>
            <span className="detail-value" style={{ fontWeight: 700 }}>{String(booking.booking_code || '')}</span>
          </div>

          {type === 'slot' ? (
            <>
              <div className="detail-row"><span className="detail-label">Unit</span><span className="detail-value">{unit?.name as string || String(booking.unit_id || '')}</span></div>
              <div className="detail-row"><span className="detail-label">Tanggal</span><span className="detail-value">{fmtDate(booking.booking_date as string)}</span></div>
              <div className="detail-row"><span className="detail-label">Waktu</span><span className="detail-value">{fmtTime(booking.start_time as string)} – {fmtTime(booking.end_time as string)}</span></div>
            </>
          ) : (
            <>
              <div className="detail-row"><span className="detail-label">Kelas</span><span className="detail-value">{classType?.name as string || '-'}</span></div>
              <div className="detail-row"><span className="detail-label">Jadwal</span><span className="detail-value">{fmtDate(schedule?.schedule_date as string)} {fmtTime(schedule?.start_time as string)}–{fmtTime(schedule?.end_time as string)}</span></div>
              <div className="detail-row"><span className="detail-label">Instruktur</span><span className="detail-value">{schedule?.instructor as string || '-'}</span></div>
            </>
          )}

          <div className="detail-row"><span className="detail-label">Customer</span><span className="detail-value">{String(booking.full_name || '')}</span></div>
          <div className="detail-row"><span className="detail-label">Email</span><span className="detail-value">{String(booking.email || '-')}</span></div>
          <div className="detail-row"><span className="detail-label">Telp</span><span className="detail-value">{String(booking.phone || '-')}</span></div>
          <div className="detail-row"><span className="detail-label">Tipe</span><span className="detail-value">{String(booking.customer_type || '')} / {String(booking.booker_type || '')}</span></div>
          {!!booking.notes && <div className="detail-row"><span className="detail-label">Notes</span><span className="detail-value">{String(booking.notes)}</span></div>}
          {type === 'slot' && !!booking.voucher_code && <div className="detail-row"><span className="detail-label">Voucher</span><span className="detail-value">{String(booking.voucher_code)}</span></div>}

          <div className="modal-section">
            <div className="detail-row"><span className="detail-label">Harga Normal</span><span className="detail-value">{fmtRp(booking.price_before_disc as number)}</span></div>
            <div className="detail-row"><span className="detail-label">Diskon</span><span className="detail-value">{fmtRp(booking.discount as number)}</span></div>
            <div className="detail-row"><span className="detail-label">Harga Final</span><span className="detail-value" style={{ fontWeight: 700 }}>{fmtRp(booking.price as number)}</span></div>
          </div>

          {type === 'class' && ((booking.addons as unknown[]) || []).length > 0 && (() => {
            const addons = booking.addons as Array<{ id: string; addon_name: string; addon_price: number; qty: number; subtotal: number }>
            const totalAddon = addons.reduce((s, a) => s + a.subtotal, 0)
            return (
              <div className="modal-section">
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                  Add-ons
                </div>
                {addons.map(a => (
                  <div key={a.id} className="detail-row">
                    <span className="detail-label">{a.addon_name} ×{a.qty}</span>
                    <span className="detail-value">{fmtRp(a.subtotal)}</span>
                  </div>
                ))}
                <div className="detail-row" style={{ borderTop: '1px solid var(--border)', marginTop: 4, paddingTop: 8 }}>
                  <span className="detail-label" style={{ fontWeight: 600 }}>Total Addon</span>
                  <span className="detail-value" style={{ fontWeight: 600 }}>{fmtRp(totalAddon)}</span>
                </div>
                <div className="detail-row">
                  <span className="detail-label" style={{ fontWeight: 700 }}>Grand Total</span>
                  <span className="detail-value" style={{ fontWeight: 700, color: 'var(--red)' }}>
                    {fmtRp((booking.price as number) + totalAddon)}
                  </span>
                </div>
              </div>
            )
          })()}

          <div className="modal-section">
            <div className="detail-row">
              <span className="detail-label">Status</span>
              <span><span className={`badge ${statusInfo.css}`}>{statusInfo.label}</span></span>
            </div>
            <div className="detail-row"><span className="detail-label">Payment</span><span className="detail-value">{String(booking.payment_method || '-')}</span></div>
            {booking.payment_ref ? (
              <div className="detail-row">
                <span className="detail-label">Mayar Ref</span>
                <span className="detail-value" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                  <a
                    href="https://web.mayar.id/payments"
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Buka Mayar Dashboard"
                    style={{ color: 'var(--red)', textDecoration: 'none' }}
                  >
                    {String(booking.payment_ref)}
                    <span style={{ fontSize: 10, marginLeft: 4 }}>↗</span>
                  </a>
                </span>
              </div>
            ) : (
              <div className="detail-row"><span className="detail-label">Mayar Ref</span><span className="detail-value">-</span></div>
            )}
            <div className="detail-row"><span className="detail-label">Paid At</span><span className="detail-value">{fmtDateTime(booking.paid_at as string)}</span></div>
            <div className="detail-row"><span className="detail-label">Dibuat</span><span className="detail-value">{fmtDateTime(booking.created_at as string)}</span></div>
          </div>

          {type === 'class' && groupId && (
            <div className="modal-section">
              <div className="detail-row">
                <span className="detail-label">Group Booking</span>
                <span className="detail-value" style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                  {groupId}
                </span>
              </div>
              <GroupMembersInline groupId={groupId} currentId={booking.id as string} />
            </div>
          )}

          <div className="modal-footer">
            <button className="btn-secondary" onClick={onClose}>Tutup</button>
            {status === 'pending_payment' && (
              <button className="btn-primary" disabled={loading} onClick={() => setConfirmAction('confirm')}>
                Konfirmasi
              </button>
            )}
            {status !== 'cancelled' && (
              <button className="btn-danger" disabled={loading} onClick={() => setConfirmAction('cancel')}>
                Cancel
              </button>
            )}
          </div>
        </div>
      </div>

      {confirmAction === 'confirm' && (
        <ConfirmModal
          title="Konfirmasi Booking"
          message="Booking akan dikonfirmasi dengan payment method Cash."
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
      {confirmAction === 'cancel' && (
        <ConfirmModal
          title="Batalkan Booking"
          message="Booking akan dibatalkan. Aksi ini tidak dapat diurungkan."
          onConfirm={handleCancel}
          onCancel={() => setConfirmAction(null)}
          danger
        />
      )}
    </>
  )
}
