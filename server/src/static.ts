import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Context } from 'hono';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

export function staticHandler(rootDir: string) {
  return async (c: Context): Promise<Response> => {
    const urlPath = new URL(c.req.url).pathname;
    let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
    if (rel === '' || rel.endsWith('/')) rel = `${rel}index.html`;

    if (rel.includes('..')) return c.text('forbidden', 403);

    const filePath = path.join(rootDir, rel);
    let data: Buffer;
    try {
      data = await fs.readFile(filePath);
    } catch {
      // SPA fallback: serve index.html for unmatched routes (so client-side router can take over)
      try {
        const indexHtml = await fs.readFile(path.join(rootDir, 'index.html'));
        return c.body(new Uint8Array(indexHtml), 200, { 'Content-Type': MIME['.html']! });
      } catch {
        return c.text('web UI not built — run `npm run build`', 404);
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] ?? 'application/octet-stream';
    return c.body(new Uint8Array(data), 200, { 'Content-Type': type });
  };
}
