import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Redirige llamadas /api/* → backend FastAPI
      '/api': {
        target:  'http://backend:8000',
        rewrite: path => path.replace(/^\/api/, ''),
      },
      // Redirige WebSocket /ws/* → orquestador
      '/ws': {
        target: 'ws://orchestrator:8003',
        ws:     true,
      },
    },
  },
})