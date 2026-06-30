import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { supabase } from '../lib/supabase'

interface AdminUser {
  id: string
  email: string
  full_name: string
  role: 'super_admin' | 'admin' | 'staff'
  unit?: string
  permissions?: Record<string, boolean>
}

interface AuthContextType {
  user: AdminUser | null
  loading: boolean
  login: (email: string, password: string, unit: string) => Promise<AdminUser>
  logout: () => void
  canAccessUnit: (targetUnit: string) => boolean
  hasPermission: (key: string) => boolean
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('admin_user')
    if (stored) {
      try {
        setUser(JSON.parse(stored))
      } catch {
        localStorage.removeItem('admin_user')
      }
    }
    setLoading(false)
  }, [])

  const login = async (email: string, password: string, unit: string): Promise<AdminUser> => {
    const { data, error } = await supabase.rpc('validate_admin_login', {
      p_email: email,
      p_password: password,
      p_unit: unit,
    })
    if (error) throw error
    if (!data || data.length === 0) {
      throw new Error('Email atau password salah, atau Anda tidak memiliki akses ke unit ini')
    }
    const profile = data[0] as AdminUser
    localStorage.setItem('admin_user', JSON.stringify(profile))
    setUser(profile)
    return profile
  }

  const logout = () => {
    localStorage.removeItem('admin_user')
    setUser(null)
  }

  const canAccessUnit = (targetUnit: string): boolean => {
    if (!user) return false
    if (user.role === 'super_admin') return true
    return user.unit === targetUnit
  }

  const hasPermission = (key: string): boolean => {
    if (!user) return false
    if (user.role === 'super_admin' || user.role === 'admin') return true
    return Boolean(user.permissions?.[key])
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, canAccessUnit, hasPermission }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
