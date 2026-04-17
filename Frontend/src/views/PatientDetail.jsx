import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell
} from 'recharts'
import { fhirAPI, inferAPI } from '../services/api'
import { useAuthStore } from '../store/auth'
import ImageViewer from '../components/ImageViewer'
import './PatientDetail.css'

// ── Helpers ──────────────────────────────────────────────────────────────────
const calcAge = (bd) => {
  if (!bd) return '—'
  return Math.floor((Date.now() - new Date(bd)) / (365.25 * 24 * 3600 * 1000))
}

const LOINC_NAMES = {
  '2339-0':  'Glucosa',
  '55284-4': 'Presión Arterial',
  '39156-5': 'BMI',
  '14749-6': 'Insulina',
  '21612-7': 'Edad',
  '11996-6': 'Embarazos',
  '39106-0': 'Grosor Piel',
  '33914-3': 'Pedigree Diabetes',
}

const OUTLIER_RULES = {
  '2339-0':  { max: 600, msg: 'Glucosa >600 mg/dL — valor crítico' },
  '55284-4': { max: 200, msg: 'Presión sistólica >200 mmHg' },
  '39156-5': { max: 60,  msg: 'BMI >60 — obesidad mórbida severa' },
}

const RISK_COLORS = {
  LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#f97316', CRITICAL: '#dc2626',
}

const TABS = ['Datos', 'Observaciones', 'Imágenes', 'Análisis IA', 'Reportes']

