import { useNavigate, useLocation } from 'react-router-dom'
import { authAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import toast from 'react-hot-toast'
import './Layout.css'

const NAV = [
  { path: '/dashboard', label: 'Pacientes',      icon: '◉', roles: ['ADMIN','MEDICO','PACIENTE'] },
  { path: '/admin',     label: 'Administración', icon: '⬡', roles: ['ADMIN'] },
]

export default function Layout({ children }) {
  const { role, clearAuth } = useAuthStore()
  const navigate  = useNavigate()
  const location  = useLocation()

  const handleLogout = async () => {
    try { await authAPI.logout() } catch {}
    clearAuth()
    navigate('/login', { replace: true })
    toast.success('Sesión cerrada')
  }

  const visibleNav = NAV.filter(n => n.roles.includes(role))

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar" role="navigation" aria-label="Navegación principal">
        {/* Logo */}
        <div className="sidebar-logo">
          <svg width="28" height="28" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="8"
              fill="rgba(56,189,248,0.1)" stroke="rgba(56,189,248,0.3)" strokeWidth="1"/>
            <path d="M18 8v20M8 18h20" stroke="#38bdf8" strokeWidth="2.5" strokeLinecap="round"/>
            <circle cx="18" cy="18" r="4" fill="none" stroke="#38bdf8" strokeWidth="1.5"/>
          </svg>
          <span className="sidebar-brand">ClinAI</span>
        </div>

        {/* Rol activo */}
        <div className="sidebar-role">{role}</div>

        {/* Links de navegación */}
        <nav style={{ flex: 1 }}>
          {visibleNav.map(n => (
            <button
              key={n.path}
              className={`nav-item ${location.pathname.startsWith(n.path) ? 'active' : ''}`}
              onClick={() => navigate(n.path)}
              aria-current={location.pathname.startsWith(n.path) ? 'page' : undefined}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        {/* Logout */}
        <button
          className="nav-item logout-btn"
          onClick={handleLogout}
          aria-label="Cerrar sesión"
        >
          <span className="nav-icon">↩</span>
          <span>Salir</span>
        </button>
      </aside>

      {/* Área principal */}
      <div className="layout-main">
        <main className="layout-content" role="main" id="main-content">
          {children}
        </main>
        <footer className="footer-bar" role="contentinfo">
          Protegido bajo Ley 1581/2012 · Datos cifrados AES-256 · Sistema auditado · FHIR R4
        </footer>
      </div>
    </div>
  )
}