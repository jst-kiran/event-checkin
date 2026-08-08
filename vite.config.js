import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import devApiPlugin from './dev/vite-api-plugin.js'
import loadDotEnv from './dev/loadDotEnv.js'

export default defineConfig(() => {
  // Makes the local /api handlers see the same variables Vercel injects in
  // production. Nothing here is exposed to the client — only VITE_* would be,
  // and none of these use that prefix.
  loadDotEnv(process.cwd())

  return {
    plugins: [react(), devApiPlugin()],
    server: {
      port: 5173,
      // Reachable from a phone on the same Wi-Fi, which is how the attendee
      // screens actually get tested before an event.
      host: true,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
