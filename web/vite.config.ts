import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Vite dev server port. Defaults to 5173 — override via WEB_PORT to match
// whatever compose publishes (.env's WEB_PORT) or to free up the port.
const webPort = Number.parseInt(process.env.WEB_PORT ?? '5173', 10);

// Proxy target for /api and /healthz. In the split-compose dev setup the web
// container reaches the server via the compose service name
// (VITE_PROXY_TARGET=http://server:${PORT}). On the host (someone running
// `npm run dev` outside Docker), localhost:${PORT} works.
const apiPort = process.env.PORT ?? '3000';
const proxyTarget = process.env.VITE_PROXY_TARGET ?? `http://localhost:${apiPort}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: webPort,
    proxy: {
      '/api': proxyTarget,
      '/healthz': proxyTarget,
    },
  },
});
