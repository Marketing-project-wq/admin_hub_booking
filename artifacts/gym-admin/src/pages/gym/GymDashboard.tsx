import React from 'react'
import { useAuth } from '@workspace/admin-shared'

export default function GymDashboard() {
  const { user } = useAuth()

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: '8px', fontSize: '24px' }}>Gym Dashboard</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '32px' }}>
        Selamat datang, {user?.full_name} — {user?.role}
      </p>
      <div className="card" style={{ maxWidth: '480px' }}>
        <h3 style={{ margin: '0 0 8px', fontSize: '16px', fontWeight: 600 }}>
          Dashboard Gym
        </h3>
        <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '14px' }}>
          Gym Dashboard — Coming in Batch 3. Fitur kelas dan booking gym akan tersedia di sini.
        </p>
      </div>
    </div>
  )
}
