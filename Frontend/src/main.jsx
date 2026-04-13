import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from './store/auth'

import './index.css'
import Login         from './views/Login'
import Dashboard     from './views/Dashboard'
import PatientDetail from './views/PatientDetail'
import AdminPanel    from './views/AdminPanel'

// Componente para proteger rutas privadas
function PrivateRoute({ children, requiredRole }) {
  const { token, role } = useAuthStore()

  if (!token) return <Navigate to="/login" replace />

  if (requiredRole) {
    const isAdmin = role === 'ADMIN'
    const roleOk  = role === requiredRole || isAdmin
    if (!roleOk) return <Navigate to="/dashboard" replace />
  }

  return children
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/dashboard" element={
          <PrivateRoute><Dashboard /></PrivateRoute>
        } />

        <Route path="/patients/:id" element={
          <PrivateRoute><PatientDetail /></PrivateRoute>
        } />

        <Route path="/admin" element={
          <PrivateRoute requiredRole="ADMIN"><AdminPanel /></PrivateRoute>
        } />

        {/* Cualquier otra ruta → dashboard */}
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>

    {/* Toast notifications globales */}
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: 'var(--bg-elevated)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-soft)',
          fontFamily: 'var(--font-body)',
          fontSize: '0.875rem',
        },
        success: {
          iconTheme: { primary: 'var(--success)', secondary: 'var(--bg-base)' },
        },
        error: {
          iconTheme: { primary: 'var(--danger)', secondary: 'var(--bg-base)' },
          duration: 6000,
        },
      }}
    />
  </React.StrictMode>
)