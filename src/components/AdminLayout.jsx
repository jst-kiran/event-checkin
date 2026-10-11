import { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, ScanLine, LogOut, Menu, X } from 'lucide-react'
import { api } from '../services/api'

const NAV = [
  { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/checkin', label: 'Check-in desk', icon: ScanLine, end: true },
]

function navClass({ isActive }) {
  return `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
  }`
}

export default function AdminLayout({ title, actions, children }) {
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleLogout = async () => {
    // The redirect happens either way: a network blip during logout must not
    // strand an organizer on a dashboard they think they have left.
    try {
      await api.logout()
    } finally {
      navigate('/admin/login', { replace: true })
    }
  }

  const links = NAV.map(({ to, label, icon: Icon, end }) => (
    <NavLink key={to} to={to} end={end} className={navClass} onClick={() => setMenuOpen(false)}>
      <Icon className="w-[18px] h-[18px]" aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  ))

  const logoutButton = (
    <button
      onClick={handleLogout}
      className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50 text-sm font-medium transition-colors"
    >
      <LogOut className="w-[18px] h-[18px]" aria-hidden="true" />
      <span>Logout</span>
    </button>
  )

  return (
    <div className="min-h-screen bg-slate-50 flex">
      <aside className="hidden md:flex md:flex-col w-60 shrink-0 bg-white border-r border-slate-100 h-screen sticky top-0 px-4 py-6">
        <div className="px-3 mb-8">
          <AppName />
        </div>
        <nav className="flex-1 flex flex-col gap-1">{links}</nav>
        {logoutButton}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden sticky top-0 z-20 bg-white border-b border-slate-100">
          <div className="flex items-center justify-between px-4 py-3">
            <AppName />
            <button
              onClick={() => setMenuOpen((open) => !open)}
              className="p-2 -mr-2 text-slate-500"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
            >
              {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
          {menuOpen && (
            <nav className="px-4 pb-3 pt-2 flex flex-col gap-1 border-t border-slate-50">
              {links}
              {logoutButton}
            </nav>
          )}
        </div>

        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-8 py-6 sm:py-8">
          <header className="mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{title}</h1>
            {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
          </header>
          {children}
        </main>
      </div>
    </div>
  )
}

/** A plain text name for the organizer area — no event or community logo. */
function AppName() {
  return (
    <div>
      <p className="text-base font-bold text-slate-900 leading-tight">Event Check-in</p>
      <p className="text-xs text-slate-400">Organizer dashboard</p>
    </div>
  )
}
