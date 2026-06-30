import React from 'react'

export default function ClinicComingSoon() {
  return (
    <div style={{ textAlign: 'center', padding: '80px 32px' }}>
      <div style={{ fontSize: '48px', marginBottom: '24px' }}>🏥</div>
      <h2 style={{ fontSize: '28px', margin: '0 0 12px' }}>Clinic</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: '16px', margin: '0 0 8px' }}>
        Physiotherapy &amp; Sports Medicine
      </p>
      <p style={{
        display: 'inline-block',
        color: 'var(--red)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        fontSize: '12px',
        border: '1px solid var(--red)',
        borderRadius: '4px',
        padding: '4px 12px',
        marginTop: '16px',
      }}>
        Coming Soon
      </p>
    </div>
  )
}
