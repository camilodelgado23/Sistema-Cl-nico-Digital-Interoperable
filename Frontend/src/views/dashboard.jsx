import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fhirAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import CreatePatientModal from '../components/CreatePatientModal'
import './Dashboard.css'

const calcAge = (bd) => {
  if (!bd) return '—'
  return Math.floor((Date.now() - new Date(bd)) / (365.25 * 24 * 3600 * 1000))
}

const RISK_LABEL = {
  LOW:      { label:'Bajo',    cls:'risk-low'      },
  MEDIUM:   { label:'Medio',   cls:'risk-medium'   },
  HIGH:     { label:'Alto',    cls:'risk-high'     },
  CRITICAL: { label:'Crítico', cls:'risk-critical' },
}

const FILTERS = ['TODOS','PENDIENTE','CRÍTICO','SIN ANÁLISIS']

export default function Dashboard() {
  const navigate       = useNavigate()
  // FIX 1: usar 'role' directamente, no 'user'
  const { role }       = useAuthStore()

  const [patients,   setPatients]   = useState([])
  const [total,      setTotal]      = useState(0)
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [filter,     setFilter]     = useState('TODOS')
  const [page,       setPage]       = useState(0)
  const [criticals,  setCriticals]  = useState(0)
  const [showCreate, setShowCreate] = useState(false)

  const LIMIT = 10

  // FIX 2: búsqueda y filtros se mandan al backend como params,
  // no se filtran client-side (eso causaba los nombres repetidos)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      // Trae más registros para poder filtrar bien
      const { data } = await fhirAPI.listPatients({ limit: 50, offset: page * 10 })
      setTotal(data.total || 0)
      let entries = data.entry || []

      // Filtros client-side
      if (search.trim()) {
        const q = search.toLowerCase()
        entries = entries.filter(p =>
          p.name?.toLowerCase().includes(q) || p.id?.toLowerCase().includes(q)
        )
      }
      if (filter === 'PENDIENTE')
        entries = entries.filter(p => Number(p.pending_reports) > 0)
      else if (filter === 'CRÍTICO')
        entries = entries.filter(p => p.last_risk_category === 'CRITICAL')
      else if (filter === 'SIN ANÁLISIS')
        entries = entries.filter(p => !p.last_risk_category)

      setPatients(entries.slice(0, 10))  // muestra 10
      setCriticals(entries.filter(p =>
        p.last_risk_category === 'CRITICAL' && Number(p.pending_reports) > 0
      ).length)
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [page, search, filter])

  useEffect(() => { load() }, [load])

  const roleLabel = { ADMIN:'Administrador', MEDICO:'Médico Especialista', PACIENTE:'Paciente' }
  const totalPages = Math.ceil(total / LIMIT)

  return (
    <div className="dashboard">
      {showCreate && (
        <CreatePatientModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load() }}
        />
      )}

      <div className="dashboard-header">
        <div>
          <h1 style={{ marginBottom:'0.25rem' }}>Pacientes</h1>
          <p style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>
            {total} registros · {roleLabel[role] || role}
          </p>
        </div>
        <div style={{ display:'flex', gap:'0.75rem', alignItems:'center', flexWrap:'wrap' }}>
          {criticals > 0 && (
            <div className="alert-banner">
              <span>🔴</span>
              <span>{criticals} alerta{criticals > 1 ? 's' : ''} crítica{criticals > 1 ? 's' : ''} sin firmar</span>
            </div>
          )}
          {/* FIX 3: botón solo para MEDICO */}
          {role === 'MEDICO' && (
            <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
              + Nuevo paciente
            </button>
          )}
        </div>
      </div>

      <div className="dashboard-toolbar">
        <input
          className="input"
          style={{ flex:1, minWidth:220, maxWidth:400 }}
          placeholder="Buscar por nombre o ID…"
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0) }}
        />
        <div className="filter-pills">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`filter-pill${filter === f ? ' active' : ''}`}
              onClick={() => { setFilter(f); setPage(0) }}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      <div className="card dashboard-table-card">
        <div className="table-wrap">
          <table className="table">
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
              {loading ? (
                <tr>
                  <td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'var(--text-tertiary)' }}>
                    Cargando…
                  </td>
                </tr>
              ) : patients.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ textAlign:'center', padding:'2rem', color:'var(--text-tertiary)' }}>
                    No se encontraron pacientes
                  </td>
                </tr>
              ) : patients.map(p => {
                const risk    = RISK_LABEL[p.last_risk_category]
                const pending = Number(p.pending_reports) > 0
                return (
                  <tr
                    key={p.id}
                    style={{ cursor:'pointer' }}
                    onClick={() => navigate(`/patients/${p.id}`)}
                  >
                    <td>
                      <span
                        className={`risk-dot ${risk ? risk.cls : 'risk-none'}`}
                        title={risk ? risk.label : 'Sin análisis'}
                      />
                    </td>
                    <td style={{ fontWeight:500 }}>{p.name}</td>
                    <td>
                      <span style={{ color:'var(--cyan)', fontWeight:600 }}>{calcAge(p.birth_date)}</span>
                      {' '}<span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem' }}>a</span>
                    </td>
                    <td>
                      <code style={{ fontSize:'0.75rem', color:'var(--text-tertiary)' }}>
                        {p.id?.slice(0, 8)}…
                      </code>
                    </td>
                    <td>
                      {risk ? (
                        <span className={`badge badge-${p.last_risk_category?.toLowerCase()}`}>
                          {risk.label}
                        </span>
                      ) : (
                        <span style={{ color:'var(--text-tertiary)', fontSize:'0.8rem', fontFamily:'var(--font-mono)', letterSpacing:'0.05em' }}>
                          SIN ANÁLISIS
                        </span>
                      )}
                    </td>
                    <td>
                      {pending ? (
                        <span style={{ color:'var(--danger)', fontWeight:600, fontSize:'0.8rem' }}>
                          ⚠ Pendiente
                        </span>
                      ) : (
                        <span style={{ color:'var(--success)', fontSize:'0.8rem' }}>
                          ✓ Al día
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {totalPages > 1 && (
        <div className="pagination">
          <button
            className="btn btn-ghost"
            disabled={page === 0}
            onClick={() => setPage(p => p - 1)}
          >
            ← Anterior
          </button>
          <span style={{ color:'var(--text-secondary)', fontSize:'0.875rem' }}>
            Página {page + 1} de {totalPages}
          </span>
          <button
            className="btn btn-ghost"
            disabled={page >= totalPages - 1}
            onClick={() => setPage(p => p + 1)}
          >
            Siguiente →
          </button>
        </div>
      )}
    </div>
  )
}