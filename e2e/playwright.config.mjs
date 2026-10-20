import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { DEFAULT_OUT, ssdDirectory } from './support/ssd-path.mjs';

const out = ssdDirectory(process.env.E2E_OUT || DEFAULT_OUT);
const round = process.env.E2E_ROUND || 'manual';
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 7000 },
  outputDir: path.join(out, `artifacts-${round}`),
  reporter: [['list'], ['json', { outputFile: path.join(out, `results-${round}.json`) }],
    ['html', { outputFolder: path.join(out, `html-${round}`), open: 'never' }]],
  use: {
    browserName: 'chromium', headless: true, locale: 'th-TH', timezoneId: 'Asia/Bangkok',
    // Network traces embed upload/signature bodies; use screenshots + sanitized evidence instead.
    serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure',
  },
  projects: [360, 390, 1440].flatMap(width => ['light', 'dark'].map(colorScheme => ({
    name: `${width}-${colorScheme}`, use: { viewport: { width, height: width < 760 ? 844 : 1000 }, colorScheme },
  }))),
});
