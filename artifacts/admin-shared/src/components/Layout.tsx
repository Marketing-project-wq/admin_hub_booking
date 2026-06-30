import React, { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'

interface LayoutProps {
  currentUnit: 'arena' | 'gym' | 'clinic'
}

export default function Layout({ currentUnit }: LayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className={`layout layout-${currentUnit}`}>
      <Sidebar currentUnit={currentUnit} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="main-content">
        <button
          className="hamburger"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle sidebar"
        >
          ☰
        </button>
        <Outlet />
      </main>
      {sidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />
      )}
    </div>
  )
}
