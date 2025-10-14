import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/queue': { target: 'http://localhost:4000', changeOrigin: true },
      '/events': { target: 'http://localhost:4000', changeOrigin: true },
      '/ticket': { target: 'http://localhost:4000', changeOrigin: true },
      '/next': { target: 'http://localhost:4000', changeOrigin: true },
      '/serve': { target: 'http://localhost:4000', changeOrigin: true },
      '/hold': { target: 'http://localhost:4000', changeOrigin: true },
      '/recall': { target: 'http://localhost:4000', changeOrigin: true }
    }
  }
})
