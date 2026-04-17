import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'

import Login         from './views/Login'
import Dashboard     from './views/Dashboard'
import PatientDetail from './views/PatientDetail'
import AdminPanel    from './views/AdminPanel'
import PatientView   from './views/PatientView'

// Protección de rutas
function PrivateRoute({ children, roles }) {
  const { token, role } = useAuthStore()

  if (!token) return <Navigate to="/login" replace />

  if (roles && !roles.includes(role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

export default function App() {
  const { role } = useAuthStore()

  return (
    <BrowserRouter>
      <Routes>

        {/* Login */}
        <Route path="/login" element={<Login />} />

        {/* Redirect raíz */}
        <Route path="/" element={
          !role ? <Navigate to="/login" />
          : role === 'PACIENTE' ? <Navigate to="/my-profile" />
          : role === 'ADMIN' ? <Navigate to="/admin" />
          : <Navigate to="/dashboard" />
        } />

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

        {/* fallback */}
        <Route path="*" element={<Navigate to="/" />} />

      </Routes>
    </BrowserRouter>
  )
}