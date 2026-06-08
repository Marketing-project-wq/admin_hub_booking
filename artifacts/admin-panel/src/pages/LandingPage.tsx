import React from 'react'
import { useNavigate } from 'react-router-dom'

const units = [
  {
    key: 'arena' as const,
    title: 'Arena',
    icon: '🏟',
    desc: 'Slot booking, kelas, voucher, add-ons',
    disabled: false,
  },
  {
    key: 'gym' as const,
    title: 'Gym',
    icon: '🏋️',
    desc: 'Kelas yoga, HYROX, EMS, dan lainnya',
    disabled: false,
  },
  {
    key: 'clinic' as const,
    title: 'Clinic',
    icon: '🏥',
    desc: 'Physiotherapy & sports medicine',
    disabled: false,
  },
]

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing-page">
      <header className="landing-header">
        <h1 className="brand">20FIT</h1>
        <p className="brand-sub">Admin Panel</p>
      </header>

      <main className="landing-main">
        <h2 className="landing-heading">Pilih Business Unit</h2>
        <p className="landing-subtitle">
          Login sesuai unit bisnis yang Anda kelola.
        </p>

        <div className="unit-grid">
          {units.map((u) => (
            <button
              key={u.key}
              className={`unit-card${u.disabled ? ' disabled' : ''}`}
              disabled={u.disabled}
              onClick={() => !u.disabled && navigate(`/login/${u.key}`)}
            >
              <div className="unit-card-icon">{u.icon}</div>
              <h3>{u.title}</h3>
              <p>{u.desc}</p>
              {u.disabled && <span className="coming-soon">Coming Soon</span>}
            </button>
          ))}
        </div>
      </main>

      <footer className="landing-footer">
        <small>© 2026 20FIT. All rights reserved.</small>
      </footer>
    </div>
  )
}
