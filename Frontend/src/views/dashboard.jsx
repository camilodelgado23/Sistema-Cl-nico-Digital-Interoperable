import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fhirAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import Layout from '../components/Layout'
import toast from 'react-hot-toast'
import './Dashboard.css'

const RISK_LABELS = { LOW: 'Bajo', MEDIUM: 'Medio', HIGH: 'Alto', CRITICAL: 'Crítico' }

function RiskDot({ category }) {
  const cls = category?.toLowerCase() || 'none'
  return <span className={`risk-dot risk-${cls}`} title={RISK_LABELS[category] || 'Sin análisis'} />
}

function StatusBadge({ pending, category }) {
  if (pending > 0)  return <span className="badge badge-pending">⏳ Pendiente firma</span>
  if (category)     return <span className={`badge badge-${category?.toLowerCase()}`}>{RISK_LABELS[category]}</span>
  return <span className="badge" style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}>Sin análisis</span>
}

function calcAge(birthDate) {
  if (!birthDate) return '—'
  const diff = Date.now() - new Date(birthDate).getTime()
  return Math.floor(diff / (1000 * 60 * 60 * 24 * 365.25))
}

export default function Dashboard() {
  const [patients, setPatients] = useState([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(0)
  const [loading, setLoading]   = useState(false)
  const [search, setSearch]     = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const { role } = useAuthStore()
  const navigate  = useNavigate()
  const LIMIT = 15

  const fetchPatients = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await fhirAPI.listPatients({ limit: LIMIT, offset: page * LIMIT })
      setPatients(data.entry || [])
      setTotal(data.total || 0)
    } catch { toast.error('Error cargando pacientes') }
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { fetchPatients() }, [fetchPatients])

  const filtered = patients.filter(p => {
    const matchSearch = !search ||
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.id?.includes(search)
    const matchStatus = filterStatus === 'all' ||
      (filterStatus === 'pending'  && p.pending_reports > 0) ||
      (filterStatus === 'critical' && p.last_risk_category === 'CRITICAL') ||
      (filterStatus === 'none'     && !p.last_risk_category)
    return matchSearch && matchStatus
  })

  const totalPages = Math.ceil(total / LIMIT)
  const criticalCount = patients.filter(p => p.pending_reports > 0).length

  return (
    <Layout>
      <div className="dashboard page-enter">
        {/* Header */}
        <div className="dashboard-header">
          <div>
            <h2>Pacientes</h2>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)', marginTop: 2 }}>
              {total} registros · {role}
            </p>
          </div>
          {criticalCount > 0 && (
            <div className="alert-banner">
              <span className="spinner" style={{ width: 12, height: 12, borderTopColor: 'var(--danger)' }} />
              {criticalCount} RiskReport{criticalCount > 1 ? 's' : ''} pendiente{criticalCount > 1 ? 's' : ''} de firma
            </div>
          )}
        </div>

        {/* Toolbar */}
        <div className="dashboard-toolbar">
          <input
            className="input"
            placeholder="Buscar por nombre o ID..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ maxWidth: 320 }}
            aria-label="Buscar paciente"
          />
          <div className="filter-pills" role="group" aria-label="Filtrar por estado">
            {[['all','Todos'],['pending','Pendiente'],['critical','Crítico'],['none','Sin análisis']].map(([val, lbl]) => (
              <button
                key={val}
                className={`filter-pill ${filterStatus === val ? 'active' : ''}`}
                onClick={() => setFilterStatus(val)}
              >{lbl}</button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="card dashboard-table-card">
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
              <span className="spinner" />
            </div>
          ) : filtered.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
              No se encontraron pacientes
            </div>
          ) : (
            <div className="table-wrap">
              <table aria-label="Lista de pacientes">
                <thead>
                  <tr>
                    <th>Estado</th>
                    <th>Nombre</th>
                    <th>Edad</th>
                    <th>ID</th>
                    <th>Riesgo</th>
                    <th>Firma</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(p => (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/patients/${p.id}`)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={e => e.key === 'Enter' && navigate(`/patients/${p.id}`)}
                      aria-label={`Ver ficha de ${p.name}`}
                    >
                      <td>
                        <RiskDot category={p.last_risk_category} />
                      </td>
                      <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                        {p.name || '—'}
                      </td>
                      <td>
                        <span className="mono">{calcAge(p.birth_date)} a</span>
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {p.id?.slice(0, 8)}…
                        </span>
                      </td>
                      <td>
                        <StatusBadge pending={p.pending_reports} category={p.last_risk_category} />
                      </td>
                      <td>
                        {p.pending_reports > 0
                          ? <span style={{ color: 'var(--danger)', fontSize: '0.8125rem' }}>● Sin firmar</span>
                          : <span style={{ color: 'var(--success)', fontSize: '0.8125rem' }}>✓ Al día</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination" role="navigation" aria-label="Paginación">
            <button className="btn btn-ghost" onClick={() => setPage(p => Math.max(0, p-1))}
              disabled={page === 0}>← Anterior</button>
            <span className="mono" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
              {page + 1} / {totalPages}
            </span>
            <button className="btn btn-ghost" onClick={() => setPage(p => Math.min(totalPages-1, p+1))}
              disabled={page >= totalPages - 1}>Siguiente →</button>
          </div>
        )}
      </div>
    </Layout>
  )
}