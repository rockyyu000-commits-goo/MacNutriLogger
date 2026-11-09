import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB, ValidationError, cleanItem, cleanLocation, slug } from '../server/db.js';
import { parseCsv, rowsToData } from '../server/mcmaster-csv.js';
import { seedAll } from '../server/seed.js';

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mnl-')), 'db.json');
const SEED = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'seed');

test('slug and default ids', () => {
  assert.equal(slug("Smoke's Poutinerie – Westdale"), 'smoke-s-poutinerie-westdale');
  assert.equal(cleanLocation({ name: ' Test Sub ' }).id, 'test-sub');
  assert.equal(cleanItem({ locationId: 'test-sub', name: 'Turkey', serving: '6 in' }).id, 'test-sub--turkey-6-in');
});

test('cleanItem validates and normalizes', () => {
  const i = cleanItem({ locationId: 'x', name: 'A', calories: '280', protein: '', fat: 3.5, flags: 'nope' });
  assert.equal(i.calories, 280);
  assert.equal(i.protein, null);
  assert.equal(i.fat, 3.5);
  assert.deepEqual(i.flags, []);
  assert.equal(i.source, 'manual');
  assert.throws(() => cleanItem({ locationId: 'x', name: 'A', calories: 'lots' }), ValidationError);
  assert.throws(() => cleanItem({ name: 'A' }), ValidationError);
  assert.throws(() => cleanLocation({}), ValidationError);
  assert.equal(cleanLocation({ name: 'A', type: 'spaceship' }).type, 'restaurant');
});

test('persists atomically and reloads', () => {
  const file = tmp();
  const db = new DB(file);
  db.upsertLocation({ name: 'Hall' });
  db.upsertItem({ locationId: 'hall', name: 'Soup', calories: 100 });
  db.save();
  assert.equal(fs.existsSync(file + '.tmp'), false);
  const again = new DB(file);
  assert.equal(again.items.get('hall--soup').calories, 100);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))), ['locations', 'items']);
});

test('items need a known location; deleting a location removes its items', () => {
  const db = new DB(tmp());
  assert.throws(() => db.upsertItem({ locationId: 'nope', name: 'x' }), /unknown locationId/);
  db.upsertLocation({ name: 'Hall' });
  db.upsertItem({ locationId: 'hall', name: 'Soup' });
  db.deleteLocation('hall');
  assert.equal(db.items.size + db.locations.size, 0);
});

test('bulk is all-or-nothing', () => {
  const db = new DB(tmp());
  assert.throws(() => db.bulk({ locations: [{ name: 'A' }], items: [{ locationId: 'a', name: 'ok' }, { locationId: 'b', name: 'orphan' }] }), /unknown locationId b/);
  assert.equal(db.locations.size, 0);
  assert.deepEqual(db.bulk({ locations: [{ name: 'A' }], items: [{ locationId: 'a', name: 'ok' }] }), { locations: 1, items: 1 });
  assert.throws(() => db.bulk({ items: 'x' }), ValidationError);
  db.patchLocation('a', { brand: 'A Corp', address: '1 Main' });
  db.bulk({ locations: [{ name: 'A', address: '2 Main' }] });
  assert.deepEqual([db.locations.get('a').brand, db.locations.get('a').address], ['A Corp', '2 Main'], 'existing places are merged');
});

test('patchItem is partial, locks, and clears the warnings the edit fixes', () => {
  const db = new DB(tmp());
  db.upsertLocation({ name: 'Hall' });
  db.upsertItem({ locationId: 'hall', name: 'Bowl', calories: 29696, protein: 50, flags: ['suspect-calories', 'verify-name', 'calories-only'] });
  const rec = db.patchItem('hall--bowl', { calories: 690 });
  assert.equal(rec.calories, 690);
  assert.equal(rec.protein, 50);
  assert.equal(rec.locked, true);
  assert.deepEqual(rec.flags, ['verify-name', 'calories-only']);
  assert.deepEqual(db.patchItem('hall--bowl', { name: 'Pork Bowl' }).flags, ['calories-only']);
  assert.equal(db.items.has('hall--bowl'), true, 'renaming keeps the id');
});

test('patchLocation keeps untouched fields', () => {
  const db = new DB(tmp());
  db.upsertLocation({ name: 'Subway', brand: 'Subway', address: '1 Main' });
  const rec = db.patchLocation('subway', { address: '2 Main', active: false });
  assert.deepEqual([rec.brand, rec.address, rec.active], ['Subway', '2 Main', false]);
});

