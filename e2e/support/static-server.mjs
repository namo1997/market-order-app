import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ssdPath } from './ssd-path.mjs';

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
export async function staticServer() {
  const root = ssdPath(process.env.E2E_DIST || path.resolve('../client/dist'));
  await fs.access(path.join(root, 'index.html'));
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.startsWith('/api/')) { res.writeHead(500); res.end('API escaped page.route'); return; }
      let file = path.resolve(root, `.${pathname}`);
      if (!(file === root || file.startsWith(`${root}/`)) || /(?:^|\/)\./.test(pathname)) { res.writeHead(403); res.end(); return; }
      try { if (!(await fs.stat(file)).isFile()) file = path.join(root, 'index.html'); }
      catch { file = path.join(root, 'index.html'); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await fs.readFile(file));
    } catch { res.writeHead(500); res.end('Static fixture server failed'); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}
