import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
  unit?: string
}

export default function ProtectedRoute({ children, unit }: ProtectedRouteProps) {
  const { user, loading, canAccessUnit } = useAuth()

  if (loading) return <div className="loading-screen">Loading...</div>

  if (!user) {
    return <Navigate to={unit ? `/login/${unit}` : '/'} replace />
  }

  if (unit && !canAccessUnit(unit)) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