test('replaceScraped keeps locked (hand-edited) items', () => {
  const db = new DB(tmp());
  db.upsertLocation({ name: 'Hall', id: 'mac-hall' });
  db.upsertItem({ locationId: 'mac-hall', name: 'Soup', calories: 100, source: 'mcmaster', locked: true });
  db.upsertItem({ locationId: 'mac-hall', name: 'Old', calories: 1, source: 'mcmaster' });
  db.upsertItem({ locationId: 'mac-hall', name: 'Mine', calories: 7, source: 'manual' });
  db.replaceScraped('mcmaster', ['mac-hall'], [{ locationId: 'mac-hall', name: 'Soup', calories: 999 }, { locationId: 'mac-hall', name: 'New', calories: 5 }]);
  assert.deepEqual(Object.fromEntries(db.data.items.map((i) => [i.name, i.calories])), { Soup: 100, Mine: 7, New: 5 });
});

test('seedLocations adds missing places without overwriting edits', () => {
  const db = new DB(tmp());
  assert.equal(db.seedLocations([{ name: 'Subway', brand: 'Subway' }]), 1);
  db.patchLocation('subway', { address: 'edited' });
  assert.equal(db.seedLocations([{ name: 'Subway', address: 'seed' }]), 0);
  assert.equal(db.locations.get('subway').address, 'edited');
});

test('seedItems loads chain items once and only for known places', () => {
  const db = new DB(tmp());
  db.upsertLocation({ name: 'Subway' });
  const items = [{ locationId: 'subway', name: 'Turkey', calories: 1 }];
  assert.equal(db.seedItems(items), 1);
  assert.equal(db.seedItems(items), 0);
  assert.equal(db.seedItems([{ locationId: 'nowhere', name: 'x' }]), 0);
  assert.equal(db.items.get('subway--turkey').source, 'chain');
});

test('CSV: quoted fields, CRLF, BOM', () => {
  const rows = parseCsv('\uFEFFa,b\r\n"x, ""y""",2\r\n\r\n3,"multi\nline"\r\n');
  assert.deepEqual(rows, [{ a: 'x, "y"', b: '2' }, { a: '3', b: 'multi\nline' }]);
  assert.deepEqual(parseCsv(''), []);
});

test('CSV import: normalizes serving, dedupes, keeps variants, flags absurd calories', () => {
  const csv = 'location,tab,course,name,serving_unit,price,calories_kcal,fat_g,sat_fat_g,cholesterol_mg,sodium_mg,carbs_g,fiber_g,sugars_g,protein_g,vitamin_c_mg,calcium_mg,iron_mg\n' +
    'Centro,LUNCH,Soup,"Soup, Tomato",100g,3.5,120,4,1,0,300,18,2,6,3,0,0,0\n' +
    'Centro,LUNCH,Soup,"Soup, Tomato",100g,3.5,120,4,1,0,300,18,2,6,3,0,0,0\n' +
    'Centro,LUNCH,Soup,"Soup, Tomato",100g,3.5,240,8,2,0,600,36,4,12,6,0,0,0\n' +
    'Centro,LUNCH,Bowl,Pulled Pork Bowl,Portion,,29696,40,5,0,900,60,5,5,50,0,0,0\n' +
    'Café One,ALL DAY,Other,No Data,,,,,,,,,,,,,,\n';
  const { locations, items } = rowsToData(parseCsv(csv));
  assert.deepEqual(locations, [{ id: 'mac-centro', name: 'Centro', type: 'dining_hall', source: 'mcmaster' }]);
  assert.deepEqual(items.map((i) => i.id), ['mac-centro--lunch--soup-tomato', 'mac-centro--lunch--soup-tomato-2', 'mac-centro--lunch--pulled-pork-bowl']);
  assert.equal(items[0].serving, 'Portion');
  assert.equal(items[0].category, 'Lunch');
  assert.equal(items[2].price, null);
  assert.deepEqual(items[2].flags, ['suspect-calories']);
});

test('the bundled seed data loads cleanly and seeding is idempotent', () => {
  const file = tmp();
  const db = new DB(file);
  const first = seedAll(db, SEED);
  assert.ok(first.mcmaster > 1000, 'McMaster menu');
  assert.ok(first.restaurants > 50, 'nearby restaurants');
  assert.ok(Object.keys(first.chains).length >= 9, 'chain files');
  const counts = [db.locations.size, db.items.size];
  for (const i of db.items.values()) assert.ok(db.locations.has(i.locationId), `${i.id} has a place`);

  const again = new DB(file);
  const second = seedAll(again, SEED);
  assert.deepEqual([second.mcmaster, second.restaurants, second.chains], [0, 0, {}]);
  assert.deepEqual([again.locations.size, again.items.size], counts);
});
