import fs from 'node:fs';
import path from 'node:path';

export const SSD = '/Volumes/SSD Files';
export const ROOT = `${SSD}/SOLAO/market-order-system`;
export const DEFAULT_OUT = `${ROOT}/reports/receiving-e2e-codex`;

// The supplied volume verification is authoritative. Never create a missing mount.
export function ssdPath(candidate) {
  if (!fs.existsSync(SSD) || fs.realpathSync(SSD) !== SSD) throw new Error('SSD mount absent; stopping without fallback');
  if (fs.statSync(SSD).dev === fs.statSync('/').dev) throw new Error('SSD mount is on the internal filesystem');
  const resolved = path.resolve(candidate);
  if (!resolved.startsWith(`${ROOT}/`)) throw new Error('Output must be under approved SSD project');
  let ancestor = resolved;
  while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
  if (!(fs.realpathSync(ancestor) === SSD || fs.realpathSync(ancestor).startsWith(`${SSD}/`))
    || fs.statSync(ancestor).dev !== fs.statSync(SSD).dev) throw new Error('Output escapes SSD');
  const stat = fs.statfsSync(SSD);
  if (stat.bavail * stat.bsize < 5 * 1024 ** 3) throw new Error('SSD has less than 5 GiB free');
  return resolved;
}

export function ssdDirectory(candidate) {
  const resolved = ssdPath(candidate);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}
