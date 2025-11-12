import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {

    https: {
        key: './certs/sti-queue-system-privateKey.key',
        cert: './certs/sti-queue-system.crt'
    },

    proxy: {
      '/queue': { target: 'https://localhost:4000', changeOrigin: true },
      '/events': { target: 'https://localhost:4000', changeOrigin: true },
      '/ticket': { target: 'https://localhost:4000', changeOrigin: true },
      '/next': { target: 'https://localhost:4000', changeOrigin: true },
      '/serve': { target: 'https://localhost:4000', changeOrigin: true },
      '/hold': { target: 'https://localhost:4000', changeOrigin: true },
      '/recall': { target: 'https://localhost:4000', changeOrigin: true }
    }

    }
  }
)