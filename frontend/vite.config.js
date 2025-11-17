import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {

    host: true,
    port: 5173,

    https: {
        key: './certs/192.168.18.34+2-key.pem',
        cert: './certs/192.168.18.34+2.pem'
    },

    proxy: {
      '/ticket': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/queue':  { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/events': { target: 'http://localhost:4000', changeOrigin: true, secure: false },
      '/subscribe': { target: 'http://localhost:4000', changeOrigin: true, secure: false }
    }

    }
  }
)