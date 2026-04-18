// frontend/src/services/api.js
// Servicio central de API para ClinAI.

import axios from 'axios'
import { useAuthStore } from '../store/auth'

// ✅ FIX MINIO: helper para corregir URLs internas
const fixMinioUrl = (url) => {
  if (!url) return url
  return url.replace('http://minio:9000', 'http://localhost:9000')
            .replace('https://minio:9000', 'http://localhost:9000')
}

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
  listPatients: (params = {}) => {
    const { limit = 10, offset = 0, ...rest } = params
    return api.get('/fhir/Patient', { params: { limit, offset, ...rest } })
  },

  getPatient: (id) =>
    api.get(`/fhir/Patient/${id}`),

  createPatient: (body) =>
    api.post('/fhir/Patient', body),

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

  listMedia: async (patientId, limit = 20) => {
    const res = await api.get('/fhir/Media', {
      params: { subject: patientId, limit, presign: true }
    })

    console.log("MEDIA RESPONSE:", res.data)

    if (res.data?.entry) {
      res.data.entry = res.data.entry.map((m) => ({
        ...m,
        // ✅ URL FINAL que debes usar en el frontend
        url: fixMinioUrl(m.presigned_url),
      }))
    }

    return res
  },

  // ✅ FIX: corregir URL individual
  getMediaUrl: async (mediaId) => {
    const res = await api.get(`/fhir/Media/${mediaId}/url`)
    if (res.data?.url) {
      res.data.url = fixMinioUrl(res.data.url)
    }
    return res
  },

  // Subir imagen
  uploadImage: (patientId, file, modality = 'FUNDUS') => {
    const fd = new FormData()
    fd.append('patient_id', patientId)
    fd.append('modality', modality)
    fd.append('file', file)
    return api.post('/fhir/Media/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  // ── RiskAssessment ───────────────────────────────────────────────────────────
  listRiskReports: (patientId, limit = 20) =>
    api.get('/fhir/RiskAssessment', { params: { subject: patientId, limit } }),

  getRiskReport: (rid) =>
    api.get(`/fhir/RiskAssessment/${rid}`),

  signReport: (rid, body) =>
    api.patch(`/fhir/RiskAssessment/${rid}/sign`, body),
}

// ── Inference API ─────────────────────────────────────────────────────────────
export const inferAPI = {
  request: (patientId, modelType) => {
    const { userId } = useAuthStore.getState()
    return api.post('/infer', {
      patient_id:   patientId,
      model_type:   modelType,
      requested_by: userId,
    })
  },

  status: (taskId) =>
    api.get(`/infer/${taskId}`),

  result: (taskId) =>
    api.get(`/infer/${taskId}/result`),
}

// ── Admin API ─────────────────────────────────────────────────────────────────
export const adminAPI = {
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