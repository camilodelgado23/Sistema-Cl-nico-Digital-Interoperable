import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fhirAPI, authAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'

const LOINC_NAMES = {
  '2339-0':  'Glucosa',
  '55284-4': 'Presión Arterial',
  '39156-5': 'BMI',
  '14749-6': 'Insulina',
  '21612-7': 'Edad',
  '11996-6': 'Embarazos',
  '39106-0': 'Grosor de Piel',
  '33914-3': 'Pedigree Diabetes',
}

const RISK_COLORS = {
  LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#f97316', CRITICAL: '#dc2626',
}

// ── ARCO Modal ────────────────────────────────────────────────────────────────
function ArcoModal({ onClose }) {
  const [type,    setType]    = useState('')
  const [message, setMessage] = useState('')
  const [sent,    setSent]    = useState(false)

  const submit = () => {
    if (!type || message.length < 20) return
    // En producción: POST /fhir/arco-request
    console.log('ARCO request:', { type, message })
    setSent(true)
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Solicitud ARCO</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        {sent ? (
          <div style={{ textAlign: 'center', padding: '1rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>✅</div>
            <p style={{ color: 'var(--success)', fontWeight: 600 }}>
              Solicitud enviada correctamente
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.5rem' }}>
              Recibirá respuesta en un plazo máximo de 15 días hábiles según la Ley 1581/2012.
            </p>
            <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={onClose}>
              Cerrar
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Bajo la Ley 1581/2012, tiene derecho a Acceso, Rectificación,
              Cancelación y Oposición sobre sus datos personales.
            </p>
            <div>
              <label className="form-label">Tipo de solicitud</label>
              <select className="input" value={type} onChange={e => setType(e.target.value)}>
                <option value="">— Seleccione —</option>
                <option value="ACCESO">Acceso — quiero una copia de mis datos</option>
                <option value="RECTIFICACION">Rectificación — hay datos incorrectos</option>
                <option value="CANCELACION">Cancelación — solicito eliminar mis datos</option>
                <option value="OPOSICION">Oposición — me opongo al tratamiento</option>
              </select>
            </div>
            <div>
              <label className="form-label">Descripción</label>
              <textarea
                className="input"
                rows={3}
                placeholder="Describa su solicitud (mín. 20 caracteres)…"
                value={message}
                onChange={e => setMessage(e.target.value)}
                style={{ resize: 'vertical' }}
              />
              <div style={{ fontSize: '0.75rem', color: message.length >= 20
                ? 'var(--success)' : 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                {message.length}/20 mínimo
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button className="btn btn-ghost" onClick={onClose}>Cancelar</button>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!type || message.length < 20}
                onClick={submit}
              >
                Enviar solicitud
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main PatientView ──────────────────────────────────────────────────────────
export default function PatientView() {
  const { user }   = useAuthStore()
  const navigate   = useNavigate()

  const [patient,   setPatient]   = useState(null)
  const [obs,       setObs]       = useState([])
  const [reports,   setReports]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [activeTab, setActiveTab] = useState('Mis datos')
  const [showArco,  setShowArco]  = useState(false)

  useEffect(() => {
    if (!user?.id) return
    const fetchAll = async () => {
      try {
        // Para paciente, el backend filtra y retorna su propio registro
        const listRes = await fhirAPI.listPatients({ limit: 1, offset: 0 })
        const entry   = listRes.data.entry?.[0]
        if (!entry) { setLoading(false); return }

        const [patRes, obsRes, repRes] = await Promise.all([
          fhirAPI.getPatient(entry.id),
          fhirAPI.listObservations(entry.id),
          fhirAPI.listRiskReports(entry.id),
        ])

        setPatient(patRes.data)
        setObs(obsRes.data.entry || [])
        setReports(repRes.data.entry || [])
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    fetchAll()
  }, [user])

  const TABS = ['Mis datos', 'Mis observaciones', 'Mis diagnósticos']

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '60vh', color: 'var(--text-tertiary)' }}>
      Cargando tu información…
    </div>
  )

  if (!patient) return (
    <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-tertiary)' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🏥</div>
      <p>No tienes datos clínicos registrados todavía.</p>
    </div>
  )

  const calcAge = (bd) => bd
    ? Math.floor((Date.now() - new Date(bd)) / (365.25 * 24 * 3600 * 1000))
    : '—'

  const initials = patient.name?.split(' ').map(w => w[0]).slice(0, 2).join('') || '?'

  // Chart data desde observations
  const chartData = obs.map(o => ({
    name: LOINC_NAMES[o.code?.coding?.[0]?.code] || o.code?.coding?.[0]?.code,
    value: o.valueQuantity?.value,
    unit: o.valueQuantity?.unit,
  })).filter(d => d.value != null)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {showArco && <ArcoModal onClose={() => setShowArco(false)} />}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <div style={{
          width: 52, height: 52, borderRadius: 'var(--radius-lg)',
          background: 'var(--cyan-dim)', border: '1px solid var(--border-active)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontSize: '1.375rem',
          fontWeight: 700, color: 'var(--cyan)',
        }}>
          {initials}
        </div>
        <div style={{ flex: 1 }}>
          <h2 style={{ marginBottom: '0.25rem' }}>{patient.name}</h2>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center',
            color: 'var(--text-secondary)', fontSize: '0.875rem', flexWrap: 'wrap' }}>
            <span>{calcAge(patient.birthDate)} años</span>
            <span style={{ color: 'var(--border-soft)' }}>·</span>
            <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>Paciente</span>
          </div>
        </div>
        <button
          className="btn btn-ghost"
          onClick={() => setShowArco(true)}
          style={{ fontSize: '0.8rem' }}
        >
          📋 Solicitar corrección (ARCO)
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem',
        borderBottom: '1px solid var(--border-subtle)' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={{
            padding: '0.625rem 1rem', background: 'none', border: 'none',
            borderBottom: activeTab === t ? '2px solid var(--cyan)' : '2px solid transparent',
            color: activeTab === t ? 'var(--cyan)' : 'var(--text-secondary)',
            fontFamily: 'var(--font-mono)', fontSize: '0.8rem',
            letterSpacing: '0.05em', textTransform: 'uppercase',
            cursor: 'pointer', transition: 'all 0.15s', marginBottom: '-1px',
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* Mis datos */}
      {activeTab === 'Mis datos' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: '1.25rem' }}>
          <div className="card">
            <div className="card-header">
              <span className="card-icon">👤</span>
              <h3>Mi información</h3>
            </div>
            <div className="data-list">
              {[
                ['Nombre', patient.name],
                ['Fecha de nacimiento', patient.birthDate],
                ['Edad', `${calcAge(patient.birthDate)} años`],
                ['Estado', patient.active !== false ? 'Activo' : 'Inactivo'],
              ].map(([l, v]) => (
                <div key={l}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                    fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                    letterSpacing: '0.06em' }}>{l}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-icon">🔒</span>
              <h3>Privacidad y derechos</h3>
            </div>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.7 }}>
              Sus datos están protegidos bajo la <strong>Ley 1581/2012</strong> de protección de datos
              personales. Tiene derecho a:<br /><br />
              • <strong>Acceso</strong> — conocer sus datos almacenados<br />
              • <strong>Rectificación</strong> — corregir datos incorrectos<br />
              • <strong>Cancelación</strong> — solicitar eliminación<br />
              • <strong>Oposición</strong> — oponerse al tratamiento
            </p>
            <button
              className="btn btn-ghost"
              style={{ marginTop: '1rem', fontSize: '0.8rem' }}
              onClick={() => setShowArco(true)}
            >
              Ejercer mis derechos ARCO →
            </button>
          </div>
        </div>
      )}

      {/* Mis observaciones */}
      {activeTab === 'Mis observaciones' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {obs.length === 0 ? (
            <div className="empty-state">Sin observaciones clínicas registradas</div>
          ) : (
            <>
              <div className="card">
                <div className="card-header">
                  <span className="card-icon">📊</span>
                  <h3>Mis valores clínicos</h3>
                </div>
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
                    <XAxis dataKey="name" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
                      angle={-25} textAnchor="end" />
                    <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ background: 'var(--surface-2)',
                        border: '1px solid var(--border-subtle)', borderRadius: 8,
                        color: 'var(--text-primary)' }}
                      formatter={(v, n, props) => [`${v} ${props.payload.unit || ''}`, props.payload.name]}
                    />
                    <Line dataKey="value" stroke="var(--cyan)" strokeWidth={2} dot={{ fill: 'var(--cyan)' }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Parámetro</th>
                        <th>Valor</th>
                        <th>Unidad</th>
                        <th>Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {obs.map(o => (
                        <tr key={o.id}>
                          <td>{LOINC_NAMES[o.code?.coding?.[0]?.code] || o.code?.coding?.[0]?.code}</td>
                          <td style={{ fontWeight: 600, color: 'var(--cyan)' }}>
                            {o.valueQuantity?.value}
                          </td>
                          <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            {o.valueQuantity?.unit}
                          </td>
                          <td style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                            {o.effectiveDateTime
                              ? new Date(o.effectiveDateTime).toLocaleDateString('es-CO') : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Mis diagnósticos */}
      {activeTab === 'Mis diagnósticos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {reports.length === 0 ? (
            <div className="empty-state">Sin diagnósticos registrados aún</div>
          ) : reports.map(rep => {
            const cat   = rep.prediction?.[0]?.qualitativeRisk?.coding?.[0]?.display || 'N/A'
            const prob  = rep.prediction?.[0]?.probabilityDecimal
            const signed = !!rep.signed_at
            return (
              <div key={rep.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between',
                  flexWrap: 'wrap', gap: '0.75rem' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center',
                      marginBottom: '0.5rem' }}>
                      <span className="badge" style={{
                        background: (RISK_COLORS[cat] || '#888') + '22',
                        color: RISK_COLORS[cat] || 'var(--text-secondary)',
                        border: `1px solid ${(RISK_COLORS[cat] || '#888')}55`,
                      }}>
                        {cat}
                      </span>
                      {signed ? (
                        <span style={{ color: 'var(--success)', fontSize: '0.8rem' }}>
                          ✅ Firmado por médico
                        </span>
                      ) : (
                        <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                          ⏳ Pendiente de revisión médica
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      {prob != null
                        ? `Score de riesgo: ${(prob * 100).toFixed(1)}%`
                        : 'Sin score disponible'}
                      {' · '}
                      {rep.method || 'ML'}
                    </div>
                    {signed && rep.doctor_action && (
                      <div style={{ marginTop: '0.5rem', fontSize: '0.85rem',
                        color: rep.doctor_action === 'ACCEPTED' ? 'var(--success)' : 'var(--danger)' }}>
                        Médico: <strong>{rep.doctor_action === 'ACCEPTED' ? 'Aceptó' : 'Rechazó'}</strong>
                        {' el diagnóstico · '}
                        {new Date(rep.signed_at).toLocaleDateString('es-CO')}
                      </div>
                    )}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)',
                    alignSelf: 'flex-start' }}>
                    {rep.occurrenceDateTime
                      ? new Date(rep.occurrenceDateTime).toLocaleString('es-CO') : '—'}
                  </div>
                </div>
              </div>
            )
          })}

          <div style={{ padding: '0.875rem 1rem', background: 'var(--surface-2)',
            borderRadius: 'var(--radius-md)', fontSize: '0.8rem',
            color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            ⚠️ Los diagnósticos son generados por IA de apoyo diagnóstico y deben ser
            validados por un médico. No constituyen diagnóstico clínico definitivo.
          </div>
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.75rem',
        color: 'var(--text-tertiary)', borderTop: '1px solid var(--border-subtle)' }}>
        Protegido bajo Ley 1581/2012 · Datos cifrados AES-256 · Sistema auditado
      </div>
    </div>
  )
}