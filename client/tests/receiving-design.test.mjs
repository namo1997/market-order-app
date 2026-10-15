import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const luminance = (hex) => {
  const text = hex.length === 4 ? '#' + hex.slice(1).split('').map((c) => c + c).join('') : hex;
  const channels = [1, 3, 5].map((i) => parseInt(text.slice(i, i + 2), 16) / 255)
    .map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
};
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
test('design: actual light/dark CSS text palettes and hero meet 4.5:1 contrast', async () => {
  const css = await readFile(new URL('../src/pages/receiving/receiving.css', import.meta.url), 'utf8');
  const blocks = [css.slice(0, css.indexOf('min-height: 100dvh')), css.slice(css.indexOf('@media (prefers-color-scheme: dark)'))];
  const pairs = [['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'soft'],
    ['ink', 'bg'], ['ink', 'surface'], ['ink', 'soft'], ['gold-text', 'warn-bg'],
    ['danger', 'danger-bg'], ['success', 'success-bg']];
  for (const [index, block] of blocks.entries()) {
    const palette = Object.fromEntries([...block.matchAll(/--rc-([a-z-]+):\s*(#[a-fA-F0-9]+)/g)].map((match) => [match[1], match[2]]));
    for (const [text, background] of pairs) {
      const ratio = contrast(palette[text], palette[background]);
      assert.ok(ratio >= 4.5, `${index ? 'dark' : 'light'} ${text}/${background}: ${ratio.toFixed(2)}`);
    }
  }
  for (const color of ['#fff', '#e5e9f4', '#f4d898']) assert.ok(contrast(color, '#1e3168') >= 4.5);
});
