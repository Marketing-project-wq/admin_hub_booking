import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, ProtectedRoute, Layout } from '@workspace/admin-shared'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ClinicDashboard from './pages/clinic/ClinicDashboard'
import ClinicBookings from './pages/clinic/ClinicBookings'
import ClinicSlots from './pages/clinic/ClinicSlots'
import ClinicPatients from './pages/clinic/ClinicPatients'
import ClinicVisits from './pages/clinic/ClinicVisits'
import ClinicStaff from './pages/clinic/ClinicStaff'
import ClinicServices from './pages/clinic/ClinicServices'
import ClinicReports from './pages/clinic/ClinicReports'
import ClinicVisitDetail from './pages/clinic/ClinicVisitDetail'
import ClinicUserManagement from './pages/clinic/ClinicUserManagement'
import ClinicKasir from './pages/clinic/ClinicKasir'
import ClinicDokter from './pages/clinic/ClinicDokter'
import ClinicTriase from './pages/clinic/ClinicTriase'
import ClinicAuditLog from './pages/clinic/ClinicAuditLog'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/clinic/login" element={<LoginPage />} />
          <Route
            path="/clinic"
            element={
              <ProtectedRoute unit="clinic" loginPath="/clinic/login">
                <Layout currentUnit="clinic" />
              </ProtectedRoute>
            }
          >
            <Route index element={<ClinicDashboard />} />
            <Route path="bookings" element={<ClinicBookings />} />
            <Route path="visits" element={<ClinicVisits />} />
            <Route path="visits/:id" element={<ClinicVisitDetail />} />
            <Route path="users" element={<ClinicUserManagement />} />
            <Route path="kasir" element={<ClinicKasir />} />
            <Route path="dokter" element={<ClinicDokter />} />
            <Route path="triase" element={<ClinicTriase />} />
            <Route path="audit" element={<ClinicAuditLog />} />
            <Route path="slots" element={<ClinicSlots />} />
            <Route path="patients" element={<ClinicPatients />} />
            <Route path="staff" element={<ClinicStaff />} />
            <Route path="services" element={<ClinicServices />} />
            <Route path="reports" element={<ClinicReports />} />
          </Route>

          <Route path="*" element={<Navigate to="/clinic" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
