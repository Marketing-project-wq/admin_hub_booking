import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ArenaDashboard from './pages/arena/ArenaDashboard'
import ArenaCalendar from './pages/arena/ArenaCalendar'
import ArenaSlotBookings from './pages/arena/ArenaSlotBookings'
import ArenaClassBookings from './pages/arena/ArenaClassBookings'
import ArenaPackageOrders from './pages/arena/ArenaPackageOrders'
import ArenaVouchers from './pages/arena/ArenaVouchers'
import ArenaVenueBooking from './pages/arena/ArenaVenueBooking'
import ArenaUnits from './pages/arena/master/ArenaUnits'
import ArenaClassTypes from './pages/arena/master/ArenaClassTypes'
import ArenaSchedules from './pages/arena/master/ArenaSchedules'
import ArenaCoaches from './pages/arena/master/ArenaCoaches'
import ArenaAddons from './pages/arena/master/ArenaAddons'
import ArenaBlockedSlots from './pages/arena/master/ArenaBlockedSlots'
import ArenaUserManagement from './pages/arena/ArenaUserManagement'
import ArenaAnalytics from './pages/arena/ArenaAnalytics'
import GymDashboard from './pages/gym/GymDashboard'
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
          <Route path="/login/:unit" element={<LoginPage />} />
          <Route
            path="/clinic"
            element={
              <ProtectedRoute unit="clinic">
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

          <Route
            path="/arena"
            element={
              <ProtectedRoute unit="arena">
                <Layout currentUnit="arena" />
              </ProtectedRoute>
            }
          >
            <Route index element={<ArenaDashboard />} />
            <Route path="calendar" element={<ArenaCalendar />} />
            <Route path="venue-booking" element={<ArenaVenueBooking />} />
            <Route path="slot-bookings" element={<ArenaSlotBookings />} />
            <Route path="class-bookings" element={<ArenaClassBookings />} />
            <Route path="packages" element={<ArenaPackageOrders />} />
            <Route path="vouchers" element={<ArenaVouchers />} />
            <Route path="users" element={<ArenaUserManagement />} />
            <Route path="analytics" element={<ArenaAnalytics />} />
            <Route path="master/units" element={<ArenaUnits />} />
            <Route path="master/class-types" element={<ArenaClassTypes />} />
            <Route path="master/schedules" element={<ArenaSchedules />} />
            <Route path="master/coaches" element={<ArenaCoaches />} />
            <Route path="master/addons" element={<ArenaAddons />} />
            <Route path="master/blocked" element={<ArenaBlockedSlots />} />
          </Route>

          <Route
            path="/gym"
            element={
              <ProtectedRoute unit="gym">
                <Layout currentUnit="gym" />
              </ProtectedRoute>
            }
          >
            <Route index element={<GymDashboard />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
