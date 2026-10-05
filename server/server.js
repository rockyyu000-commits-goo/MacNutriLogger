import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DB } from './db.js';
import { parseCsv, rowsToData } from '../scripts/import-csv.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };

const safeEqual = (a, b) => {
  const x = crypto.createHash('sha256').update(a).digest(), y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
};

export function createServer({ db, adminToken }) {
  const send = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
  const readBody = (req) => new Promise((resolve, reject) => {
    let s = '';
    req.on('data', (c) => { s += c; if (s.length > 5e6) reject(new Error('too large')); });
    req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } });
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    try {
      if (p === '/api/data' && req.method === 'GET') {
        return send(res, 200, { ...db.data, generatedAt: new Date().toISOString() });
      }
      if (p.startsWith('/api/admin/')) {
        if (!adminToken || !safeEqual(req.headers.authorization || '', `Bearer ${adminToken}`)) return send(res, 401, { error: 'unauthorized' });
        const [, , , kind, id] = p.split('/');
        const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {};
        if (kind === 'import' && req.method === 'POST') return send(res, 200, db.bulk(body));
        if (kind === 'locations' && req.method === 'PUT') { const r = db.upsertLocation({ ...body, id: decodeURIComponent(id) }); db.save(); return send(res, 200, r); }
        if (kind === 'locations' && req.method === 'DELETE') { db.deleteLocation(decodeURIComponent(id)); db.save(); return send(res, 200, { ok: true }); }
        if (kind === 'items' && req.method === 'POST') { const r = db.upsertItem(body); db.save(); return send(res, 200, r); }
        if (kind === 'items' && req.method === 'PUT') { const r = db.upsertItem({ ...body, id: decodeURIComponent(id), locked: true }); db.save(); return send(res, 200, r); }
        if (kind === 'items' && req.method === 'DELETE') { db.deleteItem(decodeURIComponent(id)); db.save(); return send(res, 200, { ok: true }); }
        return send(res, 404, { error: 'not found' });
      }
      // static files
      let f = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : p));
      if (!f.startsWith(PUBLIC + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    } catch (e) {
      send(res, 400, { error: e.message });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = new DB(process.env.DB_FILE || path.join(ROOT, 'data', 'db.json'));
  const seedDir = path.join(ROOT, 'data', 'seed');
  const menuCsv = path.join(seedDir, 'mcmaster_menu.csv');
  if (!db.data.items.length && fs.existsSync(menuCsv)) { db.bulk(rowsToData(parseCsv(fs.readFileSync(menuCsv, 'utf8')))); console.log('Seeded McMaster menus'); }
  const nearby = path.join(seedDir, 'nearby_restaurants.json');
  if (fs.existsSync(nearby)) { const n = db.seedLocations(JSON.parse(fs.readFileSync(nearby, 'utf8')).locations); if (n) console.log(`Seeded ${n} restaurants`); }
  const chainDir = path.join(seedDir, 'chains');
  if (fs.existsSync(chainDir)) for (const f of fs.readdirSync(chainDir).filter((x) => x.endsWith('.json'))) { const n = db.seedItems(JSON.parse(fs.readFileSync(path.join(chainDir, f), 'utf8')).items); if (n) console.log(`Seeded ${n} items from ${f}`); }
  const port = process.env.PORT || 3000;
  if (!process.env.ADMIN_TOKEN) console.warn('ADMIN_TOKEN not set: admin API disabled');
  createServer({ db, adminToken: process.env.ADMIN_TOKEN }).listen(port, process.env.HOST || '127.0.0.1', () => console.log(`http://localhost:${port}`));
}