// ── Modales inline ────────────────────────────────────────────────────────────
function CriticalModal({ report, onClose }) {
  const [action,    setAction]    = useState(null)
  const [notes,     setNotes]     = useState('')
  const [rejection, setRejection] = useState('')
  const [saving,    setSaving]    = useState(false)
  const [done,      setDone]      = useState(false)

  const valid = action && notes.length >= 30 &&
    (action !== 'REJECTED' || rejection.length >= 20)

  const submit = async () => {
    if (!valid) return
    setSaving(true)
    try {
      await fhirAPI.signReport(report.id, {
        action,
        doctor_notes: notes,
        rejection_reason: action === 'REJECTED' ? rejection : undefined,
      })
      setDone(true)
      setTimeout(onClose, 1200)
    } catch (e) {
      alert('Error al firmar: ' + (e.response?.data?.detail || e.message))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" style={{ zIndex: 1000 }}>
      <div className="modal critical-modal">
        <div className="critical-modal-header">
          <span className="critical-icon">🚨</span>
          <h2>ALERTA CRÍTICA — Acción Requerida</h2>
        </div>
        <p style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          Este diagnóstico tiene categoría <strong style={{ color: 'var(--danger)' }}>CRÍTICA</strong>.
          Debe gestionarlo antes de continuar.
        </p>
        <div className="risk-score-display" style={{ marginBottom: '1.5rem' }}>
          <span className="score-number" style={{ color: 'var(--danger)' }}>
            {(report.prediction?.[0]?.probabilityDecimal * 100).toFixed(1)}%
          </span>
          <span className="score-label">Probabilidad de riesgo</span>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem' }}>
          <button
            className={`btn ${action === 'ACCEPTED' ? 'btn-success' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setAction('ACCEPTED')}
          >
            ✅ Aceptar diagnóstico
          </button>
          <button
            className={`btn ${action === 'REJECTED' ? 'btn-danger' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={() => setAction('REJECTED')}
          >
            ❌ Rechazar diagnóstico
          </button>
        </div>

        <textarea
          className="input"
          rows={3}
          placeholder="Observaciones clínicas (obligatorio, mín. 30 caracteres)…"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          style={{ width: '100%', resize: 'vertical', marginBottom: '0.75rem' }}
        />
        <div style={{ fontSize: '0.75rem', color: notes.length >= 30 ? 'var(--success)' : 'var(--text-tertiary)',
          marginBottom: '0.75rem' }}>
          {notes.length}/30 caracteres mínimos
        </div>

        {action === 'REJECTED' && (
          <>
            <textarea
              className="input"
              rows={2}
              placeholder="Justificación del rechazo (mín. 20 caracteres)…"
              value={rejection}
              onChange={e => setRejection(e.target.value)}
              style={{ width: '100%', resize: 'vertical', marginBottom: '0.5rem' }}
            />
            <div style={{ fontSize: '0.75rem', color: rejection.length >= 20 ? 'var(--success)' : 'var(--text-tertiary)',
              marginBottom: '0.75rem' }}>
              {rejection.length}/20 caracteres mínimos
            </div>
          </>
        )}

        {done ? (
          <div style={{ textAlign: 'center', color: 'var(--success)', fontWeight: 700 }}>
            ✅ Firmado correctamente
          </div>
        ) : (
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            disabled={!valid || saving}
            onClick={submit}
          >
            {saving ? 'Guardando…' : '✍ Confirmar firma'}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Tab: Datos ────────────────────────────────────────────────────────────────
function TabDatos({ patient }) {
  const fields = [
    { label: 'Nombre completo',  value: patient.name },
    { label: 'Fecha de nac.',    value: patient.birthDate },
    { label: 'Edad',             value: calcAge(patient.birthDate) + ' años' },
    { label: 'ID Paciente',      value: patient.id },
    { label: 'Doc. Identidad',   value: patient.identification_doc || '***' },
    { label: 'Estado',           value: patient.active !== false ? 'Activo' : 'Inactivo' },
    { label: 'Creado',           value: patient.meta?.createdAt
      ? new Date(patient.meta.createdAt).toLocaleDateString('es-CO') : '—' },
  ]

  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-header">
          <span className="card-icon">👤</span>
          <h3>Datos FHIR Patient</h3>
        </div>
        <div className="data-list">
          {fields.map(f => (
            <div key={f.label}>
              <dt style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)', textTransform: 'uppercase',
                letterSpacing: '0.06em' }}>
                {f.label}
              </dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <span className="card-icon">🏥</span>
          <h3>Información clínica</h3>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.6 }}>
          Sistema ClinAI · Apoyo diagnóstico para diabetes y retinopatía diabética.<br /><br />
          <strong>Disclaimer IA:</strong> Los resultados de análisis son generados por modelos
          de inteligencia artificial de apoyo diagnóstico. No reemplazan el criterio médico
          profesional. Sujeto a revisión clínica obligatoria.
        </p>
        <div style={{ marginTop: '1rem', padding: '0.75rem', background: 'var(--surface-2)',
          borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
          color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
          🔒 Datos protegidos · Ley 1581/2012 · Cifrado AES-256 en reposo
        </div>
      </div>
    </div>
  )
}

// ── Tab: Observaciones ────────────────────────────────────────────────────────
function TabObservaciones({ patientId }) {
  const [obs,     setObs]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fhirAPI.listObservations(patientId).then(r => {
      setObs(r.data.entry || [])
    }).catch(console.error).finally(() => setLoading(false))
  }, [patientId])

  if (loading) return <div className="loading-state">Cargando observaciones…</div>
  if (!obs.length) return <div className="empty-state">Sin observaciones LOINC registradas</div>

  const chartData = obs.map(o => ({
    name: LOINC_NAMES[o.code?.coding?.[0]?.code] || o.code?.coding?.[0]?.code,
    value: o.valueQuantity?.value,
    unit: o.valueQuantity?.unit,
    loinc: o.code?.coding?.[0]?.code,
  })).filter(d => d.value != null)

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      {/* Gráfica */}
      <div className="card">
        <div className="card-header">
          <span className="card-icon">📊</span>
          <h3>Valores clínicos — Gráfica</h3>
        </div>
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 48 }}>
            <XAxis
              dataKey="name"
              tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }}
              angle={-25}
              textAnchor="end"
            />
            <YAxis tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
            <Tooltip
              contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
                borderRadius: 8, color: 'var(--text-primary)' }}
              formatter={(v, n, props) => [`${v} ${props.payload.unit || ''}`, props.payload.name]}
            />
            <Bar dataKey="value" radius={[4, 4, 0, 0]}>
              {chartData.map((entry, i) => {
                const rule = OUTLIER_RULES[entry.loinc]
                const isOutlier = rule && entry.value > rule.max
                return <Cell key={i} fill={isOutlier ? 'var(--danger)' : 'var(--cyan)'} />
              })}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabla detallada */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="card-header" style={{ padding: '1rem 1.25rem 0' }}>
          <span className="card-icon">🔬</span>
          <h3>Detalle de Observations LOINC</h3>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Código LOINC</th>
                <th>Parámetro</th>
                <th>Valor</th>
                <th>Unidad</th>
                <th>Estado</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {obs.map(o => {
                const loinc    = o.code?.coding?.[0]?.code
                const name     = LOINC_NAMES[loinc] || loinc
                const val      = o.valueQuantity?.value
                const unit     = o.valueQuantity?.unit
                const rule     = OUTLIER_RULES[loinc]
                const isOutlier = rule && val > rule.max

                return (
                  <tr key={o.id}>
                    <td>
                      <code style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>
                        {loinc}
                      </code>
                    </td>
                    <td>{name}</td>
                    <td>
                      <span style={{ color: isOutlier ? 'var(--danger)' : 'var(--text-primary)',
                        fontWeight: isOutlier ? 700 : 400 }}>
                        {val}
                        {isOutlier && (
                          <span
                            title={rule.msg}
                            style={{ marginLeft: 6, cursor: 'help' }}
                          >⚠️</span>
                        )}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{unit}</td>
                    <td>
                      <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>
                        {o.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>
                      {o.effectiveDateTime
                        ? new Date(o.effectiveDateTime).toLocaleDateString('es-CO')
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// ── Tab: Imágenes ─────────────────────────────────────────────────────────────
function TabImagenes({ patientId, role }) {
  const [media,      setMedia]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [uploading,  setUploading]  = useState(false)
  const [selected,   setSelected]   = useState(null)
  const [modality,   setModality]   = useState('FUNDUS')
  const fileRef = useRef()

  const loadMedia = useCallback(async () => {
    try {
      const r = await fhirAPI.listMedia(patientId)
      setMedia(r.data.entry || [])
      if (r.data.entry?.length) setSelected(r.data.entry[0])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [patientId])

  useEffect(() => { loadMedia() }, [loadMedia])

  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      await fhirAPI.uploadImage(patientId, file, modality)
      await loadMedia()
    } catch (err) {
      alert('Error al subir imagen: ' + (err.response?.data?.detail || err.message))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (loading) return <div className="loading-state">Cargando imágenes…</div>

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Upload (solo médico) */}
      {role === 'MEDICO' && (
        <div className="card">
          <div className="card-header">
            <span className="card-icon">📤</span>
            <h3>Subir imagen</h3>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ width: 160 }}
              value={modality}
              onChange={e => setModality(e.target.value)}
            >
              <option value="FUNDUS">Fondo de ojo</option>
              <option value="XRAY">Radiografía</option>
              <option value="DERM">Dermatología</option>
              <option value="OTHER">Otra</option>
            </select>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              style={{ display: 'none' }}
              onChange={handleUpload}
            />
            <button
              className="btn btn-primary"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
            >
              {uploading ? 'Subiendo…' : '📁 Seleccionar imagen (JPG/PNG)'}
            </button>
          </div>
        </div>
      )}

      {media.length === 0 ? (
        <div className="empty-state">Sin imágenes registradas para este paciente</div>
      ) : (
        <div className="grid-2">
          {/* Visor principal */}
          <div className="card" style={{ minHeight: 340 }}>
            <div className="card-header">
              <span className="card-icon">🖼</span>
              <h3>Visor — {selected?.modality || 'Imagen'}</h3>
            </div>
            {selected && (
              <ImageViewer
                src={`${import.meta.env.VITE_API_URL || '/api'}${selected.content?.url}`}
                alt={`Imagen ${selected.modality}`}
              />
            )}
          </div>

          {/* Lista de imágenes */}
          <div className="card">
            <div className="card-header">
              <span className="card-icon">📂</span>
              <h3>Imágenes ({media.length})</h3>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {media.map(m => (
                <div
                  key={m.id}
                  onClick={() => setSelected(m)}
                  style={{
                    padding: '0.625rem 0.875rem',
                    borderRadius: 'var(--radius-sm)',
                    border: `1px solid ${selected?.id === m.id ? 'var(--cyan)' : 'var(--border-subtle)'}`,
                    background: selected?.id === m.id ? 'var(--cyan-dim)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontSize: '0.875rem' }}>
                    {m.modality} — {new Date(m.createdDateTime).toLocaleDateString('es-CO')}
                  </span>
                  {selected?.id === m.id && (
                    <span style={{ color: 'var(--cyan)', fontSize: '0.75rem' }}>● activa</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Tab: Análisis IA ──────────────────────────────────────────────────────────
function TabAnalisis({ patientId, onCritical }) {
  const [modelType, setModelType] = useState('ML')
  const [taskId,    setTaskId]    = useState(null)
  const [status,    setStatus]    = useState(null)   // PENDING|RUNNING|DONE|ERROR
  const [result,    setResult]    = useState(null)
  const [running,   setRunning]   = useState(false)
  const pollRef = useRef(null)

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
  }

  const startInference = async () => {
    setRunning(true)
    setResult(null)
    setStatus('PENDING')
    setTaskId(null)
    stopPolling()
    try {
      const { data } = await inferAPI.request(patientId, modelType)
      setTaskId(data.task_id)
      setStatus(data.status)

      pollRef.current = setInterval(async () => {
        try {
          const s = await inferAPI.status(data.task_id)
          setStatus(s.data.status)
          if (s.data.status === 'DONE') {
            stopPolling()
            setRunning(false)
            setResult(s.data.result)
            if (s.data.result?.is_critical) onCritical(s.data.result)
          } else if (s.data.status === 'ERROR') {
            stopPolling()
            setRunning(false)
          }
        } catch { stopPolling(); setRunning(false) }
      }, 3000)
    } catch (e) {
      alert('Error al iniciar inferencia: ' + (e.response?.data?.detail || e.message))
      setRunning(false)
      setStatus(null)
    }
  }

  useEffect(() => () => stopPolling(), [])

  const statusColor = { PENDING: 'var(--text-tertiary)', RUNNING: 'var(--cyan)',
    DONE: 'var(--success)', ERROR: 'var(--danger)' }

  const shap = result?.shap_values
  const shapData = shap
    ? Object.entries(shap)
        .map(([k, v]) => ({ name: LOINC_NAMES[k] || k, value: Math.abs(v), raw: v }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8)
    : []

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Selector y botón */}
      <div className="card">
        <div className="card-header">
          <span className="card-icon">🤖</span>
          <h3>Configurar análisis</h3>
        </div>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {['ML', 'DL', 'MULTIMODAL'].map(t => (
              <button
                key={t}
                className={`filter-pill${modelType === t ? ' active' : ''}`}
                onClick={() => setModelType(t)}
                disabled={running}
              >
                {t === 'ML' ? '📊 Tabular ML' : t === 'DL' ? '🧠 Imagen DL' : '🔮 Multimodal'}
              </button>
            ))}
          </div>
          <button
            className="btn btn-primary"
            onClick={startInference}
            disabled={running}
            style={{ marginLeft: 'auto' }}
          >
            {running ? '⏳ Analizando…' : '▶ Ejecutar análisis'}
          </button>
        </div>

        {/* Estado polling */}
        {status && (
          <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {running && (
              <div className="spinner" style={{
                width: 16, height: 16,
                border: '2px solid var(--border-subtle)',
                borderTopColor: 'var(--cyan)',
                borderRadius: '50%',
                animation: 'spin 0.8s linear infinite',
              }} />
            )}
            <span style={{ color: statusColor[status], fontSize: '0.875rem', fontWeight: 600 }}>
              {status === 'PENDING' ? '⏳ En cola…'
               : status === 'RUNNING' ? '🔄 Ejecutando modelo…'
               : status === 'DONE' ? '✅ Análisis completado'
               : '❌ Error en la inferencia'}
            </span>
            {taskId && (
              <code style={{ fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
                {taskId.slice(0, 12)}…
              </code>
            )}
          </div>
        )}
      </div>

      {/* Resultado */}
      {result && (
        <>
          <div className="card" style={{
            border: result.is_critical ? '1px solid var(--danger)' : '1px solid var(--border-subtle)',
            background: result.is_critical ? 'var(--critical-dim)' : undefined,
          }}>
            <div className="card-header">
              <span className="card-icon">📈</span>
              <h3>Resultado del análisis</h3>
            </div>

            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '2.5rem', fontWeight: 800,
                  fontFamily: 'var(--font-display)',
                  color: RISK_COLORS[result.risk_category] || 'var(--text-primary)',
                }}>
                  {result.risk_score != null
                    ? `${(result.risk_score * 100).toFixed(1)}%`
                    : result.prediction?.[0]?.probabilityDecimal != null
                      ? `${(result.prediction[0].probabilityDecimal * 100).toFixed(1)}%`
                      : '—'}
                </div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>Score de riesgo</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  fontSize: '1.5rem', fontWeight: 700,
                  color: RISK_COLORS[result.risk_category],
                }}>
                  {result.risk_category || result.prediction?.[0]?.qualitativeRisk?.coding?.[0]?.display}
                </div>
                <div style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>Categoría</div>
              </div>
              {result.model_type && (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--cyan)' }}>
                    {result.model_type}
                  </div>
                  <div style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>Modelo</div>
                </div>
              )}
            </div>

            <div style={{ padding: '0.625rem 0.875rem', background: 'var(--surface-2)',
              borderRadius: 'var(--radius-sm)', fontSize: '0.8rem',
              color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              ⚠️ <strong>Disclaimer IA:</strong> Resultado generado por IA de apoyo diagnóstico.
              No reemplaza criterio médico. Sujeto a revisión clínica obligatoria.
            </div>
          </div>

          {/* SHAP */}
          {shapData.length > 0 && (
            <div className="card">
              <div className="card-header">
                <span className="card-icon">🔍</span>
                <h3>Explicabilidad SHAP — Importancia de variables</h3>
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={shapData}
                  layout="vertical"
                  margin={{ top: 4, right: 24, left: 80, bottom: 4 }}
                >
                  <XAxis type="number" tick={{ fill: 'var(--text-tertiary)', fontSize: 11 }} />
                  <YAxis dataKey="name" type="category" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-2)', border: '1px solid var(--border-subtle)',
                      color: 'var(--text-primary)', borderRadius: 8 }}
                    formatter={v => [v.toFixed(4), 'SHAP']}
                  />
                  <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                    {shapData.map((entry, i) => (
                      <Cell key={i} fill={entry.raw >= 0 ? 'var(--cyan)' : 'var(--danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem' }}>
                Barras azules = contribución positiva al riesgo · Rojas = contribución negativa
              </p>
            </div>
          )}

          {/* Grad-CAM */}
          {result.gradcam_url && (
            <div className="card">
              <div className="card-header">
                <span className="card-icon">🧠</span>
                <h3>Grad-CAM — Zonas de atención del modelo</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                    Imagen original
                  </p>
                  <ImageViewer src={result.original_url || ''} alt="Original" />
                </div>
                <div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginBottom: '0.5rem' }}>
                    Grad-CAM superpuesto
                  </p>
                  <ImageViewer src={result.gradcam_url} alt="Grad-CAM" />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Tab: Reportes ─────────────────────────────────────────────────────────────
function TabReportes({ patientId, role, onRefreshPending }) {
  const [reports,  setReports]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [signing,  setSigning]  = useState(null)   // report being signed
  const [notes,    setNotes]    = useState('')
  const [action,   setAction]   = useState(null)
  const [rejection,setRejection]= useState('')
  const [saving,   setSaving]   = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fhirAPI.listRiskReports(patientId)
      setReports(r.data.entry || [])
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [patientId])

  useEffect(() => { load() }, [load])

  const openSign = (rep) => {
    setSigning(rep)
    setNotes('')
    setAction(null)
    setRejection('')
  }

  const submitSign = async () => {
    if (!action || notes.length < 30) return
    if (action === 'REJECTED' && rejection.length < 20) return
    setSaving(true)
    try {
      await fhirAPI.signReport(signing.id, {
        action,
        doctor_notes: notes,
        rejection_reason: action === 'REJECTED' ? rejection : undefined,
      })
      setSigning(null)
      await load()
      onRefreshPending?.()
    } catch (e) {
      alert('Error al firmar: ' + (e.response?.data?.detail || e.message))
    } finally { setSaving(false) }
  }

  if (loading) return <div className="loading-state">Cargando reportes…</div>
  if (!reports.length) return <div className="empty-state">Sin RiskReports generados aún</div>

  return (
    <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {reports.map(rep => {
        const cat = rep.prediction?.[0]?.qualitativeRisk?.coding?.[0]?.display
          || rep.risk_category || 'UNKNOWN'
        const prob = rep.prediction?.[0]?.probabilityDecimal
        const signed = !!rep.signed_at
        const isCritical = rep.is_critical

        return (
          <div key={rep.id} className="card" style={{
            border: isCritical && !signed ? '1px solid var(--danger)' : '1px solid var(--border-subtle)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between',
              alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
                  <span className="badge" style={{
                    background: RISK_COLORS[cat] + '22',
                    color: RISK_COLORS[cat],
                    border: `1px solid ${RISK_COLORS[cat]}55`,
                  }}>
                    {cat}
                  </span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem',
                    fontFamily: 'var(--font-mono)' }}>
                    {rep.method || 'ML'}
                  </span>
                  {isCritical && <span style={{ color: 'var(--danger)', fontSize: '0.8rem' }}>🚨 CRÍTICO</span>}
                </div>
                <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                  Score: <strong style={{ color: 'var(--text-primary)' }}>
                    {prob != null ? `${(prob * 100).toFixed(1)}%` : '—'}
                  </strong>
                  {' · '}
                  {new Date(rep.occurrenceDateTime).toLocaleString('es-CO')}
                </div>
                {signed && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--success)', marginTop: '0.25rem' }}>
                    ✅ Firmado · {rep.doctor_action}
                    {' · '}{new Date(rep.signed_at).toLocaleString('es-CO')}
                  </div>
                )}
              </div>

              {!signed && role === 'MEDICO' && (
                <button className="btn btn-primary btn-sm" onClick={() => openSign(rep)}>
                  ✍ Firmar reporte
                </button>
              )}
            </div>

            {/* Form de firma inline */}
            {signing?.id === rep.id && (
              <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-subtle)',
                paddingTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className={`btn ${action === 'ACCEPTED' ? 'btn-success' : 'btn-ghost'} btn-sm`}
                    style={{ flex: 1 }}
                    onClick={() => setAction('ACCEPTED')}
                  >
                    ✅ Aceptar
                  </button>
                  <button
                    className={`btn ${action === 'REJECTED' ? 'btn-danger' : 'btn-ghost'} btn-sm`}
                    style={{ flex: 1 }}
                    onClick={() => setAction('REJECTED')}
                  >
                    ❌ Rechazar
                  </button>
                </div>
                <textarea
                  className="input"
                  rows={2}
                  placeholder={`Observaciones clínicas (mín. 30 chars)… ${notes.length}/30`}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
                {action === 'REJECTED' && (
                  <textarea
                    className="input"
                    rows={2}
                    placeholder={`Justificación del rechazo (mín. 20 chars)… ${rejection.length}/20`}
                    value={rejection}
                    onChange={e => setRejection(e.target.value)}
                    style={{ resize: 'vertical' }}
                  />
                )}
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={saving || !action || notes.length < 30 ||
                      (action === 'REJECTED' && rejection.length < 20)}
                    onClick={submitSign}
                  >
                    {saving ? 'Guardando…' : '✍ Confirmar firma'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={() => setSigning(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function PatientDetail() {
  const { id }       = useParams()
  const navigate     = useNavigate()
  const { user }     = useAuthStore()

  const [patient,    setPatient]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [activeTab,  setActiveTab]  = useState('Datos')
  const [pending,    setPending]    = useState(0)
  const [closing,    setClosing]    = useState(false)
  const [criticalReport, setCriticalReport] = useState(null)

  const loadPatient = useCallback(async () => {
    try {
      const { data } = await fhirAPI.getPatient(id)
      setPatient(data)
      setPending(data.pending_reports ?? 0)
    } catch (e) {
      if (e.response?.status === 404) navigate('/dashboard')
    } finally { setLoading(false) }
  }, [id, navigate])

  useEffect(() => { loadPatient() }, [loadPatient])

  const handleClose = async () => {
    setClosing(true)
    try {
      await fhirAPI.canClose(id)
      navigate('/dashboard')
    } catch (e) {
      if (e.response?.status === 409) {
        const detail = e.response.data?.detail
        alert(`⛔ No puede cerrar el paciente.\n${detail?.message || 'Hay reportes pendientes de firma.'}`)
        setActiveTab('Reportes')
      }
    } finally { setClosing(false) }
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
      height: '60vh', color: 'var(--text-tertiary)' }}>
      Cargando ficha clínica…
    </div>
  )

  if (!patient) return null

  const initials = patient.name?.split(' ').map(w => w[0]).slice(0, 2).join('') || '?'

  return (
    <div className="patient-detail">
      {/* Modal alerta crítica */}
      {criticalReport && (
        <CriticalModal
          report={criticalReport}
          onClose={() => { setCriticalReport(null); loadPatient() }}
        />
      )}

      {/* Banner pendiente */}
      {pending > 0 && (
        <div className="pending-banner">
          <span>⚠️</span>
          <span>
            Hay {pending} RiskReport{pending > 1 ? 's' : ''} pendiente{pending > 1 ? 's' : ''} de firma.
            Debe firmar antes de cerrar el paciente.
          </span>
          <button
            className="btn btn-sm"
            style={{ marginLeft: 'auto', background: 'var(--danger)',
              color: '#fff', border: 'none' }}
            onClick={() => setActiveTab('Reportes')}
          >
            Ir a Reportes →
          </button>
        </div>
      )}

      {/* Header */}
      <div className="patient-header">
        <div className="patient-avatar">{initials}</div>
        <div className="patient-info">
          <h2>{patient.name}</h2>
          <div className="patient-meta">
            <span>{calcAge(patient.birthDate)} años</span>
            <span style={{ color: 'var(--border-soft)' }}>·</span>
            <code style={{ fontSize: '0.75rem' }}>{patient.id?.slice(0, 16)}…</code>
            <span style={{ color: 'var(--border-soft)' }}>·</span>
            <span className={`badge ${patient.active !== false ? 'badge-success' : 'badge-warning'}`}>
              {patient.active !== false ? 'Activo' : 'Inactivo'}
            </span>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            className="btn btn-ghost"
            onClick={() => navigate('/dashboard')}
          >
            ← Volver
          </button>
          {user?.role === 'MEDICO' && (
            <button
              className="btn btn-primary"
              disabled={closing || pending > 0}
              title={pending > 0 ? 'Debe firmar todos los reportes primero' : ''}
              onClick={handleClose}
              style={{ opacity: pending > 0 ? 0.5 : 1 }}
            >
              {closing ? 'Verificando…' : '✓ Cerrar paciente'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '1px solid var(--border-subtle)',
        paddingBottom: '0' }}>
        {TABS.filter(t => {
          // Paciente solo ve Datos, Observaciones y Reportes
          if (user?.role === 'PACIENTE') return ['Datos', 'Observaciones', 'Reportes'].includes(t)
          return true
        }).map(t => (
          <button
            key={t}
            onClick={() => setActiveTab(t)}
            style={{
              padding: '0.625rem 1rem',
              background: 'none',
              border: 'none',
              borderBottom: activeTab === t
                ? '2px solid var(--cyan)'
                : '2px solid transparent',
              color: activeTab === t ? 'var(--cyan)' : 'var(--text-secondary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.8rem',
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              transition: 'all 0.15s',
              marginBottom: '-1px',
            }}
          >
            {t}
            {t === 'Reportes' && pending > 0 && (
              <span style={{ marginLeft: 6, background: 'var(--danger)',
                color: '#fff', borderRadius: 10, padding: '1px 6px',
                fontSize: '0.65rem', fontWeight: 700 }}>
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'Datos'         && <TabDatos patient={patient} />}
      {activeTab === 'Observaciones' && <TabObservaciones patientId={id} />}
      {activeTab === 'Imágenes'      && <TabImagenes patientId={id} role={user?.role} />}
      {activeTab === 'Análisis IA'   && (
        <TabAnalisis
          patientId={id}
          onCritical={rep => setCriticalReport(rep)}
        />
      )}
      {activeTab === 'Reportes'      && (
        <TabReportes
          patientId={id}
          role={user?.role}
          onRefreshPending={loadPatient}
        />
      )}
    </div>
  )
}