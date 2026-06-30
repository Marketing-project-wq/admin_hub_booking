import React from 'react'
import { useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing-page">
      <header className="landing-header">
        <h1 className="brand">20FIT</h1>
        <p className="brand-sub">Clinic Admin</p>
      </header>

      <main className="landing-main">
        <h2 className="landing-heading">20FIT Clinic</h2>
        <p className="landing-subtitle">
          Physiotherapy &amp; sports medicine — panel administrasi clinic.
        </p>

        <div className="unit-grid">
          <button className="unit-card" onClick={() => navigate('/clinic/login')}>
            <div className="unit-card-icon">🏥</div>
            <h3>Login sebagai Staff Clinic</h3>
            <p>Masuk untuk mengelola booking, kasir, triase, dan dokter.</p>
          </button>
        </div>
      </main>

      <footer className="landing-footer">
        <small>© 2026 20FIT. All rights reserved.</small>
      </footer>
    </div>
  )
}
