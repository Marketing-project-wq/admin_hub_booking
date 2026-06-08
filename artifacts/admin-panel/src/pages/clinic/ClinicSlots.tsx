import React from 'react'

export default function ClinicSlots() {
  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: '8px', fontSize: '24px' }}>Clinic Slots</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '32px' }}>
        Kelola jadwal slot ketersediaan clinic.
      </p>
      <div className="card" style={{ maxWidth: '480px' }}>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>
          Belum ada slot terjadwal.
        </p>
      </div>
    </div>
  )
}
