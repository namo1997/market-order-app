import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // รับ connection จากทุกอุปกรณ์ในเครือข่าย
    port: 5173,
  },
})
