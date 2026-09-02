import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/m3/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'ระบบตรวจบิล Mobile V3',
        short_name: 'ตรวจบิล V3',
        description: 'ตรวจและจับคู่บิลกับหลักฐานการโอนสำหรับผู้ใช้ทุกวัย',
        theme_color: '#14532d',
        background_color: '#f8faf8',
        display: 'standalone',
        start_url: '/m3/',
        scope: '/m3/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: {
        navigateFallback: '/m3/index.html',
        navigateFallbackDenylist: [/^\/api\//, /^\/admin\//],
        runtimeCaching: [{
          urlPattern: ({ url }) => url.pathname.startsWith('/api/') || url.pathname.includes('/image'),
          handler: 'NetworkOnly'
        }]
      }
    })
  ],
  server: {
    proxy: {
      '/api': 'http://127.0.0.1:8010',
      '/admin': 'http://127.0.0.1:8010'
    }
  }
});
