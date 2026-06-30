import React from 'react'
import { useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing-page">
      <header className="landing-header">
        <h1 className="brand">20FIT</h1>
        <p className="brand-sub">Gym Admin</p>
      </header>

      <main className="landing-main">
        <h2 className="landing-heading">20FIT Gym</h2>
        <p className="landing-subtitle">
          Capital Place, Kuningan — gym &amp; fitness. Panel administrasi Gym.
        </p>

        <div className="unit-grid">
          <button className="unit-card" onClick={() => navigate('/gym/login')}>
            <div className="unit-card-icon">🏋️</div>
            <h3>Login sebagai Staff Gym</h3>
            <p>Masuk untuk mengelola operasional gym &amp; fitness.</p>
          </button>
        </div>
      </main>

      <footer className="landing-footer">
        <small>© 2026 20FIT. All rights reserved.</small>
      </footer>
    </div>
  )
}
