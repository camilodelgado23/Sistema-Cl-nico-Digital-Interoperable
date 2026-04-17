import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'

import Layout        from './components/Layout'
import Login         from './views/Login'
import Dashboard     from './views/Dashboard'
import PatientDetail from './views/PatientDetail'
import AdminPanel    from './views/AdminPanel'
import PatientView   from './views/PatientView'

// 🔐 Protección
function PrivateRoute({ children, roles }) {
  const { token, role } = useAuthStore()

  const normalizedRole = role?.toUpperCase()

  if (!token) return <Navigate to="/login" replace />

  if (roles && !roles.includes(normalizedRole)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export default function App() {
  const { role } = useAuthStore()
  const normalizedRole = role?.toUpperCase()

  return (
    <BrowserRouter>
      <Routes>

        {/* Login */}
        <Route path="/login" element={<Login />} />

        {/* Redirect raíz */}
        <Route path="/" element={
          !normalizedRole ? <Navigate to="/login" replace />
          : normalizedRole === 'PACIENTE' ? <Navigate to="/my-profile" replace />
          : normalizedRole === 'ADMIN' ? <Navigate to="/admin" replace />
          : <Navigate to="/dashboard" replace />
        } />

        {/* 🔥 Layout como wrapper */}
        <Route element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }>

          {/* MÉDICO / ADMIN */}
          <Route path="/dashboard" element={
            <PrivateRoute roles={['MEDICO','ADMIN']}>
              <Dashboard />
            </PrivateRoute>
          } />

          <Route path="/patients/:id" element={
            <PrivateRoute roles={['MEDICO','ADMIN']}>
              <PatientDetail />
            </PrivateRoute>
          } />

          {/* ADMIN */}
          <Route path="/admin" element={
            <PrivateRoute roles={['ADMIN']}>
              <AdminPanel />
            </PrivateRoute>
          } />

          {/* PACIENTE */}
          <Route path="/my-profile" element={
            <PrivateRoute roles={['PACIENTE']}>
              <PatientView />
            </PrivateRoute>
          } />

        </Route>

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />

      </Routes>
    </BrowserRouter>
  )
}