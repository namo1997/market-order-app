import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { main: 'index.html', apPreview: 'ap-preview.html' } } },
  server: {
    port: 5178,
    host: '0.0.0.0'
  }
});
