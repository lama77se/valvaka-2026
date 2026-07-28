import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    // Fast egen port så dev-servern aldrig krockar med andra projekt under c:\dev.
    // strictPort => faila hellre högt än att glida över på en annan ledig port.
    port: 5926,
    strictPort: true,
  },
})
