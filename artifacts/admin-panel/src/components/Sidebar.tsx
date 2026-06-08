import React from 'react'
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

interface SidebarProps {
  currentUnit: 'arena' | 'gym'
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
    { label: 'Venue Booking',  path: '/arena/venue-booking',      icon: '◻' },
    { label: 'Slot Bookings',  path: '/arena/slot-bookings',      icon: '◻' },
    { label: 'Class Bookings', path: '/arena/class-bookings',     icon: '◻' },
    { label: 'Package Orders', path: '/arena/packages',           icon: '◻' },
    { label: 'Vouchers',       path: '/arena/vouchers',           icon: '◻' },
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
}

export default function Sidebar({ currentUnit, open, onClose }: SidebarProps) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const menus = UNIT_MENUS[currentUnit] || []
  const isSuperAdmin = user?.role === 'super_admin'

  const handleLogout = () => {
    logout()
    navigate('/', { replace: true })
  }

  const isActive = (path: string) => {
    if (path === '/arena' || path === '/gym') {
      return location.pathname === path
    }
    return location.pathname.startsWith(path)
  }

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <div className="sidebar-header">
        <h2 className="brand-small">20FIT</h2>
        <span className="unit-label">{currentUnit.toUpperCase()}</span>
      </div>

      <nav className="sidebar-menu">
        {menus.map((m, i) => {
          if (m.path === '/arena/users' && user?.role !== 'super_admin') return null
          if (m.divider) {
            return (
              <div key={i} className="menu-divider">{m.label}</div>
            )
          }
          return (
            <NavLink
              key={m.path!}
              to={m.path!}
              end={m.path === '/arena' || m.path === '/gym'}
              className={() => `menu-item${isActive(m.path!) ? ' active' : ''}`}
              onClick={() => onClose?.()}
            >
              {m.label}
            </NavLink>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        {isSuperAdmin && (
          <div className="unit-switcher">
            <p className="switcher-label">Switch Unit</p>
            <Link
              to="/arena"
              className={`switcher-item${currentUnit === 'arena' ? ' active' : ''}`}
              onClick={() => onClose?.()}
            >
              Arena
            </Link>
            <Link
              to="/gym"
              className={`switcher-item${currentUnit === 'gym' ? ' active' : ''}`}
              onClick={() => onClose?.()}
            >
              Gym
            </Link>
          </div>
        )}

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
