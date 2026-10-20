import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Renders the real ReceivingAdminShell (router, layout and CSS mocked) and
// returns the class tokens of its root element, so tests assert behaviour
// instead of an exact className source string.
let renderer;
async function load() {
  const out = await build({
    stdin: { resolveDir: fileURLToPath(new URL('../src', import.meta.url)), loader: 'jsx',
      contents: `import * as React from 'react'; import { renderToStaticMarkup } from 'react-dom/server';
        import { ReceivingAdminShell } from './pages/admin/receiving/ReceivingAdminShell.jsx';
        export const render = props => renderToStaticMarkup(React.createElement(ReceivingAdminShell, props, React.createElement('p', null, 'x')));` },
    bundle: true, write: false, format: 'cjs', platform: 'node', jsx: 'automatic', nodePaths: [fileURLToPath(new URL('../node_modules', import.meta.url))],
    plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /react-router-dom|components\/layout\/Layout|\.css$/ }, args => ({ path: args.path, namespace: 'mock' }));
      b.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'js', resolveDir: fileURLToPath(new URL('../src', import.meta.url)), contents: args.path.includes('react-router-dom')
        ? `import { createElement as h } from 'react'; export const Link = ({ to, children, ...rest }) => h('a', { href: to, ...rest }, children);`
        : args.path.includes('layout/Layout') ? `import { createElement as h } from 'react'; export const Layout = ({ children }) => h('div', { 'data-layout': true }, children);`
          : 'export default {};' }));
    } }] });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', out.outputFiles[0].text)(module, module.exports, createRequire(import.meta.url));
  return module.exports.render;
}

export async function shellRootClasses(props = {}) {
  renderer ||= await load();
  const match = /<div data-layout="true"><div class="([^"]*)"/.exec(renderer(props));
  if (!match) throw new Error('ReceivingAdminShell root element not found');
  return match[1].split(/\s+/).filter(Boolean);
}
