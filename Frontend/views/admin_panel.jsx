import { useState, useEffect } from 'react'
import { adminAPI } from '../services/api'
import Layout from '../components/Layout'
import toast from 'react-hot-toast'
import './AdminPanel.css'

export default function AdminPanel() {
  const [tab,      setTab]      = useState('users')
  const [users,    setUsers]    = useState([])
  const [audit,    setAudit]    = useState([])
  const [stats,    setStats]    = useState(null)
  const [loading,  setLoading]  = useState(false)

  // User form
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'MEDICO' })

  // Audit filters
  const [filterAction, setFilterAction] = useState('')
  const [filterUser,   setFilterUser]   = useState('')

  useEffect(() => {
    if (tab === 'users')   loadUsers()
    if (tab === 'audit')   loadAudit()
    if (tab === 'stats')   loadStats()
  }, [tab])

  const loadUsers = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.listUsers({ limit: 50 })
      setUsers(data.entry || [])
    } catch { toast.error('Error cargando usuarios') }
    finally { setLoading(false) }
  }

  const loadAudit = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.auditLog({
        limit: 100,
        ...(filterAction && { action: filterAction }),
        ...(filterUser   && { user_id: filterUser }),
      })
      setAudit(data.entry || [])
    } catch { toast.error('Error cargando audit log') }
    finally { setLoading(false) }
  }

  const loadStats = async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.stats()
      setStats(data)
    } catch { toast.error('Error cargando estadísticas') }
    finally { setLoading(false) }
  }

  const handleCreateUser = async (e) => {
    e.preventDefault()
    try {
      await adminAPI.createUser(newUser)
      toast.success(`Usuario ${newUser.username} creado`)
      setNewUser({ username: '', password: '', role: 'MEDICO' })
      loadUsers()
    } catch (e) {
      const detail = e.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : 'Error creando usuario')
    }
  }

  const handleToggleActive = async (uid, isActive) => {
    try {
      await adminAPI.updateUser(uid, { is_active: !isActive })
      toast.success(isActive ? 'Usuario desactivado' : 'Usuario activado')
      loadUsers()
    } catch { toast.error('Error actualizando usuario') }
  }

  const handleExport = async (fmt) => {
    try {
      const { data } = await adminAPI.exportAudit(fmt)
      const url  = URL.createObjectURL(new Blob([data]))
      const link = document.createElement('a')
      link.href = url
      link.download = `audit_log.${fmt}`
      link.click()
      URL.revokeObjectURL(url)
    } catch { toast.error('Error exportando') }
  }

  const TABS = [
    { id: 'users', label: 'Usuarios' },
    { id: 'audit', label: 'Audit Log' },
    { id: 'stats', label: 'Estadísticas' },
  ]

  return (
    <Layout>
      <div className="admin-panel page-enter">
        <h2 style={{ marginBottom: '1.5rem' }}>Panel de Administración</h2>

        {/* Tabs */}
        <div className="tabs" style={{ marginBottom: '1.5rem' }}>
          {TABS.map(t => (
            <button key={t.id} role="tab" aria-selected={tab === t.id}
              className={`tab-btn ${tab === t.id ? 'active' : ''}`}
              onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <span className="spinner" />
          </div>
        )}

        {/* ── Users tab ── */}
        {tab === 'users' && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            {/* Create user form */}
            <div className="card">
              <h3 style={{ marginBottom: '1rem' }}>Crear usuario</h3>
              <form onSubmit={handleCreateUser} style={{ display: 'flex', gap: '0.875rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <div style={{ flex: '1 1 180px' }}>
                  <label className="label" htmlFor="new-username">Usuario</label>
                  <input id="new-username" className="input" placeholder="nombre_usuario"
                    value={newUser.username}
                    onChange={e => setNewUser(p => ({ ...p, username: e.target.value }))}
                    required />
                </div>
                <div style={{ flex: '1 1 180px' }}>
                  <label className="label" htmlFor="new-password">Contraseña</label>
                  <input id="new-password" className="input" type="password" placeholder="≥10 chars, A, 1, @"
                    value={newUser.password}
                    onChange={e => setNewUser(p => ({ ...p, password: e.target.value }))}
                    required />
                </div>
                <div style={{ flex: '1 1 140px' }}>
                  <label className="label" htmlFor="new-role">Rol</label>
                  <select id="new-role" className="input"
                    value={newUser.role}
                    onChange={e => setNewUser(p => ({ ...p, role: e.target.value }))}>
                    <option>ADMIN</option>
                    <option>MEDICO</option>
                    <option>PACIENTE</option>
                  </select>
                </div>
                <button type="submit" className="btn btn-primary">+ Crear</button>
              </form>
            </div>

            {/* Users table */}
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrap">
                <table aria-label="Lista de usuarios">
                  <thead>
                    <tr>
                      <th>Usuario</th>
                      <th>Rol</th>
                      <th>Estado</th>
                      <th>Creado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{u.username}</td>
                        <td><span className="mono" style={{ fontSize: '0.8125rem' }}>{u.role}</span></td>
                        <td>
                          <span className={`badge ${u.is_active ? 'badge-signed' : 'badge-pending'}`}>
                            {u.is_active ? 'Activo' : 'Inactivo'}
                          </span>
                        </td>
                        <td>
                          <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {new Date(u.created_at).toLocaleDateString('es-CO')}
                          </span>
                        </td>
                        <td>
                          <button
                            className={`btn ${u.is_active ? 'btn-danger' : 'btn-ghost'}`}
                            style={{ fontSize: '0.75rem', padding: '0.3rem 0.75rem' }}
                            onClick={() => handleToggleActive(u.id, u.is_active)}>
                            {u.is_active ? 'Desactivar' : 'Activar'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Audit tab ── */}
        {tab === 'audit' && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {/* Filters + export */}
            <div style={{ display: 'flex', gap: '0.875rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <div>
                <label className="label">Acción</label>
                <input className="input" placeholder="LOGIN, SIGN_REPORT…" style={{ width: 200 }}
                  value={filterAction}
                  onChange={e => setFilterAction(e.target.value)} />
              </div>
              <button className="btn btn-ghost" onClick={loadAudit}>Filtrar</button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-ghost" onClick={() => handleExport('json')}>↓ JSON</button>
                <button className="btn btn-ghost" onClick={() => handleExport('csv')}>↓ CSV</button>
              </div>
            </div>

            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              <div className="table-wrap" style={{ maxHeight: 500, overflowY: 'auto' }}>
                <table aria-label="Audit log">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Acción</th>
                      <th>Recurso</th>
                      <th>Resultado</th>
                      <th>IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map(a => (
                      <tr key={a.id}>
                        <td><span className="mono" style={{ fontSize: '0.75rem' }}>
                          {new Date(a.ts).toLocaleString('es-CO')}
                        </span></td>
                        <td><span className="mono" style={{ fontSize: '0.8125rem', color: 'var(--cyan)' }}>
                          {a.action}
                        </span></td>
                        <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {a.resource_type}{a.resource_id ? ` · ${a.resource_id.slice(0,8)}…` : ''}
                        </span></td>
                        <td>
                          <span className={`badge ${a.result === 'SUCCESS' ? 'badge-signed' : 'badge-critical'}`}
                            style={{ fontSize: '0.625rem' }}>
                            {a.result}
                          </span>
                        </td>
                        <td><span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {a.ip_address || '—'}
                        </span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ── Stats tab ── */}
        {tab === 'stats' && stats && !loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
            {[
              { label: 'Inferencias totales', value: stats.total_inferences, color: 'var(--cyan)' },
              { label: 'Aceptadas',           value: stats.accepted,         color: 'var(--success)' },
              { label: 'Rechazadas',          value: stats.rejected,         color: 'var(--danger)' },
              { label: 'Pendientes firma',    value: stats.pending_signature, color: 'var(--warning)' },
              { label: 'Tasa de aceptación',  value: `${(stats.acceptance_rate * 100).toFixed(1)}%`, color: 'var(--success)' },
              { label: 'Total pacientes',     value: stats.total_patients,   color: 'var(--cyan)' },
              { label: 'Total usuarios',      value: stats.total_users,      color: 'var(--text-secondary)' },
            ].map(s => (
              <div key={s.label} className="card" style={{ textAlign: 'center' }}>
                <div style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: '2rem',
                  fontWeight: 800,
                  color: s.color,
                  lineHeight: 1,
                  marginBottom: '0.5rem',
                }}>{s.value ?? '—'}</div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--text-tertiary)',
                  fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}>
                  {s.label}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  )
}