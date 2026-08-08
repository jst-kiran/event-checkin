/**
 * Runs the /api serverless functions inside the Vite dev server.
 *
 * This is a development convenience and nothing more — it never ships. Vite's
 * middleware hands over Node's own `req` and `res`, which is exactly what
 * Vercel hands a Node function, so the handlers under /api run here unmodified.
 * There is no adapter and no second implementation to drift out of sync, and
 * production still has no server process of any kind.
 *
 * Modules are imported fresh on every request so editing a handler takes effect
 * without restarting the dev server.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API_DIR = path.resolve(process.cwd(), 'api');

/**
 * Maps a URL path to a handler file.
 *
 * Returns null for anything that escapes /api or reaches into _lib — the same
 * two rules Vercel applies when it decides what is a function.
 */
function resolveHandler(urlPath) {
  const relative = urlPath.replace(/^\/api\/?/, '').replace(/\/+$/, '');
  if (!relative || relative.includes('..') || relative.includes('\0')) return null;

  const file = path.resolve(API_DIR, `${relative}.js`);
  if (!file.startsWith(API_DIR + path.sep)) return null;
  if (path.relative(API_DIR, file).split(path.sep).some((part) => part.startsWith('_'))) return null;

  return fs.existsSync(file) ? file : null;
}

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.end(JSON.stringify(payload));
}

export default function devApiPlugin() {
  return {
    name: 'event-checkin-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url, 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        const file = resolveHandler(url.pathname);
        if (!file) return sendJson(res, 404, { success: false, status: 'NOT_FOUND' });

        try {
          // The query string busts Node's module cache on every request.
          const module = await import(`${pathToFileURL(file).href}?t=${Date.now()}`);
          await module.default(req, res);
        } catch (error) {
          console.error(`[dev-api] ${url.pathname}`, error);
          if (!res.writableEnded) {
            sendJson(res, 500, { success: false, status: 'INTERNAL_ERROR' });
          }
        }
      });
    },
  };
}
