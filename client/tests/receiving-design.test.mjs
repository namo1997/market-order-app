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
test('design: actual shared light/dark palettes and primary text meet 4.5:1 contrast', async () => {
  const css = await readFile(new URL('../src/design/tokens.css', import.meta.url), 'utf8');
  const declarations = [...css.matchAll(/--sg-([a-z-]+):\s*(#[a-fA-F0-9]+|var\(--sg-([a-z-]+)\))/g)];
  const parse = (block, inherited = {}) => {
    const palette = { ...inherited };
    for (const match of block) palette[match[1]] = match[3] ? palette[match[3]] : match[2];
    return palette;
  };
  const firstDark = css.indexOf('@media (prefers-color-scheme: dark)');
  const light = parse(declarations.filter((match) => match.index < firstDark));
  const dark = parse(declarations.filter((match) => match.index > firstDark), light);
  for (const [name, palette] of [['light', light], ['dark', dark]]) {
    for (const [text, background] of [['text', 'bg'], ['text', 'surface'], ['muted', 'bg'], ['muted', 'surface'], ['muted', 'surface-secondary'],
      ['text', 'surface-secondary'], ['on-action', 'action'], ['ok', 'ok-bg'], ['review', 'review-bg'], ['error', 'error-bg']]) {
      const ratio = contrast(palette[text], palette[background]);
      assert.ok(ratio >= 4.5, `${name} ${text}/${background}: ${ratio.toFixed(2)}`);
    }
  }
});
