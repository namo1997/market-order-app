import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // รับ connection จากทุกอุปกรณ์ในเครือข่าย
    port: 5173,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // ตัวอ่านบาร์โค้ดจากกล้อง: โหลดเฉพาะตอนกดเปิดกล้อง ไม่รวมใน vendor ที่ทุกหน้าโหลด
          if (id.includes('@zxing')) return 'zxing';

          if (id.includes('react') || id.includes('scheduler')) {
            return 'react-vendor';
          }

          return 'vendor';
        }
      }
    }
  }
})
