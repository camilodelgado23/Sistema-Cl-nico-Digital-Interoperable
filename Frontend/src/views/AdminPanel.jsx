import { useState, useEffect, useCallback } from 'react'
import { adminAPI } from '../services/api'
import './AdminPanel.css'

// ── Stats cards ───────────────────────────────────────────────────────────────
function StatsBar({ stats }) {
  if (!stats) return null
  const cards = [
    { label: 'Total Pacientes',   value: stats.total_patients,   icon: '👥' },
    { label: 'Inferencias',       value: stats.total_inferences, icon: '🤖' },
    { label: 'Aceptadas',         value: stats.accepted,         icon: '✅' },
    { label: 'Rechazadas',        value: stats.rejected,         icon: '❌' },
    { label: 'Pendientes firma',  value: stats.pending_signature, icon: '⏳' },
    { label: 'Tasa aceptación',
      value: stats.acceptance_rate != null
        ? `${(stats.acceptance_rate * 100).toFixed(1)}%` : '—',
      icon: '📊' },
    { label: 'Usuarios',          value: stats.total_users,      icon: '👤' },
  ]
  return (
    <div className="stats-bar">
      {cards.map(c => (
        <div key={c.label} className="stat-card">
          <span className="stat-icon">{c.icon}</span>
          <span className="stat-value">{c.value ?? '—'}</span>
          <span className="stat-label">{c.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Modal crear usuario ───────────────────────────────────────────────────────
function CreateUserModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ username: '', password: '', role: 'MEDICO' })
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)
  const [error,  setError]  = useState('')

  const submit = async () => {
    setSaving(true)
    setError('')
    try {
      const { data } = await adminAPI.createUser(form)
      setResult(data)
      onCreated?.()
    } catch (e) {
      setError(e.response?.data?.detail || 'Error al crear usuario')
    } finally { setSaving(false) }
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Crear nuevo usuario</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {result ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ color: 'var(--success)', fontWeight: 600 }}>
              ✅ Usuario creado exitosamente
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
              padding: '1rem', fontSize: '0.85rem', lineHeight: 1.8 }}>
              <div><strong>Usuario:</strong> {result.username}</div>
              <div><strong>Rol:</strong> {result.role}</div>
              <div style={{ marginTop: '0.5rem', color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                Guarda estas claves — no se volverán a mostrar:
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
                wordBreak: 'break-all' }}>
                <div><strong>X-Access-Key:</strong> {result.access_key}</div>
                <div><strong>X-Permission-Key:</strong> {result.permission_key}</div>
              </div>
            </div>
            <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label className="form-label">Usuario</label>
              <input
                className="input"
                value={form.username}
                onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                placeholder="nombre_usuario"
              />
            </div>
            <div>
              <label className="form-label">Contraseña</label>
              <input
                className="input"
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                placeholder="Mín. 10 chars, mayúscula, número, símbolo"
              />
            </div>
            <div>
              <label className="form-label">Rol</label>
              <select
                className="input"
                value={form.role}
                onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              >
                <option value="MEDICO">Médico</option>
                <option value="ADMIN">Administrador</option>
                <option value="PACIENTE">Paciente</option>
              </select>
            </div>
            {error && (
              <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{error}</div>
            )}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={saving || !form.username || !form.password}
                onClick={submit}
              >
                {saving ? 'Creando…' : 'Crear usuario'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Regen keys modal ──────────────────────────────────────────────────────────
function RegenModal({ userId, onClose }) {
  const [keys,    setKeys]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    adminAPI.regenKeys(userId)
      .then(r => setKeys(r.data))
      .catch(e => alert(e.response?.data?.detail || 'Error'))
      .finally(() => setLoading(false))
  }, [userId])

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>API Keys regeneradas</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        {loading ? <p>Generando…</p> : keys && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>
              ⚠️ Las keys anteriores quedan inválidas inmediatamente.
            </div>
            <div style={{ background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)',
              padding: '1rem', fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
              wordBreak: 'break-all', lineHeight: 1.8 }}>
              <div><strong>X-Access-Key:</strong> {keys.access_key}</div>
              <div><strong>X-Permission-Key:</strong> {keys.permission_key}</div>
            </div>
            <button className="btn btn-primary" onClick={onClose}>Cerrar</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Sección Usuarios ──────────────────────────────────────────────────────────
function UsersSection() {
  const [users,      setUsers]      = useState([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [regenId,    setRegenId]    = useState(null)
  const [page,       setPage]       = useState(0)
  const LIMIT = 10

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await adminAPI.listUsers({ limit: LIMIT, offset: page * LIMIT })
      setUsers(data.entry || [])
      setTotal(data.total)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { load() }, [load])

  const toggleActive = async (u) => {
    try {
      await adminAPI.updateUser(u.id, { is_active: !u.is_active })
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error') }
  }

  const softDelete = async (u) => {
    if (!confirm(`¿Desactivar y eliminar a ${u.username}?`)) return
    try {
      await adminAPI.deleteUser(u.id)
      load()
    } catch (e) { alert(e.response?.data?.detail || 'Error') }
  }

  const ROLE_BADGE = {
    ADMIN:    { cls: 'badge-warning',  label: 'Admin'   },
    MEDICO:   { cls: 'badge-success',  label: 'Médico'  },
    PACIENTE: { cls: 'badge-info',     label: 'Paciente'},
  }

  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {showCreate && (
        <CreateUserModal
          onClose={() => setShowCreate(false)}
          onCreated={load}
        />
      )}
      {regenId && (
        <RegenModal userId={regenId} onClose={() => { setRegenId(null); load() }} />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h3 style={{ margin: 0 }}>Usuarios del sistema ({total})</h3>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
          + Crear usuario
        </button>
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
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
              {loading ? (
                <tr><td colSpan={5} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Cargando…</td></tr>
              ) : users.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 500 }}>{u.username}</td>
                  <td>
                    <span className={`badge ${ROLE_BADGE[u.role]?.cls || ''}`}>
                      {ROLE_BADGE[u.role]?.label || u.role}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${u.is_active ? 'badge-success' : 'badge-warning'}`}>
                      {u.is_active ? 'Activo' : 'Inactivo'}
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                    {new Date(u.created_at).toLocaleDateString('es-CO')}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.375rem' }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => toggleActive(u)}
                        title={u.is_active ? 'Desactivar' : 'Activar'}
                      >
                        {u.is_active ? '⏸' : '▶'}
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setRegenId(u.id)}
                        title="Regenerar API Keys"
                      >
                        🔑
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--danger)' }}
                        onClick={() => softDelete(u)}
                        title="Eliminar (soft-delete)"
                      >
                        🗑
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Ant.</button>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {page + 1} / {totalPages}
          </span>
          <button className="btn btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Sig. →</button>
        </div>
      )}
    </div>
  )
}

// ── Sección Audit Log ─────────────────────────────────────────────────────────
function AuditSection() {
  const [logs,    setLogs]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ action: '', user_id: '', date_from: '', date_to: '' })
  const [page,    setPage]    = useState(0)
  const LIMIT = 20

  const load = useCallback(async () => {
    setLoading(true)
    const params = { limit: LIMIT, offset: page * LIMIT }
    if (filters.action)    params.action    = filters.action
    if (filters.user_id)   params.user_id   = filters.user_id
    if (filters.date_from) params.date_from = filters.date_from
    if (filters.date_to)   params.date_to   = filters.date_to
    try {
      const { data } = await adminAPI.auditLog(params)
      setLogs(data.entry || [])
      setTotal(data.total)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [page, filters])

  useEffect(() => { load() }, [load])

  const exportLog = async (fmt) => {
    try {
      const { data } = await adminAPI.exportAudit(fmt)
      const url  = URL.createObjectURL(new Blob([data]))
      const link = document.createElement('a')
      link.href = url
      link.download = `audit_log.${fmt}`
      link.click()
      URL.revokeObjectURL(url)
    } catch (e) { alert('Error al exportar') }
  }

  const RESULT_COLOR = { SUCCESS: 'var(--success)', FAILURE: 'var(--danger)', null: 'var(--text-tertiary)' }
  const totalPages = Math.ceil(total / LIMIT)

  const COMMON_ACTIONS = [
    '', 'LOGIN', 'LOGOUT', 'VIEW_PATIENT', 'LIST_PATIENTS',
    'UPLOAD_IMAGE', 'RUN_INFERENCE', 'SIGN_REPORT',
    'CRITICAL_ALERT_TRIGGERED', 'CREATE_USER', 'DELETE_USER',
    'HABEAS_DATA_ACCEPTED', 'CLOSE_PATIENT',
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Filtros */}
      <div className="card">
        <div className="card-header">
          <span className="card-icon">🔍</span>
          <h3>Filtros del Audit Log</h3>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label className="form-label">Acción</label>
            <select
              className="input"
              style={{ width: 200 }}
              value={filters.action}
              onChange={e => { setFilters(f => ({ ...f, action: e.target.value })); setPage(0) }}
            >
              {COMMON_ACTIONS.map(a => (
                <option key={a} value={a}>{a || '— Todas —'}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="form-label">Desde</label>
            <input
              type="date"
              className="input"
              value={filters.date_from}
              onChange={e => { setFilters(f => ({ ...f, date_from: e.target.value })); setPage(0) }}
            />
          </div>
          <div>
            <label className="form-label">Hasta</label>
            <input
              type="date"
              className="input"
              value={filters.date_to}
              onChange={e => { setFilters(f => ({ ...f, date_to: e.target.value })); setPage(0) }}
            />
          </div>
          <button className="btn btn-ghost" onClick={() => { setFilters({ action: '', user_id: '', date_from: '', date_to: '' }); setPage(0) }}>
            Limpiar
          </button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-ghost" onClick={() => exportLog('json')}>⬇ JSON</button>
            <button className="btn btn-ghost" onClick={() => exportLog('csv')}>⬇ CSV</button>
          </div>
        </div>
      </div>

      {/* Tabla */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Acción</th>
                <th>Recurso</th>
                <th>IP</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Cargando…</td></tr>
              ) : logs.length === 0 ? (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: '2rem',
                  color: 'var(--text-tertiary)' }}>Sin registros</td></tr>
              ) : logs.map(log => (
                <tr key={log.id}>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' }}>
                    {new Date(log.ts).toLocaleString('es-CO')}
                  </td>
                  <td style={{ fontSize: '0.8rem' }}>
                    <code>{log.user_id?.slice(0, 8) || '—'}…</code>
                  </td>
                  <td>
                    <span className="badge" style={{ fontSize: '0.7rem' }}>{log.role || '—'}</span>
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem',
                    color: 'var(--cyan)' }}>
                    {log.action}
                  </td>
                  <td style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {log.resource_type || '—'}
                  </td>
                  <td style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)' }}>
                    {log.ip_address || '—'}
                  </td>
                  <td>
                    <span style={{
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      color: RESULT_COLOR[log.result] || 'var(--text-secondary)',
                    }}>
                      {log.result || '—'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button className="btn btn-ghost" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Ant.</button>
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Página {page + 1} de {totalPages} · {total} registros
          </span>
          <button className="btn btn-ghost" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Sig. →</button>
        </div>
      )}
    </div>
  )
}

// ── Main AdminPanel ───────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [stats,      setStats]      = useState(null)
  const [activeTab,  setActiveTab]  = useState('Usuarios')
  const TABS = ['Estadísticas', 'Usuarios', 'Audit Log']

  useEffect(() => {
    adminAPI.stats().then(r => setStats(r.data)).catch(console.error)
  }, [])

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h1>Panel Administrador</h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
          Control total del sistema ClinAI
        </p>
      </div>

      {/* Stats siempre visibles */}
      <StatsBar stats={stats} />

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '0.625rem 1rem',
              background: 'none', border: 'none',
              borderBottom: activeTab === t ? '2px solid var(--cyan)' : '2px solid transparent',
              color: activeTab === t ? 'var(--cyan)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
              letterSpacing: '0.05em', textTransform: 'uppercase',
              cursor: 'pointer', transition: 'all 0.15s',
              marginBottom: '-1px',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === 'Estadísticas' && (
        <div className="grid-2" style={{ display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1.25rem' }}>
          <div className="card">
            <div className="card-header"><span className="card-icon">🤖</span><h3>Modelos de IA</h3></div>
            <div className="data-list">
              {[
                ['Total inferencias', stats?.total_inferences],
                ['Diagnósticos aceptados', stats?.accepted],
                ['Diagnósticos rechazados', stats?.rejected],
                ['Pendientes de firma', stats?.pending_signature],
                ['Tasa de aceptación', stats?.acceptance_rate != null
                  ? `${(stats.acceptance_rate * 100).toFixed(1)}%` : '—'],
              ].map(([l, v]) => (
                <div key={l}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                    letterSpacing: '0.06em' }}>{l}</dt>
                  <dd style={{ fontWeight: 600, fontSize: '1.125rem',
                    color: 'var(--text-primary)' }}>{v ?? '—'}</dd>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-header"><span className="card-icon">👥</span><h3>Usuarios y Pacientes</h3></div>
            <div className="data-list">
              {[
                ['Total usuarios', stats?.total_users],
                ['Total pacientes', stats?.total_patients],
              ].map(([l, v]) => (
                <div key={l}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                    letterSpacing: '0.06em' }}>{l}</dt>
                  <dd style={{ fontWeight: 600, fontSize: '1.125rem' }}>{v ?? '—'}</dd>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'Usuarios'   && <UsersSection />}
      {activeTab === 'Audit Log'  && <AuditSection />}
    </div>
  )
}