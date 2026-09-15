import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: true,         // Expose on 0.0.0.0 (accessible via Wi-Fi & ngrok)
    port: 5173,
    allowedHosts: true, // Allow ngrok host headers (*.ngrok-free.app)
    proxy: {
      '/api/v1/auth': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api/v1/admin/stream': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/api/v1/admin/questions': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/api/v1/admin': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/api/v1/stream': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
      '/api/v1/questions': {
        target: 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
