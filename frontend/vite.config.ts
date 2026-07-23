import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        // Use 127.0.0.1 (not localhost) — on Windows localhost can resolve to ::1
        // while the backend listens on IPv4 only, which causes ECONNREFUSED / empty data.
        target: 'http://127.0.0.1:5000',
        changeOrigin: true,
      },
    },
  },
})
