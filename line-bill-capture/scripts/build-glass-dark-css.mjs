// สร้าง public/glass-dark.css สำหรับโหมดมืดของธีม Liquid Glass
// หน้า admin เดิมเขียนสีพื้น/ตัวอักษรตายตัวไว้หลายจุด สคริปต์นี้อ่าน CSS ทั้งหมดแล้วสร้างกฎแทนสีให้เข้ากับพื้นมืด
// รันใหม่ทุกครั้งที่แก้สีใน public/index.html หรือไฟล์ CSS เสริม: node scripts/build-glass-dark-css.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const sources = [
  ['index.html', html => html.slice(html.indexOf('<style>') + 7, html.indexOf('</style>'))],
  ['expense-profile.css', s => s],
  ['expense-status.css', s => s],
  ['workflow-guidance.css', s => s],
  ['desktop-workspace.css', s => s],
];
// เนื้อหาที่ต้องคงเป็นกระดาษขาว (รูปเอกสาร ใบแทน) ไม่แปลงสี
const KEEP = /receiptpaper|generated-document|img\b|paper|thumb|lightbox|chatimage|itemvisual|slippreviewvisual|pagesgrid/i;
const PREFIX = 'html.theme-glass.glass-dark';

const hexToRgb = h => {
  let x = h.replace('#', '');
  if (x.length === 3 || x.length === 4) x = [...x].map(c => c + c).join('');
  const n = parseInt(x.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, x.length === 8 ? parseInt(x.slice(6), 16) / 255 : 1];
};
const rgbToHsl = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
};
const chroma = ([r, g, b]) => (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
const hsl = (h, s, l, a = 1) => `hsla(${Math.round(h)},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${+a.toFixed(2)})`;

function mapBackground(hex, hover) {
  const [r, g, b, a] = hexToRgb(hex);
  if (a < .2) return null;
  const [h, s, l] = rgbToHsl([r, g, b]);
  if (l < .8) return null;                      // สีเข้ม/สีเด่นอยู่แล้ว ปล่อยไว้
  if (chroma([r, g, b]) < .06) return `rgba(255,255,255,${hover ? .12 : .07})`; // ขาว/เทาอ่อน → กระจกมืด
  return hsl(h, Math.min(1, s + .2), .5, .16);  // พื้นสีอ่อน → สีเดิมแบบโปร่ง
}
function mapText(hex) {
  const [r, g, b] = hexToRgb(hex);
  const [h, s, l] = rgbToHsl([r, g, b]);
  if (l > .55) return null;
  if (chroma([r, g, b]) < .08) return 'var(--ink)';            // ดำ/เทาเข้ม → ตัวอักษรสว่าง
  return hsl(h, Math.min(1, s + .1), .74);      // สีเข้ม → สีเดียวกันแบบสว่าง
}
function mapBorder(hex) {
  const [r, g, b] = hexToRgb(hex);
  const [, , l] = rgbToHsl([r, g, b]);
  return l > .75 && chroma([r, g, b]) < .12 ? 'rgba(255,255,255,.1)' : null;
}

const out = [];
for (const [file, pick] of sources) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const css = pick(fs.readFileSync(full, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const [, rawSel, body] of css.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) {
    const sel = rawSel.trim().replace(/\s+/g, ' ');
    if (!sel || sel.startsWith('from') || sel.startsWith('to') || /^\d/.test(sel) || sel.includes(':root') || KEEP.test(sel)) continue;
    const decls = [];
    for (const [, prop, value] of body.matchAll(/(background(?:-color)?|color|border(?:-color|-top|-bottom|-left|-right)?)\s*:\s*([^;]+)/g)) {
      const hex = value.match(/#[0-9a-fA-F]{3,8}\b/)?.[0];
      if (!hex || /gradient|url\(/.test(value)) continue;
      const imp = /!important/.test(value) ? ' !important' : '';
      if (prop.startsWith('background')) { const v = mapBackground(hex, /:hover|:focus/.test(sel)); if (v) decls.push(`background:${v}${imp}`); }
      else if (prop === 'color') { const v = mapText(hex); if (v) decls.push(`color:${v}${imp}`); }
      else { const v = mapBorder(hex); if (v) decls.push(`${prop.includes('-color') ? prop : prop + '-color'}:${v}${imp}`); }
    }
    if (!decls.length) continue;
    const scoped = sel.split(',').map(s => s.trim()).filter(Boolean).map(s => /^(html|body)\b/.test(s) ? null : `${PREFIX} ${s}`).filter(Boolean);
    if (scoped.length) out.push(`${scoped.join(',')}{${decls.join(';')}}`);
  }
}
const header = `/* สร้างอัตโนมัติโดย scripts/build-glass-dark-css.mjs — อย่าแก้มือ\n   โหมดมืดของธีม Liquid Glass: แทนสีพื้นขาว/ตัวอักษรเข้มที่หน้าเดิมเขียนตายตัว (${out.length} กฎ) */\n`;
fs.writeFileSync(path.join(root, 'glass-dark.css'), header + out.join('\n') + '\n');
console.log(`glass-dark.css: ${out.length} rules`);
