import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { DB } from '../server/db.js';
import { createServer } from '../server/server.js';
import { parseMenus } from '../scripts/scrape-mcmaster.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mnl-')), 'db.json');

async function withServer(fn) {
  const db = new DB(tmp());
  const srv = createServer({ db, adminToken: 't0k' }).listen(0);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try { await fn(base, db); } finally { srv.close(); }
}
const H = { authorization: 'Bearer t0k', 'content-type': 'application/json' };

test('admin API requires token', () => withServer(async (b) => {
  assert.equal((await fetch(b + '/api/admin/import', { method: 'POST', body: '{}' })).status, 401);
}));

test('bulk import, edit, persist, delete', () => withServer(async (b, db) => {
  const body = { locations: [{ name: 'Test Sub', type: 'restaurant', lat: 43.26, lon: -79.92 }], items: [{ locationId: 'test-sub', name: 'Turkey 6in', calories: 280, protein: 18, carbs: 46, fat: 3.5, source: 'photo' }] };
  assert.equal((await fetch(b + '/api/admin/import', { method: 'POST', headers: H, body: JSON.stringify(body) })).status, 200);
  let d = await (await fetch(b + '/api/data')).json();
  assert.equal(d.items[0].calories, 280);
  const id = encodeURIComponent(d.items[0].id);
  await fetch(`${b}/api/admin/items/${id}`, { method: 'PUT', headers: H, body: JSON.stringify({ ...d.items[0], calories: 300 }) });
  assert.equal(new DB(db.file).data.items[0].calories, 300);
  assert.equal(new DB(db.file).data.items[0].locked, true);
  await fetch(`${b}/api/admin/locations/test-sub`, { method: 'DELETE', headers: H });
  d = await (await fetch(b + '/api/data')).json();
  assert.equal(d.items.length + d.locations.length, 0);
}));

test('rejects items for unknown location / bad numbers', () => withServer(async (b) => {
  let r = await fetch(b + '/api/admin/items', { method: 'POST', headers: H, body: JSON.stringify({ locationId: 'nope', name: 'x' }) });
  assert.equal(r.status, 400);
}));

test('scraper replacement keeps locked (hand-edited) items', () => {
  const db = new DB(tmp());
  db.upsertLocation({ name: 'Hall', id: 'mac-hall' });
  db.upsertItem({ locationId: 'mac-hall', name: 'Soup', calories: 100, source: 'mcmaster', locked: true });
  db.upsertItem({ locationId: 'mac-hall', name: 'Old', calories: 1, source: 'mcmaster' });
  db.replaceScraped('mcmaster', ['mac-hall'], [{ locationId: 'mac-hall', name: 'Soup', calories: 999 }, { locationId: 'mac-hall', name: 'New', calories: 5 }]);
  const names = Object.fromEntries(db.data.items.map((i) => [i.name, i.calories]));
  assert.deepEqual(names, { Soup: 100, New: 5 });
});

test('parseMenus reads a table with a Calories column', () => {
  const html = '<h3>Bistro</h3><table><tr><th>Item</th><th>Serving</th><th>Calories</th><th>Protein (g)</th><th>Carbs (g)</th><th>Fat (g)</th></tr><tr><td>Wrap</td><td>1</td><td>410 kcal</td><td>22</td><td>40</td><td>17</td></tr></table>';
  assert.deepEqual(parseMenus(html), [{ label: 'Bistro', name: 'Wrap', serving: '1', calories: 410, protein: 22, carbs: 40, fat: 17, fiber: null, sugar: null, sodium: null }]);
});
