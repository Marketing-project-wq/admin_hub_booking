import React from 'react'
import { useNavigate } from 'react-router-dom'

export default function LandingPage() {
  const navigate = useNavigate()

  return (
    <div className="landing-page">
      <header className="landing-header">
        <h1 className="brand">20FIT</h1>
        <p className="brand-sub">Arena Admin</p>
      </header>

      <main className="landing-main">
        <h2 className="landing-heading">20FIT Arena</h2>
        <p className="landing-subtitle">
          Slot booking, kelas, voucher, dan add-ons — panel administrasi Arena.
        </p>

        <div className="unit-grid">
          <button className="unit-card" onClick={() => navigate('/arena/login')}>
            <div className="unit-card-icon">🏟</div>
            <h3>Login sebagai Staff Arena</h3>
            <p>Masuk untuk mengelola booking slot, kelas, paket, dan voucher.</p>
          </button>
        </div>
      </main>

      <footer className="landing-footer">
        <small>© 2026 20FIT. All rights reserved.</small>
      </footer>
    </div>
  )
}
