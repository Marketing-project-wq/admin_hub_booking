import React from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface SidebarProps {
  currentUnit: 'arena' | 'gym' | 'clinic'
  open?: boolean
  onClose?: () => void
}

interface MenuItem {
  label: string
  path: string | null
  icon?: string
  divider?: boolean
}

const UNIT_MENUS: Record<string, MenuItem[]> = {
  arena: [
    { label: 'Dashboard',      path: '/arena',                    icon: '◻' },
    { label: 'Kalender',       path: '/arena/calendar',           icon: '◻' },
    { label: 'Venue Booking',  path: '/arena/venue-booking',      icon: '◻' },
    { label: 'Slot Bookings',  path: '/arena/slot-bookings',      icon: '◻' },
    { label: 'Class Bookings', path: '/arena/class-bookings',     icon: '◻' },
    { label: 'Package Orders', path: '/arena/packages',           icon: '◻' },
    { label: 'Vouchers',       path: '/arena/vouchers',           icon: '◻' },
    { label: 'Analytics',      path: '/arena/analytics',          icon: '◻' },
    { label: 'User Management', path: '/arena/users',             icon: '◻' },
    { label: '— Master Data',  path: null,                        divider: true },
    { label: 'Units',          path: '/arena/master/units',       icon: '◻' },
    { label: 'Class Types',    path: '/arena/master/class-types', icon: '◻' },
    { label: 'Schedules',      path: '/arena/master/schedules',   icon: '◻' },
    { label: 'Coaches',        path: '/arena/master/coaches',     icon: '◻' },
    { label: 'Add-ons',        path: '/arena/master/addons',      icon: '◻' },
    { label: 'Blocked Slots',  path: '/arena/master/blocked',     icon: '◻' },
  ],
  gym: [
    { label: 'Dashboard', path: '/gym', icon: '◻' },
  ],
  clinic: [
    { label: 'Dashboard', path: '/clinic',          icon: '◻' },
    { label: 'Bookings',  path: '/clinic/bookings',  icon: '◻' },
    { label: 'Kasir',     path: '/clinic/kasir',     icon: '◻' },
    { label: 'Triase',    path: '/clinic/triase',    icon: '◻' },
    { label: 'Dokter',    path: '/clinic/dokter',    icon: '◻' },
    { label: 'Users',     path: '/clinic/users',     icon: '◻' },
    { label: 'Visits',    path: '/clinic/visits',    icon: '◻' },
    { label: 'Patients',  path: '/clinic/patients',  icon: '◻' },
    { label: '— Master',  path: null,                divider: true },
    { label: 'Services',  path: '/clinic/services',  icon: '◻' },
    { label: 'Slots',     path: '/clinic/slots',     icon: '◻' },
    { label: 'Reports',   path: '/clinic/reports',   icon: '◻' },
    { label: 'Audit Log', path: '/clinic/audit',     icon: '◻' },
  ],
}

export default function Sidebar({ currentUnit, open, onClose }: SidebarProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const menus = UNIT_MENUS[currentUnit] || []

  const handleLogout = () => {
    logout()
    navigate('/', { replace: true })
  }

  const isActive = (path: string) => {
    if (path === '/arena' || path === '/gym' || path === '/clinic') {
      return location.pathname === path
    }
    return location.pathname.startsWith(path)
  }

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-header" style={{
        padding: '24px 20px 16px',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <h2 className="brand-small" style={{
          fontFamily: "'Anton', sans-serif",
          fontWeight: 400,
          fontSize: 22,
          letterSpacing: 2,
          color: '#F0F4FF',
          margin: 0,
        }}>20FIT</h2>
        <span className="unit-label" style={{
          fontFamily: "'Barlow Condensed', sans-serif",
          fontWeight: 700,
          fontStyle: 'italic',
          fontSize: 10,
          letterSpacing: 3,
          color: '#C0392B',
          textTransform: 'uppercase',
          display: 'block',
          marginTop: 2,
        }}>{currentUnit.toUpperCase()}</span>
      </div>

      <nav className="sidebar-menu">
        {menus.map((m, i) => {
          if (m.path === '/arena/users' && user?.role !== 'super_admin') return null
          if (m.path === '/clinic/users' && !(user?.role === 'super_admin' || user?.permissions?.can_manage_users === true)) return null
          if (m.path === '/clinic/audit' && user?.role !== 'super_admin') return null

          // Clinic role-based menu filter
          if (currentUnit === 'clinic') {
            // user.role di AuthContext masih sempit ('super_admin'|'admin'|'staff'),
            // padahal clinic punya role 'dokter'|'therapist'|'registrasi'. Lebarkan ke string.
            const role: string | undefined = user?.role

            // Dokter hanya bisa akses menu Dokter
            if (role === 'dokter' && m.path !== '/clinic/dokter') return null

            // Therapist hanya bisa akses menu Triase
            if (role === 'therapist' && m.path !== '/clinic/triase') return null

            // Admin (kasir) hanya bisa akses Kasir dan Visits
            if (role === 'admin' && m.path &&
                !(['/clinic/kasir', '/clinic/visits', '/clinic/bookings', '/clinic/slots'].includes(m.path))) return null
          }

          if (m.divider) {
            return (
              <div key={i} className="menu-divider">{m.label}</div>
            )
          }
          return (
            <NavLink
              key={m.path!}
              to={m.path!}
              end={m.path === '/arena' || m.path === '/gym' || m.path === '/clinic'}
              className={() => `menu-item${isActive(m.path!) ? ' active' : ''}`}
              onClick={() => onClose?.()}
            >
              {m.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user">
          <div className="sidebar-user-name">{user?.full_name}</div>
          <div className="sidebar-user-role">
            {user?.role === 'super_admin' ? 'SUPER ADMIN' : user?.role?.toUpperCase()}
          </div>
        </div>
        <button onClick={handleLogout}>Logout</button>
      </div>
    </aside>
  )
}
