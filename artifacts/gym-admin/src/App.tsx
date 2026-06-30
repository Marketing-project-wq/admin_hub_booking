import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, ProtectedRoute, Layout } from '@workspace/admin-shared'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import GymDashboard from './pages/gym/GymDashboard'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/gym/login" element={<LoginPage />} />
          <Route
            path="/gym"
            element={
              <ProtectedRoute unit="gym" loginPath="/gym/login">
                <Layout currentUnit="gym" />
              </ProtectedRoute>
            }
          >
            <Route index element={<GymDashboard />} />
          </Route>

          <Route path="*" element={<Navigate to="/gym" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
