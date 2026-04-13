import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useBlocker } from 'react-router-dom'
import { fhirAPI } from '../../services/api'
import { useAuthStore } from '../../store/auth'
import Layout from '../../components/Layout'
import InferencePanel from '../components/InferencePanel'
import RiskReportForm from '../components/RiskReportForm'
import ImageViewer from '../components/ImageViewer'
import ObservationsChart from '../components/ObservationsChart'
import toast from 'react-hot-toast'
import './PatientDetail.css'

export default function PatientDetail() {
  const { id }      = useParams()
  const navigate    = useNavigate()
  const { isMedico, role } = useAuthStore()

  const [patient,     setPatient]     = useState(null)
  const [obs,         setObs]         = useState([])
  const [media,       setMedia]       = useState([])
  const [reports,     setReports]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [activeTab,   setActiveTab]   = useState('ficha')
  const [closingBlock, setClosingBlock] = useState(false)

  const hasPending = reports.some(r => !r.signed_at)

  // Block navigation if unsigned reports exist
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      hasPending && currentLocation.pathname !== nextLocation.pathname
  )

  useEffect(() => {
    if (blocker.state === 'blocked') {
      const go = window.confirm(
        '⚠ Tiene RiskReports sin firmar. Debe firmar antes de continuar.\n\n¿Desea abandonar de todas formas?'
      )
      if (go) blocker.proceed()
      else    blocker.reset()
    }
  }, [blocker])

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const [pRes, oRes, mRes, rRes] = await Promise.all([
        fhirAPI.getPatient(id),
        fhirAPI.listObservations(id, { limit: 100 }),
        fhirAPI.listMedia(id),
        fhirAPI.listRiskReports(id),
      ])
      setPatient(pRes.data)
      setObs(oRes.data.entry    || [])
      setMedia(mRes.data.entry  || [])
      setReports(rRes.data.entry || [])
    } catch (e) {
      toast.error('Error cargando ficha del paciente')
      navigate('/dashboard')
    } finally {
      setLoading(false)
    }
  }, [id, navigate])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleClose = async () => {
    setClosingBlock(true)
    try {
      await fhirAPI.canClose(id)
      toast.success('Paciente cerrado correctamente')
      navigate('/dashboard')
    } catch (e) {
      const detail = e.response?.data?.detail
      if (detail?.error === 'PENDING_SIGNATURE') {
        toast.error(`Debe firmar ${detail.pending_count} RiskReport(s) antes de cerrar`)
        setActiveTab('reportes')
      } else {
        toast.error('Error al cerrar paciente')
      }
    } finally {
      setClosingBlock(false)
    }
  }

  if (loading) return (
    <Layout>
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <span className="spinner" style={{ width: 32, height: 32 }} />
      </div>
    </Layout>
  )

  if (!patient) return null

  const tabs = [
    { id: 'ficha',    label: 'Ficha clínica' },
    { id: 'analisis', label: 'Análisis IA',   hidden: !isMedico() },
    { id: 'imagenes', label: 'Imágenes',       count: media.length },
    { id: 'reportes', label: 'RiskReports',
      count: reports.length,
      alert: hasPending },
  ].filter(t => !t.hidden)

  return (
    <Layout>
      <div className="patient-detail page-enter">

        {/* Pending signature banner */}
        {hasPending && (
          <div className="pending-banner" role="alert" aria-live="assertive">
            <span>⚠</span>
            <strong>Debe firmar el RiskReport antes de continuar</strong>
            <button className="btn btn-danger" style={{ padding: '0.3rem 0.875rem', fontSize: '0.8125rem' }}
              onClick={() => setActiveTab('reportes')}>
              Ir a firmar
            </button>
          </div>
        )}

        {/* Patient header */}
        <div className="patient-header">
          <div className="patient-avatar" aria-hidden>
            {patient.name?.[0]?.toUpperCase() || '?'}
          </div>
          <div className="patient-info">
            <h2>{patient.name}</h2>
            <div className="patient-meta">
              <span className="mono">{id.slice(0, 8)}…</span>
              <span>·</span>
              <span>{patient.birthDate || '—'}</span>
              {reports[0]?.prediction?.[0]?.qualitativeRisk?.coding?.[0]?.display && (
                <>
                  <span>·</span>
                  <span className={`badge badge-${reports[0].prediction[0].qualitativeRisk.coding[0].display.toLowerCase()}`}>
                    {reports[0].prediction[0].qualitativeRisk.coding[0].display}
                  </span>
                </>
              )}
            </div>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <button
              className="btn btn-ghost"
              onClick={() => navigate('/dashboard')}
              aria-label="Volver al dashboard"
            >
              ← Volver
            </button>
            <button
              className="btn btn-primary"
              onClick={handleClose}
              disabled={hasPending || closingBlock}
              title={hasPending ? 'Firme todos los RiskReports antes de cerrar' : 'Cerrar paciente'}
              aria-disabled={hasPending}
            >
              {closingBlock
                ? <span className="spinner" style={{ width: 14, height: 14 }} />
                : hasPending ? '🔒 Cerrar paciente' : '✓ Cerrar paciente'}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs" role="tablist">
          {tabs.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={activeTab === t.id}
              className={`tab-btn ${activeTab === t.id ? 'active' : ''} ${t.alert ? 'tab-alert' : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`tab-count ${t.alert ? 'tab-count-alert' : ''}`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab panels */}
        <div role="tabpanel">
          {/* ── Ficha clínica ── */}
          {activeTab === 'ficha' && (
            <div className="tab-content">
              <div className="grid-2">
                {/* Demographics */}
                <div className="card">
                  <h3 style={{ marginBottom: '1rem' }}>Datos del paciente</h3>
                  <dl className="data-list">
                    <div><dt className="label">Nombre</dt><dd>{patient.name}</dd></div>
                    <div><dt className="label">Fecha nacimiento</dt><dd>{patient.birthDate || '—'}</dd></div>
                    <div><dt className="label">ID FHIR</dt><dd className="mono" style={{ fontSize: '0.8125rem' }}>{id}</dd></div>
                    <div><dt className="label">Estado</dt>
                      <dd><span className={`badge ${patient.active ? 'badge-signed' : 'badge-pending'}`}>
                        {patient.active ? 'Activo' : 'Inactivo'}
                      </span></dd>
                    </div>
                  </dl>
                </div>

                {/* Latest risk summary */}
                {reports[0] && (
                  <div className="card">
                    <h3 style={{ marginBottom: '1rem' }}>Último análisis</h3>
                    <dl className="data-list">
                      <div>
                        <dt className="label">Modelo</dt>
                        <dd className="mono">{reports[0].method}</dd>
                      </div>
                      <div>
                        <dt className="label">Score</dt>
                        <dd style={{ fontFamily: 'var(--font-mono)', fontSize: '1.25rem',
                          color: 'var(--text-primary)' }}>
                          {reports[0].prediction?.[0]?.probabilityDecimal?.toFixed(4)}
                        </dd>
                      </div>
                      <div>
                        <dt className="label">Estado</dt>
                        <dd>
                          {reports[0].signed_at
                            ? <span className="badge badge-signed">✓ Firmado</span>
                            : <span className="badge badge-pending">⏳ Pendiente firma</span>}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>

              {/* Observations chart */}
              {obs.length > 0 && (
                <div className="card" style={{ marginTop: '1.5rem' }}>
                  <h3 style={{ marginBottom: '1rem' }}>Observaciones clínicas (LOINC)</h3>
                  <ObservationsChart observations={obs} />
                </div>
              )}
            </div>
          )}

          {/* ── Análisis IA ── */}
          {activeTab === 'analisis' && (
            <div className="tab-content">
              <InferencePanel patientId={id} onResult={fetchAll} />
            </div>
          )}

          {/* ── Imágenes ── */}
          {activeTab === 'imagenes' && (
            <div className="tab-content">
              {media.length === 0
                ? <p style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
                    Sin imágenes registradas
                  </p>
                : media.map(m => (
                    <ImageViewer key={m.id} media={m} />
                  ))
              }
            </div>
          )}

          {/* ── RiskReports ── */}
          {activeTab === 'reportes' && (
            <div className="tab-content" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {reports.length === 0
                ? <p style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
                    Sin reportes de riesgo
                  </p>
                : reports.map(r => (
                    <div key={r.id}>
                      {!r.signed_at && isMedico() && (
                        <RiskReportForm report={r} onSigned={fetchAll} />
                      )}
                      {r.signed_at && (
                        <div className="card">
                          <div style={{ display: 'flex', alignItems: 'center',
                            justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
                            <span className="badge badge-signed">✓ Firmado</span>
                            <span className="mono" style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              {new Date(r.signed_at).toLocaleString('es-CO')}
                            </span>
                          </div>
                          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
                            {r.doctor_action} — {r.doctor_notes || '—'}
                          </p>
                        </div>
                      )}
                    </div>
                  ))
              }
            </div>
          )}
        </div>
      </div>
    </Layout>
  )
}