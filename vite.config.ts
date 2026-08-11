import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Pair with `npm run dev:api` (scripts/local-api.ts on :8787)
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (_err, _req: IncomingMessage, res) => {
            const r = res as ServerResponse;
            if (!r || r.headersSent || typeof r.writeHead !== 'function') return;
            r.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
            r.end(
              JSON.stringify({
                error:
                  'Local API is not running on :8787. In another terminal run: npm run dev:api',
              }),
            );
          });
        },
      },
    },
  },
})
