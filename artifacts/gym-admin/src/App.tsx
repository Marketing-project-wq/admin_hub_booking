import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, ProtectedRoute, Layout } from '@workspace/admin-shared'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import GymDashboard from './pages/gym/GymDashboard'
import GymClassBookings from './pages/gym/GymClassBookings'
import GymMembershipOrders from './pages/gym/GymMembershipOrders'
import GymMemberships from './pages/gym/GymMemberships'
import GymClassTypes from './pages/gym/master/GymClassTypes'
import GymSchedules from './pages/gym/master/GymSchedules'
import GymCoaches from './pages/gym/master/GymCoaches'
import GymMembershipPlans from './pages/gym/master/GymMembershipPlans'

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
            <Route path="class-bookings" element={<GymClassBookings />} />
            <Route path="membership-orders" element={<GymMembershipOrders />} />
            <Route path="members" element={<GymMemberships />} />
            <Route path="master/class-types" element={<GymClassTypes />} />
            <Route path="master/schedules" element={<GymSchedules />} />
            <Route path="master/coaches" element={<GymCoaches />} />
            <Route path="master/plans" element={<GymMembershipPlans />} />
          </Route>

          <Route path="*" element={<Navigate to="/gym" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
