import { useState, useEffect, useCallback } from 'react'
import { inferAPI } from '../../services/api'
import { useInferenceSocket } from '../hooks/useInferenceSocket'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import toast from 'react-hot-toast'

const MODEL_OPTIONS = [
  { value: 'ML',         label: 'Tabular ML',  icon: '▦', desc: 'XGBoost · PIMA Diabetes' },
  { value: 'DL',         label: 'Imagen DL',   icon: '◈', desc: 'EfficientNet-B0 · Retina' },
  { value: 'MULTIMODAL', label: 'Multimodal',  icon: '⬡', desc: 'Fusión tardía ML + DL' },
]

const RISK_COLORS = {
  LOW: 'var(--risk-low)', MEDIUM: 'var(--risk-medium)',
  HIGH: 'var(--risk-high)', CRITICAL: 'var(--risk-critical)',
}

export default function InferencePanel({ patientId, onResult }) {
  const [modelType, setModelType]   = useState('ML')
  const [taskId,    setTaskId]      = useState(null)
  const [status,    setStatus]      = useState(null)   // PENDING | RUNNING | DONE | ERROR
  const [result,    setResult]      = useState(null)
  const [loading,   setLoading]     = useState(false)
  const [critical,  setCritical]    = useState(false)

  // ── WebSocket push ────────────────────────────────────────────────────────
  const handleWsMessage = useCallback((data) => {
    if (data.status) setStatus(data.status)
    if (data.type === 'CRITICAL_ALERT') {
      setCritical(true)
      toast.error('⚠ ALERTA CRÍTICA — Requiere atención inmediata', { duration: 10000 })
    }
    if (data.status === 'DONE' && data.result_id) {
      fetchResult(data.result_id)
    }
  }, [])

  useInferenceSocket(taskId, handleWsMessage)

  // ── Polling fallback (every 3s) ───────────────────────────────────────────
  useEffect(() => {
    if (!taskId || status === 'DONE' || status === 'ERROR') return
    const interval = setInterval(async () => {
      try {
        const { data } = await inferAPI.status(taskId)
        setStatus(data.status)
        if (data.status === 'DONE' && data.result_id) {
          clearInterval(interval)
          fetchResult(data.result_id)
        }
        if (data.status === 'ERROR') {
          clearInterval(interval)
          toast.error(data.error_msg || 'Error en inferencia')
        }
      } catch {}
    }, 3000)
    return () => clearInterval(interval)
  }, [taskId, status])

  const fetchResult = async (resultId) => {
    // Result is embedded in the WS message; for now just trigger parent reload
    onResult?.()
  }

  const handleRun = async () => {
    setLoading(true)
    setResult(null)
    setStatus('PENDING')
    setCritical(false)
    try {
      const { data } = await inferAPI.request(patientId, modelType)
      setTaskId(data.task_id)
      toast.success(`Análisis ${modelType} iniciado`)
    } catch (e) {
      const detail = e.response?.data?.detail
      toast.error(typeof detail === 'string' ? detail : 'Error al iniciar análisis')
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }

  const statusLabel = {
    PENDING:  { txt: 'En cola…',    color: 'var(--cyan)'    },
    RUNNING:  { txt: 'Procesando…', color: 'var(--warning)' },
    DONE:     { txt: 'Completado',  color: 'var(--success)'  },
    ERROR:    { txt: 'Error',       color: 'var(--danger)'  },
  }[status] || null

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Model selector */}
      <div>
        <span className="label">Tipo de análisis</span>
        <div style={{ display: 'flex', gap: '0.625rem', flexWrap: 'wrap', marginTop: '0.5rem' }}>
          {MODEL_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setModelType(opt.value)}
              style={{
                flex: 1, minWidth: 120,
                background: modelType === opt.value ? 'var(--cyan-dim)' : 'var(--bg-base)',
                border: `1px solid ${modelType === opt.value ? 'var(--cyan)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-md)',
                padding: '0.75rem',
                cursor: 'pointer',
                textAlign: 'left',
                transition: 'all 0.18s',
              }}
            >
              <div style={{ fontSize: '1.125rem', marginBottom: '0.25rem' }}>{opt.icon}</div>
              <div style={{
                fontFamily: 'var(--font-display)',
                fontSize: '0.875rem',
                fontWeight: 600,
                color: modelType === opt.value ? 'var(--cyan)' : 'var(--text-primary)',
              }}>{opt.label}</div>
              <div style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {opt.desc}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Run button */}
      <button
        className="btn btn-primary"
        onClick={handleRun}
        disabled={loading || status === 'RUNNING' || status === 'PENDING'}
        style={{ alignSelf: 'flex-start' }}
        aria-label={`Ejecutar análisis ${modelType}`}
      >
        {loading || status === 'PENDING' || status === 'RUNNING'
          ? <><span className="spinner" style={{ width: 14, height: 14 }} /> Ejecutando…</>
          : '▶ Ejecutar análisis'
        }
      </button>

      {/* Status indicator */}
      {statusLabel && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0.625rem',
          padding: '0.625rem 0.875rem',
          background: 'var(--bg-base)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
        }}>
          {(status === 'PENDING' || status === 'RUNNING') &&
            <span className="spinner" style={{ width: 14, height: 14 }} />}
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem', color: statusLabel.color }}>
            {statusLabel.txt}
          </span>
          {taskId && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6875rem', color: 'var(--text-muted)', marginLeft: 'auto' }}>
              {taskId.slice(0, 8)}…
            </span>
          )}
        </div>
      )}

      {/* Disclaimer IA */}
      <p className="disclaimer-ai" role="note">
        ⚠ Resultado de apoyo diagnóstico. No reemplaza criterio médico. Sujeto a revisión clínica.
      </p>
    </div>
  )
}