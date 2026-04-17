// frontend/src/services/api.js
// Servicio central de API para ClinAI.
// Todas las llamadas al backend pasan por aquí.

import axios from 'axios'
import { useAuthStore } from '../store/auth'

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ── Cliente axios con interceptor de auth ─────────────────────────────────────
const api = axios.create({ baseURL: BASE })

api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (r) => r,
  (err) => {
    // Si 401 → logout automático
    if (err.response?.status === 401) {
      useAuthStore.getState().logout?.()
    }
    return Promise.reject(err)
  }
)

// ── Auth API ──────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (accessKey, permissionKey) =>
    api.post('/auth/login', null, {
      headers: {
        'X-Access-Key': accessKey,
        'X-Permission-Key': permissionKey,
      },
    }),

  logout: () => api.post('/auth/logout'),

  acceptHabeasData: (policyVersion = '1.0') =>
    api.post('/auth/habeas-data', { policy_version: policyVersion }),
}

// ── FHIR API ──────────────────────────────────────────────────────────────────
export const fhirAPI = {
  // ── Patients ────────────────────────────────────────────────────────────────
// DESPUÉS:
  listPatients: (params = {}) => {
    const { limit = 10, offset = 0, ...rest } = params
    return api.get('/fhir/Patient', { params: { limit, offset, ...rest } })
  },

  getPatient: (id) =>
    api.get(`/fhir/Patient/${id}`),

  createPatient: (body) =>
    api.post('/fhir/Patient', body),

  // ✅ Crea paciente + observaciones en una sola llamada
  createPatientFull: (body) =>
    api.post('/fhir/Patient/full', body),

  deletePatient: (id) =>
    api.delete(`/fhir/Patient/${id}`),

  restorePatient: (id) =>
    api.patch(`/fhir/Patient/${id}/restore`),

  canClose: (id) =>
    api.get(`/fhir/Patient/${id}/can-close`),

  // ── Observations ─────────────────────────────────────────────────────────────
  listObservations: (patientId, limit = 50, offset = 0) =>
    api.get('/fhir/Observation', { params: { subject: patientId, limit, offset } }),

  createObservation: (body) =>
    api.post('/fhir/Observation', body),

  // ── Media (imágenes) ─────────────────────────────────────────────────────────
  // ✅ FIX: presign=true para obtener URLs reales de MinIO
  listMedia: (patientId, limit = 20) =>
    api.get('/fhir/Media', { params: { subject: patientId, limit, presign: true } }),

  // ✅ URL presignada individual por ID de imagen
  getMediaUrl: (mediaId) =>
    api.get(`/fhir/Media/${mediaId}/url`),

  // ✅ Subir imagen como multipart/form-data
  uploadImage: (patientId, file, modality = 'FUNDUS') => {
    const fd = new FormData()
    fd.append('patient_id', patientId)
    fd.append('modality', modality)
    fd.append('file', file)
    return api.post('/fhir/Media/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // ── RiskAssessment (reportes) ────────────────────────────────────────────────
  listRiskReports: (patientId, limit = 20) =>
    api.get('/fhir/RiskAssessment', { params: { subject: patientId, limit } }),

  // ✅ Obtener un reporte individual por ID
  getRiskReport: (rid) =>
    api.get(`/fhir/RiskAssessment/${rid}`),

  signReport: (rid, body) =>
    api.patch(`/fhir/RiskAssessment/${rid}/sign`, body),
}

// ── Inference API ─────────────────────────────────────────────────────────────
export const inferAPI = {
  // Lanza una inferencia — retorna { task_id, status: "PENDING" }
  // DESPUÉS — agrega userId del store:
  request: (patientId, modelType) => {
    const { userId } = useAuthStore.getState()
    return api.post('/infer', {
      patient_id:   patientId,
      model_type:   modelType,
      requested_by: userId,
    })
  },

  // Polling de estado — retorna { status, task_id, ... }
  status: (taskId) =>
    api.get(`/infer/${taskId}`),

  // ✅ FIX PRINCIPAL: Retorna status + result completo cuando DONE
  // Este endpoint está corregido en main.py (usa get_db, no get_pool)
  result: (taskId) =>
    api.get(`/infer/${taskId}/result`),
}

// ── Admin API ─────────────────────────────────────────────────────────────────
export const adminAPI = {
  // Nombres que usa AdminPanel.jsx
  stats:       () => api.get('/admin/stats'),
  getStats:    () => api.get('/admin/stats'),

  listUsers: (params) => {
    const limit  = params?.limit  ?? 20
    const offset = params?.offset ?? 0
    return api.get('/admin/users', { params: { limit, offset } })
  },

  createUser:  (body)    => api.post('/admin/users', body),
  updateUser:  (uid, b)  => api.patch(`/admin/users/${uid}`, b),
  deleteUser:  (uid)     => api.delete(`/admin/users/${uid}`),

  regenKeys:       (uid) => api.post(`/admin/users/${uid}/regenerate-keys`),
  regenerateKeys:  (uid) => api.post(`/admin/users/${uid}/regenerate-keys`),

  auditLog:    (params)  => api.get('/admin/audit-log', { params }),
  getAuditLog: (params)  => api.get('/admin/audit-log', { params }),

  exportAudit: (fmt) => api.get('/admin/audit-log/export', {
    params: { fmt }, responseType: 'blob'
  }),
  exportAuditLog: (fmt) => api.get('/admin/audit-log/export', {
    params: { fmt }, responseType: fmt === 'csv' ? 'blob' : 'json'
  }),
}

export default api