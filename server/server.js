// HTTP server: static PWA + a small JSON API. No dependencies.
//   GET  /api/data                      all locations + items (gzip, ETag)
//   GET  /api/health
//   GET  /api/admin/ping | export       (admin routes need "Authorization: Bearer $ADMIN_TOKEN")
//   POST /api/admin/import              bulk upsert { locations, items }
//   POST|PUT|DELETE /api/admin/locations[/:id]
//   POST|PUT|DELETE /api/admin/items[/:id]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DB, ValidationError } from './db.js';
import { seedAll } from './seed.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
};
const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
};
const MAX_BODY = 8e6;

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const sha = (s) => crypto.createHash('sha256').update(s).digest();
const safeEqual = (a, b) => crypto.timingSafeEqual(sha(a), sha(b)); // hashing first makes lengths equal

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= MAX_BODY) chunks.push(c); });
    req.on('error', reject);
    req.on('end', () => {
      if (size > MAX_BODY) return reject(new HttpError(413, 'request body too large'));
      if (!size) return resolve({});
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new HttpError(400, 'invalid JSON')); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reject(new HttpError(400, 'JSON body must be an object'));
      resolve(body);
    });
  });
}

export function createServer({ db, adminToken, publicDir = path.join(ROOT, 'public') }) {
  publicDir = path.resolve(publicDir);

  /** Send a body with ETag / 304, optional gzip, and HEAD support. */
  function send(req, res, status, headers, body, gz) {
    const h = { ...SECURITY_HEADERS, ...headers };
    if (h.etag && req.headers['if-none-match'] === h.etag) { res.writeHead(304, h); return res.end(); }
    if (gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      body = gz;
      h['content-encoding'] = 'gzip';
    }
    if (gz) h.vary = 'accept-encoding';
    h['content-length'] = body.length;
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : body);
  }
  const json = (req, res, status, obj) =>
    send(req, res, status, { 'content-type': MIME['.json'], 'cache-control': 'no-store' }, Buffer.from(JSON.stringify(obj)));

  // /api/data is the whole menu (~2 MB): serialize + gzip once per database revision.
  let cache = null;
  function menuPayload() {
    if (cache?.revision !== db.revision) {
      const data = db.data;
      const version = crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex').slice(0, 16);
      const raw = Buffer.from(JSON.stringify({ version, ...data }));
      cache = { revision: db.revision, etag: `"${version}"`, raw, gz: zlib.gzipSync(raw) };
    }
    return cache;
  }

  function requireAdmin(req) {
    if (!adminToken) throw new HttpError(401, 'admin API disabled: start the server with ADMIN_TOKEN set');
    if (!safeEqual(req.headers.authorization || '', `Bearer ${adminToken}`)) throw new HttpError(401, 'unauthorized');
  }

  async function admin(req, res, segments) {
    requireAdmin(req);
    const [kind, rawId] = segments;
    const id = rawId == null ? null : decodeURIComponent(rawId);
    const m = req.method;
    const body = m === 'POST' || m === 'PUT' ? await readJson(req) : null;
    const done = (obj) => json(req, res, 200, obj);
    const saved = (rec) => { db.save(); return done(rec); };

    if (kind === 'ping' && m === 'GET') return done({ ok: true, locations: db.locations.size, items: db.items.size });
    if (kind === 'export' && m === 'GET') {
      return send(req, res, 200, {
        'content-type': MIME['.json'], 'cache-control': 'no-store',
        'content-disposition': `attachment; filename="macnutrilogger-menu-${new Date().toISOString().slice(0, 10)}.json"`,
      }, Buffer.from(JSON.stringify(db.data, null, 1)));
    }
    if (kind === 'import' && m === 'POST') return done(db.bulk(body));

    if (kind === 'locations') {
      if (m === 'POST' && !id) return saved(db.upsertLocation(body));
      if (id && !db.locations.has(id)) throw new HttpError(404, `no location ${id}`);
      if (m === 'PUT' && id) return saved(db.patchLocation(id, body));
      if (m === 'DELETE' && id) { db.deleteLocation(id); return saved({ ok: true }); }
    }
    if (kind === 'items') {
      if (m === 'POST' && !id) return saved(db.upsertItem(body));
      if (id && !db.items.has(id)) throw new HttpError(404, `no item ${id}`);
      if (m === 'PUT' && id) return saved(db.patchItem(id, body));
      if (m === 'DELETE' && id) { db.deleteItem(id); return saved({ ok: true }); }
    }
    throw new HttpError(404, 'not found');
  }

  function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
    let rel;
    try { rel = decodeURIComponent(pathname); } catch { throw new HttpError(400, 'bad path'); }
    if (rel.includes('\0')) throw new HttpError(400, 'bad path');
    if (rel === '/') rel = '/index.html';
    if (rel === '/admin') rel = '/admin.html';
    const file = path.resolve(publicDir, '.' + path.posix.normalize(rel));
    if (!file.startsWith(publicDir + path.sep)) throw new HttpError(404, 'not found');
    let stat;
    try { stat = fs.statSync(file); } catch { throw new HttpError(404, 'not found'); }
    if (!stat.isFile()) throw new HttpError(404, 'not found');
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const body = fs.readFileSync(file);
    const compressible = /^(text|application\/(json|manifest)|image\/svg)/.test(type) && body.length > 1024;
    send(req, res, 200, {
      'content-type': type,
      // Always revalidate: the service worker + ETag keep this cheap and make updates show up.
      'cache-control': 'no-cache',
      etag: `"${stat.size.toString(36)}-${Math.round(stat.mtimeMs).toString(36)}"`,
    }, body, compressible ? zlib.gzipSync(body) : undefined);
  }

  return http.createServer(async (req, res) => {
    try {
      const { pathname } = new URL(req.url, 'http://localhost');
      if (pathname === '/api/data') {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method not allowed');
        const c = menuPayload();
        return send(req, res, 200, { 'content-type': MIME['.json'], 'cache-control': 'no-cache', etag: c.etag }, c.raw, c.gz);
      }
      if (pathname === '/api/health') return json(req, res, 200, { ok: true, locations: db.locations.size, items: db.items.size });
      if (pathname.startsWith('/api/admin/')) return await admin(req, res, pathname.slice('/api/admin/'.length).split('/'));
      if (pathname.startsWith('/api/')) throw new HttpError(404, 'not found');
      serveStatic(req, res, pathname);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : e instanceof ValidationError || e instanceof URIError ? 400 : 500;
      if (status === 500) console.error(e);
      if (res.headersSent) return res.end();
      json(req, res, status, { error: status === 500 ? 'internal error' : e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = new DB(process.env.DB_FILE || path.join(ROOT, 'data', 'db.json'));
  seedAll(db, path.join(ROOT, 'data', 'seed'), console.log);
  const port = Number(process.env.PORT) || 3000;
  const host = process.env.HOST || '127.0.0.1';
  if (!process.env.ADMIN_TOKEN) console.warn('ADMIN_TOKEN not set: admin API disabled');
  const server = createServer({ db, adminToken: process.env.ADMIN_TOKEN });
  server.listen(port, host, () => {
    console.log(`MacNutriLogger: ${db.locations.size} places, ${db.items.size} items`);
    console.log(`http://${host === '0.0.0.0' || host === '127.0.0.1' ? 'localhost' : host}:${port}`);
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
}
