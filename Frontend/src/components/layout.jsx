import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { authAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import toast from 'react-hot-toast'
import './Layout.css'

const NAV = [
  { path: '/dashboard', label: 'Pacientes', icon: '◉', roles: ['ADMIN','MEDICO'] },
  { path: '/admin',     label: 'Administración', icon: '⬡', roles: ['ADMIN'] },
]

export default function Layout() {
  const { role, clearAuth } = useAuthStore()
  const navigate  = useNavigate()
  const location  = useLocation()

  // 🔥 normalización clave
  const normalizedRole = role?.toUpperCase()

  const handleLogout = async () => {
    try { await authAPI.logout() } catch {}
    clearAuth()
    navigate('/login', { replace: true })
    toast.success('Sesión cerrada')
  }

  const visibleNav = NAV.filter(n => n.roles.includes(normalizedRole))

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="sidebar-brand">ClinAI</span>
        </div>

        <div className="sidebar-role">{normalizedRole}</div>

        <nav style={{ flex: 1 }}>
          {visibleNav.map(n => (
            <button
              key={n.path}
              className={`nav-item ${location.pathname.startsWith(n.path) ? 'active' : ''}`}
              onClick={() => navigate(n.path)}
            >
              <span className="nav-icon">{n.icon}</span>
              <span>{n.label}</span>
            </button>
          ))}
        </nav>

        <button className="nav-item logout-btn" onClick={handleLogout}>
          <span className="nav-icon">↩</span>
          <span>Salir</span>
        </button>
      </aside>

      {/* Contenido */}
      <div className="layout-main">
        <main className="layout-content">
          {/* 🔥 AQUÍ se renderizan las rutas */}
          <Outlet />
        </main>

        <footer className="footer-bar">
          Sistema Clínico · FHIR R4 · AES-256
        </footer>
      </div>
    </div>
  )
}