import React from 'react'
import { useTheme } from '../context/ThemeContext'

/** Floating theme toggle for public pages (landing / login) that have no sidebar. */
export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  return (
    <button
      type="button"
      className="theme-fab"
      onClick={toggleTheme}
      aria-label={theme === 'dark' ? 'Aktifkan mode terang' : 'Aktifkan mode gelap'}
      title={theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}
