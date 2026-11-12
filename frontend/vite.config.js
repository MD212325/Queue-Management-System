import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// Optional HTTPS for the dev server (phones need HTTPS for push notifications on a LAN).
// Put a key/cert pair in frontend/certs (for example made with mkcert) and set
//   DEV_HTTPS_KEY=certs/your-key.pem  DEV_HTTPS_CERT=certs/your-cert.pem
// Without them the dev server simply runs on plain HTTP instead of crashing.
// (Settings can also live in frontend/.env.local, see .env.example)
const apiRoutes = ['/ticket', '/queue', '/events', '/subscribe', '/services', '/stats', '/auth', '/admin',
  '/next', '/serve', '/hold', '/recall', '/reassign', '/push', '/export.csv', '/health']

// Every backend route the browser pages call. Keeping this list in one place means the
// admin panel, kiosk and display all work against the dev server the same way they do in production.
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, here, ''), ...process.env }
  const keyFile = env.DEV_HTTPS_KEY && path.resolve(here, env.DEV_HTTPS_KEY)
  const certFile = env.DEV_HTTPS_CERT && path.resolve(here, env.DEV_HTTPS_CERT)
  const https = keyFile && certFile && fs.existsSync(keyFile) && fs.existsSync(certFile)
    ? { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }
    : undefined
  const forward = { target: env.API_TARGET || 'http://localhost:4000', changeOrigin: true, secure: false, xfwd: true }

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5173,
      https,
      proxy: Object.fromEntries(apiRoutes.map(r => [r, forward])),
    },
  }
})
