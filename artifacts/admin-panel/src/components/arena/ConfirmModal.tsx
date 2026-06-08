import React from 'react'

interface Props {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
  loading?: boolean
}

export default function ConfirmModal({ title, message, onConfirm, onCancel, danger, loading }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal-box" style={{ maxWidth: 400 }}>
        <h3 className="modal-title">{title}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 24px' }}>{message}</p>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onCancel} disabled={loading}>Batal</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm} disabled={loading}>
            {loading ? 'Memproses...' : 'Konfirmasi'}
          </button>
        </div>
      </div>
    </div>
  )
}
