import React from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface ProtectedRouteProps {
  children: React.ReactNode
  unit?: string
  loginPath?: string
}

export default function ProtectedRoute({ children, unit, loginPath }: ProtectedRouteProps) {
  const { user, loading, canAccessUnit } = useAuth()

  if (loading) return <div className="loading-screen">Loading...</div>

  if (!user) {
    const fallbackPath = unit ? `/login/${unit}` : '/'
    return <Navigate to={loginPath ?? fallbackPath} replace />
  }

  if (unit && !canAccessUnit(unit)) {
    return <Navigate to={loginPath ?? '/'} replace />
  }

  return <>{children}</>
}
