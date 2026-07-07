import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, ProtectedRoute, Layout } from '@workspace/admin-shared'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ArenaDashboard from './pages/arena/ArenaDashboard'
import ArenaCalendar from './pages/arena/ArenaCalendar'
import ArenaVenueBooking from './pages/arena/ArenaVenueBooking'
import ArenaSlotBookings from './pages/arena/ArenaSlotBookings'
import ArenaClassBookings from './pages/arena/ArenaClassBookings'
import ArenaPackageOrders from './pages/arena/ArenaPackageOrders'
import ArenaVouchers from './pages/arena/ArenaVouchers'
import ArenaUserManagement from './pages/arena/ArenaUserManagement'
import ArenaAnalytics from './pages/arena/ArenaAnalytics'
import ArenaApiKeys from './pages/arena/ArenaApiKeys'
import ArenaUnits from './pages/arena/master/ArenaUnits'
import ArenaClassTypes from './pages/arena/master/ArenaClassTypes'
import ArenaSchedules from './pages/arena/master/ArenaSchedules'
import ArenaCoaches from './pages/arena/master/ArenaCoaches'
import ArenaAddons from './pages/arena/master/ArenaAddons'
import ArenaBlockedSlots from './pages/arena/master/ArenaBlockedSlots'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/arena/login" element={<LoginPage />} />
          <Route
            path="/arena"
            element={
              <ProtectedRoute unit="arena" loginPath="/arena/login">
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
            <Route path="api-keys" element={<ArenaApiKeys />} />
            <Route path="master/units" element={<ArenaUnits />} />
            <Route path="master/class-types" element={<ArenaClassTypes />} />
            <Route path="master/schedules" element={<ArenaSchedules />} />
            <Route path="master/coaches" element={<ArenaCoaches />} />
            <Route path="master/addons" element={<ArenaAddons />} />
            <Route path="master/blocked" element={<ArenaBlockedSlots />} />
          </Route>

          <Route path="*" element={<Navigate to="/arena" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
