import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  // The APK contains only this entry; no main-site assets or environment files.
  envDir: '.receiving-no-env',
  publicDir: false,
  resolve: { alias: [{ find: /^\/fonts\//, replacement: fileURLToPath(new URL('./public/fonts/', import.meta.url)) }] },
  plugins: [{
    name: 'receiving-native-adapters', enforce: 'pre',
    resolveId(source, importer = '') {
      if (source === './client' && importer.includes('/src/api/')) return fileURLToPath(new URL('./src/receiving-app/client.mjs', import.meta.url));
      if (source.endsWith('/contexts/AuthContext')) return fileURLToPath(new URL('./src/receiving-app/runtime.mjs', import.meta.url));
      if (source === './image-capture' && importer.endsWith('/receiving/ImagePages.jsx')) return fileURLToPath(new URL('./src/receiving-app/native-capture.mjs', import.meta.url));
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'fonts/OFL.txt', source: readFileSync(new URL('./public/fonts/OFL.txt', import.meta.url), 'utf8') });
      const modules = [...this.getModuleIds()];
      for (const path of ['/src/pages/receiving/Receiving.jsx', '/src/receiving-app/client.mjs', '/src/receiving-app/native-capture.mjs', '/src/receiving-app/runtime.mjs']) {
        if (!modules.some(id => id.endsWith(path))) this.error(`Missing receiving adapter: ${path}`);
      }
      if (modules.some(id => /\/src\/(api\/client\.js|contexts\/AuthContext\.jsx)$/.test(id))) this.error('Main-site auth/client must not enter the APK');
    },
  }, react(), {
    name: 'receiving-launch-entry',
    closeBundle() {
      const dir = new URL('./dist-receiving/', import.meta.url);
      renameSync(fileURLToPath(new URL('receiving.html', dir)), fileURLToPath(new URL('index.html', dir)));
    },
  }],
  build: { outDir: 'dist-receiving', rollupOptions: { input: 'receiving.html' } },
});
