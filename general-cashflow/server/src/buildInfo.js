import fs from 'node:fs';
let build = { commit: process.env.CASHFLOW_BUILD_COMMIT || 'development' };
try { build = JSON.parse(fs.readFileSync(new URL('../build-info.json', import.meta.url), 'utf8')); } catch { /* local development */ }
export const buildInfo = Object.freeze(build);
