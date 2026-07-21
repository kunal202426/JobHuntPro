import { NavLink, useLocation, useNavigate, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useAuth } from './context/AuthContext'
import JobHuntRoute from './routes/JobHuntRoute'
import ColdRoute from './routes/ColdRoute'
import LoginPage from './pages/LoginPage'
import SettingsPage from './pages/SettingsPage'
import ExtensionsPage from './pages/ExtensionsPage'
import AdminPage from './pages/AdminPage'
import HelpPage from './pages/HelpPage'
import './Shell.css'

function Tab({ to, dot, children }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => `shell-tab ${isActive ? 'shell-tab--active' : ''}`}
    >
      <span className="shell-tab-dot" style={{ background: dot }} />
      {children}
    </NavLink>
  )
}

// Single always-mounted shell — all panes stay in DOM so React state
// (filters, scroll, typed input) is never wiped on tab switches.
function WorkspaceShell() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAuth()

  // First-time setup banner — dismissed permanently via localStorage
  const [setupSeen, setSetupSeen] = useState(() => !!localStorage.getItem('jh_setup_v2'))
  const dismissSetup = () => {
    localStorage.setItem('jh_setup_v2', '1')
    setSetupSeen(true)
  }

  useEffect(() => {
    if (pathname === '/') navigate('/jobhunt', { replace: true })
    // Redirect non-admins away from /admin
    if (pathname.startsWith('/admin') && !user?.is_admin) {
      navigate('/jobhunt', { replace: true })
    }
    // Dismiss setup banner when user opens Help
    if (pathname.startsWith('/help') && !setupSeen) dismissSetup()
  }, [pathname, navigate, user?.is_admin])

  const showJobhunt = pathname === '/' || pathname.startsWith('/jobhunt')
  const showCold    = pathname.startsWith('/cold')
  const showAdmin   = pathname.startsWith('/admin')
  const showHelp    = pathname.startsWith('/help')

  return (
    <div className="shell-root">
      <nav className="shell-nav">
        <span className="shell-brand">Workspace</span>
        <Tab to="/jobhunt" dot="#22c55e">JobHunt Engine</Tab>
        <Tab to="/cold"    dot="#f97316">Cold Outreach</Tab>
        {user?.is_admin && (
          <Tab to="/admin" dot="#6366f1">Admin</Tab>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12, paddingRight: 16 }}>
          <NavLink
            to="/help"
            onClick={dismissSetup}
            className={({ isActive }) => `shell-tab ${isActive ? 'shell-tab--active' : ''} ${!setupSeen ? 'shell-tab--pulse' : ''}`}
            style={{ fontSize: 12 }}
          >
            ? Help
          </NavLink>
          <NavLink
            to="/extensions"
            className={({ isActive }) => `shell-tab ${isActive ? 'shell-tab--active' : ''}`}
            style={{ fontSize: 12 }}
          >
            🧩 Extensions
          </NavLink>
          <NavLink
            to="/settings"
            className={({ isActive }) => `shell-tab ${isActive ? 'shell-tab--active' : ''}`}
            style={{ fontSize: 12 }}
          >
            ⚙ Settings
          </NavLink>
          <button
            onClick={logout}
            className="shell-tab"
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9a8a7e' }}
          >
            Sign out
          </button>
        </div>
      </nav>

      {!setupSeen && (
        <div className="shell-setup-banner">
          <span>👋 First time here? Follow the setup guide to get started.</span>
          <NavLink to="/help" onClick={dismissSetup} className="shell-setup-banner-link">
            View Setup Guide →
          </NavLink>
          <button onClick={dismissSetup} className="shell-setup-banner-close" aria-label="Dismiss">×</button>
        </div>
      )}

      <div className="shell-body">
        <div className={`shell-pane${showJobhunt ? '' : ' shell-pane--hidden'}`}>
          <JobHuntRoute />
        </div>
        <div className={`shell-pane${showCold ? '' : ' shell-pane--hidden'}`}>
          <ColdRoute />
        </div>
        {user?.is_admin && (
          <div className={`shell-pane${showAdmin ? '' : ' shell-pane--hidden'}`}>
            <AdminPage />
          </div>
        )}
        <div className={`shell-pane${showHelp ? '' : ' shell-pane--hidden'}`}>
          <HelpPage />
        </div>
      </div>
    </div>
  )
}

function RequireAuth({ children }) {
  const { user, loading, serverWaking } = useAuth()
  if (loading) return (
    <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 14 }}>
      {serverWaking ? '⏳ Server is starting up, please wait…' : 'Loading…'}
    </div>
  )
  if (!user) return <Navigate to="/login" replace />
  return children
}

function RequireLogin({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}>Loading…</div>
  if (!user) return <Navigate to="/login" replace />
  return children
}

export default function Shell() {
  return (
    <Routes>
      <Route path="/login"    element={<LoginPage />} />
      <Route path="/register" element={<Navigate to="/login" replace />} />
      <Route path="/settings" element={<RequireLogin><SettingsPage /></RequireLogin>} />
      <Route path="/extensions" element={<RequireLogin><ExtensionsPage /></RequireLogin>} />
      {/* Single WorkspaceShell for ALL authenticated routes.
          Separate /admin route removed — it created a second shell instance
          and wiped all state (filters, scroll) on every admin ↔ tab switch. */}
      <Route path="/*" element={<RequireAuth><WorkspaceShell /></RequireAuth>} />
    </Routes>
  )
}
