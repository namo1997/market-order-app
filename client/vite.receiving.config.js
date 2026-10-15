import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  // The APK contains only this entry; no main-site assets or environment files.
  envDir: '.receiving-no-env',
  publicDir: false,
  plugins: [react(), {
    name: 'receiving-launch-entry',
    closeBundle() {
      const dir = new URL('./dist-receiving/', import.meta.url);
      renameSync(fileURLToPath(new URL('receiving.html', dir)), fileURLToPath(new URL('index.html', dir)));
    },
  }],
  build: { outDir: 'dist-receiving', rollupOptions: { input: 'receiving.html' } },
});
