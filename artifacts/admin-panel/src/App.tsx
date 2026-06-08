import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ArenaDashboard from './pages/arena/ArenaDashboard'
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
import GymDashboard from './pages/gym/GymDashboard'
import ClinicDashboard from './pages/clinic/ClinicDashboard'
import ClinicBookings from './pages/clinic/ClinicBookings'
import ClinicSlots from './pages/clinic/ClinicSlots'

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
            <Route path="slots" element={<ClinicSlots />} />
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
            <Route path="venue-booking" element={<ArenaVenueBooking />} />
            <Route path="slot-bookings" element={<ArenaSlotBookings />} />
            <Route path="class-bookings" element={<ArenaClassBookings />} />
            <Route path="packages" element={<ArenaPackageOrders />} />
            <Route path="vouchers" element={<ArenaVouchers />} />
            <Route path="users" element={<ArenaUserManagement />} />
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
