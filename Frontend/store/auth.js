import { create } from 'zustand'

export const useAuthStore = create((set, get) => ({
  token:  localStorage.getItem('token') || null,
  role:   localStorage.getItem('role')  || null,
  userId: localStorage.getItem('userId') || null,
  needsHabeas: false,

  setAuth: ({ access_token, role, user_id, needs_habeas_data }) => {
    localStorage.setItem('token',  access_token)
    localStorage.setItem('role',   role)
    localStorage.setItem('userId', user_id)
    set({ token: access_token, role, userId: user_id,
          needsHabeas: needs_habeas_data })
  },

  clearAuth: () => {
    localStorage.clear()
    set({ token: null, role: null, userId: null, needsHabeas: false })
  },

  isAdmin:   () => get().role === 'ADMIN',
  isMedico:  () => get().role === 'MEDICO' || get().role === 'ADMIN',
  isPaciente:() => get().role === 'PACIENTE',
}))