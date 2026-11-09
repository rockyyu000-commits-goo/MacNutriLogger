import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DB } from '../server/db.js';
import { createServer } from '../server/server.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mnl-')), 'db.json');
const H = { authorization: 'Bearer t0k', 'content-type': 'application/json' };

async function withServer(fn, { adminToken = 't0k' } = {}) {
  const db = new DB(tmp());
  const srv = createServer({ db, adminToken }).listen(0, '127.0.0.1');
  await new Promise((r) => srv.once('listening', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = (method, p, body, headers = H) => fetch(base + p, { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
  try { await fn({ base, db, call }); } finally { srv.closeAllConnections(); srv.close(); }
}
const MENU = {
  locations: [{ name: 'Test Sub' }],
  items: [{ locationId: 'test-sub', name: 'Turkey 6in', calories: 280, protein: 18, carbs: 46, fat: 3.5, source: 'photo', flags: ['suspect-calories'] }],
};

test('admin API needs the right token, and is off without one', async () => {
  await withServer(async ({ call }) => {
    assert.equal((await call('POST', '/api/admin/import', {}, {})).status, 401);
    assert.equal((await call('POST', '/api/admin/import', {}, { authorization: 'Bearer wrong' })).status, 401);
    assert.equal((await call('GET', '/api/admin/ping')).status, 200);
  });
  await withServer(async ({ call }) => {
    const r = await call('GET', '/api/admin/ping', undefined, { authorization: 'Bearer undefined' });
    assert.equal(r.status, 401);
    assert.match((await r.json()).error, /ADMIN_TOKEN/);
  }, { adminToken: null });
});

test('import, read, edit, persist, delete', () => withServer(async ({ call, db }) => {
  assert.deepEqual(await (await call('POST', '/api/admin/import', MENU)).json(), { locations: 1, items: 1 });
  let d = await (await call('GET', '/api/data')).json();
  assert.equal(d.items[0].calories, 280);
  assert.equal(typeof d.version, 'string');

  const id = encodeURIComponent(d.items[0].id);
  const put = await (await call('PUT', `/api/admin/items/${id}`, { calories: 300 })).json();
  assert.deepEqual([put.calories, put.protein, put.locked, put.flags], [300, 18, true, []]);
  assert.equal(new DB(db.file).items.get(d.items[0].id).calories, 300, 'saved to disk');

  const loc = await (await call('PUT', '/api/admin/locations/test-sub', { address: '1 Main St W' })).json();
  assert.deepEqual([loc.name, loc.address], ['Test Sub', '1 Main St W']);

  const added = await (await call('POST', '/api/admin/items', { locationId: 'test-sub', name: 'Cookie', calories: 200 })).json();
  assert.equal((await call('DELETE', `/api/admin/items/${encodeURIComponent(added.id)}`)).status, 200);
  assert.equal((await call('DELETE', '/api/admin/locations/test-sub')).status, 200);
  d = await (await call('GET', '/api/data')).json();
  assert.equal(d.items.length + d.locations.length, 0);
}));

test('bad requests get clear 4xx answers', () => withServer(async ({ call }) => {
  await call('POST', '/api/admin/import', MENU);
  const cases = [
    ['POST', '/api/admin/items', { locationId: 'nope', name: 'x' }, 400, /unknown locationId/],
    ['POST', '/api/admin/items', { locationId: 'test-sub', name: 'x', calories: 'many' }, 400, /must be a number/],
    ['POST', '/api/admin/import', '{not json', 400, /invalid JSON/],
    ['POST', '/api/admin/import', '[1]', 400, /must be an object/],
    ['PUT', '/api/admin/items/missing', { calories: 1 }, 404, /no item/],
    ['DELETE', '/api/admin/locations/missing', undefined, 404, /no location/],
    ['GET', '/api/admin/nothing', undefined, 404, /not found/],
    ['GET', '/api/nothing', undefined, 404, /not found/],
    ['POST', '/api/data', {}, 405, /not allowed/],
  ];
  for (const [method, p, body, status, message] of cases) {
    const r = await call(method, p, body);
    assert.equal(r.status, status, `${method} ${p}`);
    assert.match((await r.json()).error, message);
  }
}));

test('/api/data: ETag revalidation, changes on edit, gzip', () => withServer(async ({ base, call }) => {
  await call('POST', '/api/admin/import', MENU);
  const first = await fetch(base + '/api/data');
  const etag = first.headers.get('etag');
  assert.ok(etag);
  assert.equal(first.headers.get('content-encoding'), 'gzip');
  assert.equal((await fetch(base + '/api/data', { headers: { 'if-none-match': etag } })).status, 304);
  await call('PUT', '/api/admin/locations/test-sub', { cuisine: 'Subs' });
  const after = await fetch(base + '/api/data', { headers: { 'if-none-match': etag } });
  assert.equal(after.status, 200);
  assert.notEqual(after.headers.get('etag'), etag);
  const plain = await fetch(base + '/api/data', { headers: { 'accept-encoding': 'identity' } });
  assert.equal(plain.headers.get('content-encoding'), null);
  assert.equal((await plain.json()).locations[0].cuisine, 'Subs');
}));

test('export downloads the whole menu', () => withServer(async ({ call }) => {
  await call('POST', '/api/admin/import', MENU);
  const r = await call('GET', '/api/admin/export');
  assert.match(r.headers.get('content-disposition'), /attachment; filename="macnutrilogger-menu-/);
  const d = await r.json();
  assert.deepEqual([d.locations.length, d.items.length], [1, 1]);
}));

test('static files: app shell, headers, no path traversal', () => withServer(async ({ base }) => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(home.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(home.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await home.text(), /MacNutriLogger/);

  assert.equal((await fetch(base + '/admin')).status, 200);
  assert.match((await fetch(base + '/js/main.js')).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json; charset=utf-8');
  assert.equal((await fetch(base + '/js/main.js', { method: 'HEAD' })).status, 200);

  for (const p of ['/nope.html', '/js', '/%2e%2e/package.json', '/..%2f..%2fpackage.json', '/%00', '/%E0%A4%A']) {
    const r = await fetch(base + p);
    assert.ok([400, 404].includes(r.status), `${p} -> ${r.status}`);
  }
  assert.equal((await fetch(base + '/', { method: 'POST' })).status, 405);
}));

test('every file the service worker precaches exists', () => withServer(async ({ base }) => {
  const sw = await (await fetch(base + '/sw.js')).text();
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(shell.length > 10);
  for (const p of shell) assert.equal((await fetch(base + p)).status, 200, p);
  // ...and every app module is precached, so the app works offline after one visit.
  const dir = new URL('../public/js/', import.meta.url);
  const modules = fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.js') && f !== 'admin.js').map((f) => '/js/' + f.split(path.sep).join('/'));
  for (const m of modules) assert.ok(shell.includes(m), `${m} is in the service worker's SHELL list`);
}));
