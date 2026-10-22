import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Deshabilitar sourcemaps para prevenir la exposición de código fuente en producción (CWE-540 / OWASP)
    sourcemap: false,
  },
})
