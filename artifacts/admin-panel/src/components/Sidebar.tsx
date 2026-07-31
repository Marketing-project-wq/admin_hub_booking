import React from 'react'
import { Sun, Moon } from 'lucide-react'
import { NavLink, Link, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useTheme } from '../context/ThemeContext'

interface SidebarProps {
  currentUnit: 'arena' | 'gym' | 'clinic'
  open?: boolean
  onClose?: () => void
}

interface MenuItem {
  label: string
  path: string | null
  divider?: boolean
}

const UNIT_MENUS: Record<string, MenuItem[]> = {
  arena: [
    { label: 'Dashboard',      path: '/arena' },
    { label: 'Kalender',       path: '/arena/calendar' },
    { label: 'Bookings',       path: '/arena/bookings' },
    { label: 'Class Bookings', path: '/arena/class-bookings' },
    { label: 'Package Orders', path: '/arena/packages' },
    { label: 'Vouchers',       path: '/arena/vouchers' },
    { label: 'Analytics',      path: '/arena/analytics' },
    { label: 'API Keys',       path: '/arena/api-keys' },
    { label: 'User Management', path: '/arena/users' },
    { label: '— Master Data',  path: null,                        divider: true },
    { label: 'Units',          path: '/arena/master/units' },
    { label: 'Class Types',    path: '/arena/master/class-types' },
    { label: 'Schedules',      path: '/arena/master/schedules' },
    { label: 'Coaches',        path: '/arena/master/coaches' },
    { label: 'Add-ons',        path: '/arena/master/addons' },
    { label: 'Blocked Slots',  path: '/arena/master/blocked' },
  ],
  gym: [
    { label: 'Dashboard', path: '/gym' },
  ],
  clinic: [
    { label: 'Dashboard', path: '/clinic' },
    { label: 'Kalender',  path: '/clinic/calendar' },
    { label: 'Bookings',  path: '/clinic/bookings' },
    { label: 'Visits',    path: '/clinic/visits' },
    { label: 'Triase',    path: '/clinic/triase' },
    { label: 'EMR',       path: '/clinic/dokter' },
    { label: 'Kasir',     path: '/clinic/kasir' },
    { label: 'Patients',  path: '/clinic/patients' },
    { label: 'Users',     path: '/clinic/users' },
    { label: '— Master',  path: null,                divider: true },
    { label: 'Services',  path: '/clinic/services' },
    { label: 'Slots',     path: '/clinic/slots' },
    { label: 'Reports',   path: '/clinic/reports' },
    { label: 'Audit Log', path: '/clinic/audit' },
  ],
}

// Logo brand per unit, varian per tema (putih utk dark, gelap utk light).
// Unit tanpa entri (gym) tetap render teks 20FIT + label unit.
const UNIT_LOGOS: Record<string, { dark: string; light: string; alt: string }> = {
  clinic: { dark: '/20fit-sports-clinic-white.png', light: '/20fit-sports-clinic-black.png', alt: '20FIT Sports Clinic' },
  arena: { dark: '/20fit-arena-white.png', light: '/20fit-arena-black.png', alt: '20FIT Arena' },
}

export default function Sidebar({ currentUnit, open, onClose }: SidebarProps) {
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const location = useLocation()
  const menus = UNIT_MENUS[currentUnit] || []
  const isSuperAdmin = user?.role === 'super_admin'

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
        borderBottom: '1px solid var(--sidebar-border)',
      }}>
        {UNIT_LOGOS[currentUnit] ? (
          /* Switch varian per tema — pola sama dengan ikon sun/moon di bawah.
             width tetap + height auto: proporsional utk rasio apa pun
             (clinic 7216x2500, arena 1080x608). */
          <img
            src={theme === 'dark' ? UNIT_LOGOS[currentUnit].dark : UNIT_LOGOS[currentUnit].light}
            alt={UNIT_LOGOS[currentUnit].alt}
            style={{ width: 192, maxWidth: '100%', height: 'auto', display: 'block' }}
          />
        ) : (
          <>
            <h2 className="brand-small" style={{
              fontFamily: "'Anton', sans-serif",
              fontWeight: 400,
              fontSize: 22,
              letterSpacing: 2,
              color: 'var(--sidebar-text-strong)',
              margin: 0,
            }}>20FIT</h2>
            <span className="unit-label" style={{
              fontFamily: "'Barlow Condensed', sans-serif",
              fontWeight: 700,
              fontStyle: 'italic',
              fontSize: 10,
              letterSpacing: 3,
              color: 'var(--red)',
              textTransform: 'uppercase',
              display: 'block',
              marginTop: 2,
            }}>{currentUnit.toUpperCase()}</span>
          </>
        )}
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

            // Admin: menu operasional dasar (Kasir, Visits, Bookings, Slots,
            // Kalender) + Patients bila punya permission can_manage_patients
            // (pola sama dengan cek can_manage_users di atas).
            if (role === 'admin' && m.path &&
                !(['/clinic/kasir', '/clinic/visits', '/clinic/bookings', '/clinic/slots', '/clinic/calendar'].includes(m.path)) &&
                !(m.path === '/clinic/patients' && user?.permissions?.can_manage_patients === true)) return null
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
            <Link
              to="/clinic"
              className={`switcher-item${currentUnit === 'clinic' ? ' active' : ''}`}
              onClick={() => onClose?.()}
            >
              Clinic
            </Link>
          </div>
        )}

        <button
          type="button"
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
          title={theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
        >
          <span className={`theme-toggle-track${theme === 'dark' ? ' on' : ''}`}>
            <span className="theme-toggle-icon sun" aria-hidden="true"><Sun size={12} /></span>
            <span className="theme-toggle-icon moon" aria-hidden="true"><Moon size={12} /></span>
            <span className="theme-toggle-thumb" />
          </span>
          <span className="theme-toggle-label">{theme === 'dark' ? 'Mode Gelap' : 'Mode Terang'}</span>
        </button>

        <div className="sidebar-user">
          <div className="sidebar-user-name">{user?.full_name}</div>
          <div className="sidebar-user-role">
            {user?.role === 'super_admin' ? 'SUPER ADMIN' : user?.role?.toUpperCase()}
          </div>
        </div>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </div>
    </aside>
  )
}
