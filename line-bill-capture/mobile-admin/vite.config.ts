import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/m/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'LINE Bill Capture',
        short_name: 'Bill Capture',
        description: 'ตรวจและจับคู่บิลกับหลักฐานการโอน',
        theme_color: '#12634f',
        background_color: '#f4f7f6',
        display: 'standalone',
        start_url: '/m/',
        scope: '/m/',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: {
        navigateFallback: '/m/index.html',
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
