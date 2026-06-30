import React, { useState } from 'react'
import { useAuth } from '@workspace/admin-shared'
import { unlockRecord, relockRecord, type LockableTable } from '../../lib/clinic'
import { fmtDateTime } from '@workspace/admin-shared'

interface LockBadgeProps {
  isLocked: boolean
  lockedAt: string | null
  lockedBy: string | null
  recordId: string
  table: LockableTable
  onUnlocked: () => void
  onRelocked: () => void
}

export default function LockBadge({
  isLocked, lockedAt, lockedBy, recordId, table, onUnlocked, onRelocked,
}: LockBadgeProps) {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'super_admin'
  const [showUnlockModal, setShowUnlockModal] = useState(false)
  const [showRelockConfirm, setShowRelockConfirm] = useState(false)
  const [reason, setReason] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleUnlock = async () => {
    if (!reason.trim()) { setError('Alasan wajib diisi'); return }
    setLoading(true)
    try {
      await unlockRecord(table, recordId, user!.full_name, user!.role, reason.trim())
      setShowUnlockModal(false)
      setReason('')
      onUnlocked()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal unlock')
    } finally {
      setLoading(false)
    }
  }

  const handleRelock = async () => {
    setLoading(true)
    try {
      await relockRecord(table, recordId, user!.full_name, user!.role)
      setShowRelockConfirm(false)
      onRelocked()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Gagal re-lock')
    } finally {
      setLoading(false)
    }
  }

  if (isLocked) {
    return (
      <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            background: '#F3F4F6', color: '#374151', fontSize: 12,
            padding: '3px 10px', borderRadius: 999, fontWeight: 600,
          }} title={lockedBy ? `oleh ${lockedBy}` : undefined}>
            🔒 Terkunci
            {lockedAt && <span style={{ fontWeight: 400, color: '#9CA3AF', marginLeft: 4 }}>{fmtDateTime(lockedAt)}</span>}
          </span>
          {isSuperAdmin && (
            <button
              onClick={() => setShowUnlockModal(true)}
              style={{
                fontSize: 11, padding: '3px 10px', background: '#FEF2F2',
                color: '#B91C1C', border: '1px solid #FECACA',
                borderRadius: 999, cursor: 'pointer', fontWeight: 600,
              }}
            >
              Buka Kunci
            </button>
          )}
        </div>

        {showUnlockModal && (
          <div className="modal-overlay" onClick={() => setShowUnlockModal(false)}>
            <div className="modal-box" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
              <h3 className="modal-title">Buka Kunci Record</h3>
              <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
                Record ini akan dibuka untuk diedit. Semua perubahan akan dicatat di audit log.
              </p>
              <div className="form-group">
                <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                  Alasan membuka kunci *
                </label>
                <textarea
                  value={reason}
                  onChange={e => { setReason(e.target.value); setError('') }}
                  placeholder="Tuliskan alasan..."
                  rows={3}
                  style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #E5E7EB', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
                />
              </div>
              {error && <p style={{ color: '#B91C1C', fontSize: 12, marginTop: 4 }}>{error}</p>}
              <div className="modal-footer">
                <button className="btn-secondary" onClick={() => { setShowUnlockModal(false); setReason('') }}>Batal</button>
                <button
                  onClick={handleUnlock}
                  disabled={loading || !reason.trim()}
                  style={{ padding: '8px 20px', background: '#C0392B', color: '#fff', border: 'none', borderRadius: 8, cursor: loading ? 'default' : 'pointer', fontWeight: 600, opacity: loading || !reason.trim() ? 0.6 : 1 }}
                >
                  {loading ? 'Memproses...' : 'Buka Kunci'}
                </button>
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // Unlocked state — tampilkan badge unlocked + tombol re-lock untuk super admin
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          background: '#FEF3C7', color: '#92400E', fontSize: 12,
          padding: '3px 10px', borderRadius: 999, fontWeight: 600,
        }}>
          🔓 Kunci Dibuka
        </span>
        {isSuperAdmin && (
          <button
            onClick={() => setShowRelockConfirm(true)}
            style={{
              fontSize: 11, padding: '3px 10px', background: '#F0FFF4',
              color: '#065F46', border: '1px solid #6EE7B7',
              borderRadius: 999, cursor: 'pointer', fontWeight: 600,
            }}
          >
            Kunci Kembali
          </button>
        )}
      </div>

      {showRelockConfirm && (
        <div className="modal-overlay" onClick={() => setShowRelockConfirm(false)}>
          <div className="modal-box" style={{ maxWidth: 360 }} onClick={e => e.stopPropagation()}>
            <h3 className="modal-title">Kunci Kembali?</h3>
            <p style={{ fontSize: 13, color: '#6B7280', marginBottom: 16 }}>
              Record akan dikunci kembali dan tidak bisa diedit.
            </p>
            {error && <p style={{ color: '#B91C1C', fontSize: 12 }}>{error}</p>}
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowRelockConfirm(false)}>Batal</button>
              <button
                onClick={handleRelock}
                disabled={loading}
                style={{ padding: '8px 20px', background: '#065F46', color: '#fff', border: 'none', borderRadius: 8, cursor: loading ? 'default' : 'pointer', fontWeight: 600, opacity: loading ? 0.6 : 1 }}
              >
                {loading ? 'Memproses...' : 'Kunci Kembali'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
