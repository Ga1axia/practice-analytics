/**
 * Local API server for /api/* (pairs with Vite proxy → :8787).
 * Avoids `vercel dev` port conflicts when another app owns :3000.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseUrl } from 'node:url';
import { config } from 'dotenv';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Later values win — clears empty placeholders like SUPABASE_SERVICE_ROLE_KEY=
config({ path: path.join(root, '.env') });
config({ path: path.join(root, '.env.local'), override: true });

function envPresent(name: string): boolean {
  const v = (process.env[name] || '').trim().replace(/^["']|["']$/g, '');
  return v.length > 0;
}

console.log(
  `[env] SUPABASE_URL=${envPresent('SUPABASE_URL') ? 'ok' : 'MISSING'} ` +
    `SERVICE_ROLE=${envPresent('SUPABASE_SERVICE_ROLE_KEY') ? 'ok' : 'MISSING'} ` +
    `CORE_CLIENT_ID=${envPresent('CORE_CLIENT_ID') ? 'ok' : 'MISSING'}`,
);

type Handler = (req: VercelRequest, res: VercelResponse) => unknown | Promise<unknown>;

async function loadHandlers(): Promise<Record<string, Handler>> {
  const ask = (await import('../api/ask')).default as Handler;
  const bqeConnect = (await import('../api/bqe/connect')).default as Handler;
  const bqeCallback = (await import('../api/bqe/callback')).default as Handler;
  const bqeStatus = (await import('../api/bqe/status')).default as Handler;
  const bqeSync = (await import('../api/bqe/sync')).default as Handler;
  return {
    '/api/ask': ask,
    '/api/bqe/connect': bqeConnect,
    '/api/bqe/callback': bqeCallback,
    '/api/bqe/status': bqeStatus,
    '/api/bqe/sync': bqeSync,
  };
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) {
        resolve(undefined);
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
    req.on('error', reject);
  });
}

function wrapRes(res: ServerResponse): VercelResponse {
  const out = res as VercelResponse;
  out.status = (code: number) => {
    res.statusCode = code;
    return out;
  };
  out.json = (body: unknown) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(body));
    return out;
  };
  out.send = (body: unknown) => {
    if (typeof body === 'object' && body !== null && !Buffer.isBuffer(body)) {
      return out.json(body);
    }
    res.end(body as string);
    return out;
  };
  out.redirect = (statusOrUrl: string | number, url?: string) => {
    if (typeof statusOrUrl === 'string') {
      res.statusCode = 302;
      res.setHeader('Location', statusOrUrl);
    } else {
      res.statusCode = statusOrUrl;
      res.setHeader('Location', url || '/');
    }
    res.end();
    return out;
  };
  return out;
}

async function main() {
  const port = Number(process.env.API_PORT || 8787);
  const handlers = await loadHandlers();

  const server = createServer(async (req, res) => {
    const parsed = parseUrl(req.url || '/', true);
    const path = (parsed.pathname || '/').replace(/\/$/, '') || '/';
    const handler = handlers[path];

    if (!handler) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: `No local API route for ${path}` }));
      return;
    }

    try {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method || '')
        ? await readBody(req)
        : undefined;
      const vReq = Object.assign(req, {
        query: parsed.query as VercelRequest['query'],
        body,
        cookies: {},
      }) as VercelRequest;
      await handler(vReq, wrapRes(res));
      if (!res.writableEnded) {
        // Handler returned without writing (e.g. early auth return already wrote)
      }
    } catch (e) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : 'API error' }));
      }
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`Local API listening on http://127.0.0.1:${port}`);
    console.log(`Routes: ${Object.keys(handlers).join(', ')}`);
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
