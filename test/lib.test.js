// Tests for the browser-side logic that has no DOM dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, dateKey, flagNotes, fmt, friendlyDate, hasWarning, isDateKey, kcalFromMacros, macroLine, mealForTime, scale, servingLine, snapshot, totals,
} from '../public/js/lib/nutrition.js';
import { buildIndex, normalize, search } from '../public/js/lib/search.js';
import { Store, cleanEntry, entryFromItem } from '../public/js/lib/store.js';

/** Minimal Web Storage stand-in. */
function memoryStorage(initial = {}) {
  const m = new Map(Object.entries(initial));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
const WRAP = { id: 'bistro--wrap', locationId: 'bistro', name: 'Chicken Wrap', serving: 'Portion', calories: 410, protein: 22, carbs: 40, fat: 17, sodium: 900, fiber: null, price: 9.5, flags: [] };

test('fmt rounds for display', () => {
  assert.deepEqual([fmt(410.4), fmt(3.46), fmt(0), fmt(null), fmt(-0.01), fmt(9.96)], ['410', '3.5', '0', '–', '0', '10']);
});

test('snapshot / scale / totals', () => {
  const n = snapshot(WRAP);
  assert.deepEqual(n, { calories: 410, protein: 22, carbs: 40, fat: 17, sodium: 900 }, 'no price, no nulls');
  assert.deepEqual(scale(n, 1.5), { calories: 615, protein: 33, carbs: 60, fat: 25.5, sodium: 1350 });
  assert.deepEqual(totals([{ qty: 2, n }, { qty: 1, n: { calories: 100 } }]), { calories: 920, protein: 44, carbs: 80, fat: 34 });
  assert.equal(kcalFromMacros({ protein: 150, carbs: 250, fat: 70 }), 2230);
});

test('labels', () => {
  assert.equal(macroLine(WRAP), '410 kcal · P 22 · C 40 · F 17');
  assert.equal(macroLine({ calories: 250 }, 2), '500 kcal');
  assert.equal(macroLine({}), '? kcal');
  assert.equal(servingLine('Portion', 1), 'Portion');
  assert.equal(servingLine('Portion', 1.5), '1.5 × Portion');
  assert.equal(servingLine(null, 2), '2 × serving');
});

test('meal follows the clock', () => {
  const at = (h, m = 0) => mealForTime(new Date(2026, 10, 9, h, m));
  assert.deepEqual([at(8), at(10, 45), at(13), at(16), at(18, 30), at(23), at(2)], ['breakfast', 'lunch', 'lunch', 'snacks', 'dinner', 'snacks', 'snacks']);
});

test('dates are local calendar days', () => {
  assert.equal(dateKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09', 'DST change');
  assert.deepEqual([isDateKey('2026-11-09'), isDateKey('2026-13-01'), isDateKey('2026-02-30'), isDateKey('x')], [true, false, false, false]);
  assert.deepEqual(['2026-11-09', '2026-11-08', '2026-11-10'].map((d) => friendlyDate(d, '2026-11-09')), ['Today', 'Yesterday', 'Tomorrow']);
  assert.match(friendlyDate('2026-11-02', '2026-11-09'), /Nov/);
});

test('flags: warnings vs notes', () => {
  assert.equal(hasWarning({ flags: ['calories-only', 'scaled-x2'] }), false);
  assert.equal(hasWarning({ flags: ['suspect-calories'] }), true);
  assert.equal(hasWarning({}), false);
  assert.deepEqual(flagNotes({ flags: ['kcal-vs-macros-mismatch', 'scaled-x1.5', 'unknown-flag'] }).map((n) => n.level), ['warn', 'info']);
  assert.match(flagNotes({ flags: ['scaled-x1.5'] })[0].text, /1\.5×/);
});

test('search: all words must match, names beat categories, accents ignored', () => {
  const locs = new Map([['cafe', { id: 'cafe', name: 'Café One' }], ['sub', { id: 'sub', name: 'Subway', brand: 'Subway' }]]);
  const items = [
    { id: '1', locationId: 'cafe', name: 'Crêpe, Chicken & Pesto', category: 'Lunch', calories: 500, protein: 30 },
    { id: '2', locationId: 'sub', name: 'Rotisserie-Style Chicken', category: '6" Chicken Subs', calories: 350, protein: 29 },
    { id: '3', locationId: 'sub', name: 'Veggie Delite', category: '6" Chicken Subs', calories: 230, protein: 9 },
    { id: '4', locationId: 'sub', name: 'Chicken', category: 'Protein', calories: 100, protein: 20 },
    { id: '5', locationId: 'sub', name: 'Cookie', category: 'Desserts', calories: 220 },
  ];
  const index = buildIndex(items, locs);
  const ids = (q, opts) => search(index, q, opts).items.map((i) => i.id);
  assert.equal(normalize('Crêpe, Chicken & Pesto'), 'crepe chicken pesto');
  assert.deepEqual(ids('chicken'), ['4', '1', '2', '3'], 'exact name first, category-only match last');
  assert.deepEqual(ids('crepe pesto'), ['1']);
  assert.deepEqual(ids('subway chick'), ['4', '2', '3']);
  assert.deepEqual(ids('pizza'), []);
  assert.deepEqual(ids('lite'), ['3'], 'longer fragments match mid-word');
  assert.deepEqual(ids('oki'), [], 'short fragments only match the start of a word');
  assert.deepEqual(ids('', { sort: 'protein-desc' }), ['1', '2', '4', '3', '5'], 'no protein value sorts last');
  assert.deepEqual(ids('', { sort: 'kcal-asc', limit: 2 }), ['4', '5']);
  assert.deepEqual(ids('', { sort: 'density-desc', limit: 1 }), ['4']);
  assert.deepEqual(ids('chicken', { filter: (i) => i.locationId === 'cafe' }), ['1']);
  assert.equal(search(index, 'chicken', { limit: 1 }).total, 4);
});

test('store: add, edit, remove, per-day totals', () => {
  const s = new Store(memoryStorage());
  const e = s.addEntry('2026-11-09', entryFromItem(WRAP, { qty: 2, meal: 'lunch', place: 'Bistro' }));
  assert.deepEqual([e.itemId, e.name, e.place, e.serving, e.qty, e.meal], ['bistro--wrap', 'Chicken Wrap', 'Bistro', 'Portion', 2, 'lunch']);
  s.updateEntry('2026-11-09', e.id, { qty: 0.5, meal: 'dinner' });
  assert.deepEqual(s.getLog('2026-11-09').map((x) => [x.id, x.qty, x.meal]), [[e.id, 0.5, 'dinner']]);
  assert.equal(s.history('2026-11-09', 2)[1].calories, 205);
  assert.deepEqual(s.logDates(), ['2026-11-09']);
  s.removeEntry('2026-11-09', e.id);
  assert.deepEqual(s.logDates(), [], 'empty days are not kept');
});

test('store: a logged entry keeps its numbers when the menu changes later', () => {
  const s = new Store(memoryStorage());
  const item = { ...WRAP };
  s.addEntry('2026-11-09', entryFromItem(item));
  item.calories = 999;
  assert.equal(s.getLog('2026-11-09')[0].n.calories, 410);
});

test('store: cleanEntry repairs bad data', () => {
  assert.equal(cleanEntry(null), null);
  assert.equal(cleanEntry({ n: {} }), null);
  const e = cleanEntry({ name: 'x', qty: -3, meal: 'brunch', n: { calories: 'abc', protein: 5 } });
  assert.deepEqual([e.qty, e.meal, e.n], [1, 'snacks', { protein: 5 }]);
});

test('store: goals fall back to defaults', () => {
  const s = new Store(memoryStorage());
  assert.deepEqual(s.getGoals(), { calories: 2200, protein: 150, carbs: 250, fat: 70 });
  s.setGoals({ protein: 180, fat: 0 });
  assert.deepEqual(s.getGoals(), { calories: 2200, protein: 180, carbs: 250, fat: 70 });
});

test('store: favourites toggle', () => {
  const s = new Store(memoryStorage());
  assert.equal(s.toggleFavPlace('subway'), true);
  assert.equal(s.toggleFavItem('a'), true);
  assert.equal(s.toggleFavPlace('subway'), false);
  assert.deepEqual([s.favPlaces(), s.favItems()], [[], ['a']]);
});

test('store: recent lists distinct foods, newest first', () => {
  const s = new Store(memoryStorage());
  s.addEntry('2026-11-07', { ...entryFromItem(WRAP), at: 1 });
  s.addEntry('2026-11-08', { name: 'Homemade pasta', n: { calories: 600 }, at: 2 });
  s.addEntry('2026-11-09', { ...entryFromItem(WRAP), at: 3 });
  s.addEntry('2026-11-09', { name: 'homemade pasta', n: { calories: 650 }, at: 4 });
  assert.deepEqual(s.recent(10, '2026-11-09').map((e) => [e.name, e.n.calories]), [['homemade pasta', 650], ['Chicken Wrap', 410]]);
  assert.equal(s.recent(1, '2026-11-09').length, 1);
});

test('store: copy a day', () => {
  const s = new Store(memoryStorage());
  const a = s.addEntry('2026-11-08', entryFromItem(WRAP, { meal: 'lunch' }));
  assert.equal(s.copyDay('2026-11-08', '2026-11-09'), 1);
  const copy = s.getLog('2026-11-09')[0];
  assert.notEqual(copy.id, a.id);
  assert.deepEqual([copy.name, copy.meal], ['Chicken Wrap', 'lunch']);
  assert.equal(s.copyDay('2026-01-01', '2026-11-09'), 0);
});

test('store: backup round-trip', () => {
  const a = new Store(memoryStorage());
  a.addEntry('2026-11-08', entryFromItem(WRAP));
  a.setGoals({ calories: 1800 });
  a.toggleFavPlace('subway');
  const backup = JSON.parse(JSON.stringify(a.export()));

  const b = new Store(memoryStorage());
  b.addEntry('2026-11-09', { name: 'kept', n: { calories: 1 } });
  b.toggleFavPlace('pita-pit');
  assert.deepEqual(b.import(backup), { days: 1, entries: 1 });
  assert.deepEqual(b.logDates(), ['2026-11-08', '2026-11-09']);
  assert.equal(b.getGoals().calories, 1800);
  assert.deepEqual(b.favPlaces().sort(), ['pita-pit', 'subway']);
  assert.throws(() => b.import({ nope: 1 }), /Not a MacNutriLogger backup/);
  b.clearLogs();
  assert.deepEqual(b.logDates(), []);
});

test('store: v1 data is migrated once and left in place', () => {
  const at = new Date(2026, 10, 1, 12, 30).getTime();
  const storage = memoryStorage({
    'log:2026-11-01': JSON.stringify([{ ...WRAP, loggedAt: at, locName: 'The Bistro' }, { bogus: true }]),
    'log:not-a-date': '[]',
    goals: JSON.stringify({ calories: 2500, protein: 160, carbs: 300, fat: 80 }),
    favs: JSON.stringify(['subway']),
  });
  const s = new Store(storage);
  const [e] = s.getLog('2026-11-01');
  assert.deepEqual([e.itemId, e.name, e.place, e.qty, e.meal, e.at, e.n.calories], ['bistro--wrap', 'Chicken Wrap', 'The Bistro', 1, 'lunch', at, 410]);
  assert.equal(s.getLog('2026-11-01').length, 1);
  assert.equal(s.getGoals().calories, 2500);
  assert.deepEqual(s.favPlaces(), ['subway']);
  assert.ok(storage.getItem('log:2026-11-01'), 'old key untouched');

  s.setLog('2026-11-01', []);
  assert.deepEqual(new Store(storage).getLog('2026-11-01'), [], 'does not migrate twice');
});
