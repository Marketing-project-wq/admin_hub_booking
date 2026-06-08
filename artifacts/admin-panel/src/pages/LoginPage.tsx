import React, { useState, FormEvent } from 'react'
import { useNavigate, useParams, Link, Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

const UNIT_LABELS: Record<string, string> = { arena: 'Arena', gym: 'Gym' }

export default function LoginPage() {
  const { unit } = useParams<{ unit: string }>()
  const navigate = useNavigate()
  const { login } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!unit || !UNIT_LABELS[unit]) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await login(email, password, unit)
      navigate(`/${unit}`, { replace: true })
    } catch (err: unknown) {
      if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('Login gagal')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <Link to="/" className="back-link">← Kembali</Link>
        <h1 className="brand">20FIT</h1>
        <p className="subtitle">{UNIT_LABELS[unit]} Admin</p>

        <form onSubmit={handleSubmit}>
          <div>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div>
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </div>
          {error && <p className="error">{error}</p>}
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Memproses...' : 'Masuk'}
          </button>
        </form>
      </div>
    </div>
  )
}
