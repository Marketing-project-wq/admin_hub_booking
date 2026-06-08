import React from 'react'

export default function ClinicBookings() {
  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: '8px', fontSize: '24px' }}>Clinic Bookings</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '32px' }}>
        Daftar booking physiotherapy & sports medicine.
      </p>
      <div className="card" style={{ maxWidth: '480px' }}>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>
          Belum ada data booking.
        </p>
      </div>
    </div>
  )
}
