import axios from 'axios'

const BASE_URL = import.meta.env.VITE_API_URL || '/api'

export const api = axios.create({ baseURL: BASE_URL })

// Inject JWT on every request
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token')
  if (token) cfg.headers.Authorization = `Bearer ${token}`
  return cfg
})

// Auto-logout on 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.clear()
      window.location.href = '/login'
    }
    return Promise.reject(err)
  }
)

// ── Auth ────────────────────────────────────────────────────────────────────
export const authAPI = {
  login: (accessKey, permKey) =>
    api.post('/auth/login', {}, {
      headers: { 'X-Access-Key': accessKey, 'X-Permission-Key': permKey }
    }),
  logout: () => api.post('/auth/logout'),
  acceptHabeas: (policy_version = '1.0') =>
    api.post('/auth/habeas-data', { policy_version }),
}

// ── FHIR ────────────────────────────────────────────────────────────────────
export const fhirAPI = {
  listPatients:  (params) => api.get('/fhir/Patient', { params }),
  getPatient:    (id) => api.get(`/fhir/Patient/${id}`),
  createPatient: (body) => api.post('/fhir/Patient', body),
  canClose:      (id) => api.get(`/fhir/Patient/${id}/can-close`),

  listObservations: (subject, params) =>
    api.get('/fhir/Observation', { params: { subject, ...params } }),

  listMedia: (subject) =>
    api.get('/fhir/Media', { params: { subject } }),

  // Upload real de imagen desde el frontend (multipart/form-data)
  uploadImage: (patientId, file, modality = 'FUNDUS') => {
    const fd = new FormData()
    fd.append('patient_id', patientId)
    fd.append('modality', modality)
    fd.append('file', file)
    return api.post('/fhir/Media/upload', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },

  listRiskReports: (subject) =>
    api.get('/fhir/RiskAssessment', { params: { subject } }),

  signReport: (id, body) =>
    api.patch(`/fhir/RiskAssessment/${id}/sign`, body),
}

// ── Inference ───────────────────────────────────────────────────────────────
export const inferAPI = {
  request: (patient_id, model_type) =>
    api.post('/infer', { patient_id, model_type }),
  status:  (task_id) => api.get(`/infer/${task_id}`),
}

// ── Admin ───────────────────────────────────────────────────────────────────
export const adminAPI = {
  listUsers:      (params) => api.get('/admin/users', { params }),
  createUser:     (body)   => api.post('/admin/users', body),
  updateUser:     (id, b)  => api.patch(`/admin/users/${id}`, b),
  deleteUser:     (id)     => api.delete(`/admin/users/${id}`),
  regenKeys:      (id)     => api.post(`/admin/users/${id}/regenerate-keys`),
  auditLog:       (params) => api.get('/admin/audit-log', { params }),
  exportAudit:    (fmt)    => api.get('/admin/audit-log/export', {
    params: { fmt }, responseType: 'blob'
  }),
  stats:          () => api.get('/admin/stats'),
}