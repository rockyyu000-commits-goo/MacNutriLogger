// Shared app state: the menu data (from the server, cached for offline use) and the diary store.
import { Store, entryFromItem } from './lib/store.js';
import { buildIndex } from './lib/search.js';
import { dateKey, friendlyDate, mealForTime, mealLabel } from './lib/nutrition.js';
import { toast } from './ui.js';

function safeStorage() {
  try {
    localStorage.setItem('mnl2:probe', '1');
    localStorage.removeItem('mnl2:probe');
    return localStorage;
  } catch {
    // Private mode / storage disabled: keep working for this session only.
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
  }
}

export const app = {
  store: new Store(safeStorage()),
  date: dateKey(), // the diary day being viewed / logged to
  meal: null, // meal picked with a "+" on the diary; null = decide from the clock
  status: 'loading', // loading | ready | offline | error
  version: null,
  locations: [],
  items: [],
  locById: new Map(),
  itemById: new Map(),
  itemsByLoc: new Map(),
  index: [],
  rerender() {}, // set by main.js
};

function setData(d) {
  app.version = d.version ?? null;
  app.locations = d.locations ?? [];
  app.items = d.items ?? [];
  app.locById = new Map(app.locations.map((l) => [l.id, l]));
  app.itemById = new Map(app.items.map((i) => [i.id, i]));
  app.itemsByLoc = new Map();
  for (const i of app.items) {
    if (!app.itemsByLoc.has(i.locationId)) app.itemsByLoc.set(i.locationId, []);
    app.itemsByLoc.get(i.locationId).push(i);
  }
  app.index = buildIndex(app.items.filter((i) => app.locById.get(i.locationId)?.active !== false), app.locById);
}

const DATA_URL = '/api/data';

/** Show the cached menu immediately (if any), then refresh from the network. */
export async function loadData() {
  let haveCache = false;
  try {
    const cached = await (await caches.match(DATA_URL))?.json();
    if (cached?.items) { setData(cached); haveCache = true; app.status = 'ready'; app.rerender(); }
  } catch { /* no Cache API or nothing cached yet */ }
  try {
    const res = await fetch(DATA_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const fresh = await res.json();
    const changed = !haveCache || fresh.version !== app.version;
    if (changed) setData(fresh);
    const status = res.headers.get('x-mnl-offline') ? 'offline' : 'ready'; // set by the service worker's fallback
    const statusChanged = status !== app.status;
    app.status = status;
    if (changed || statusChanged) app.rerender();
  } catch {
    app.status = haveCache ? 'offline' : 'error';
    app.rerender();
  }
}

export const placeName = (item) => app.locById.get(item.locationId)?.name ?? null;
export const currentMeal = () => app.meal ?? mealForTime();

/** Log a menu item to the day being viewed, with an Undo toast. */
export function logItem(item, { qty = 1, meal = currentMeal() } = {}) {
  const date = app.date;
  const entry = app.store.addEntry(date, entryFromItem(item, { qty, meal, place: placeName(item) }));
  announce(entry, date);
  return entry;
}

/** Log a copy of an earlier entry (from "Recent"). */
export function relogEntry(old, { meal = currentMeal() } = {}) {
  const date = app.date;
  const entry = app.store.addEntry(date, { ...old, id: null, meal, at: Date.now() });
  announce(entry, date);
  return entry;
}

function announce(entry, date) {
  const where = date === dateKey() ? mealLabel(entry.meal) : `${mealLabel(entry.meal)} (${friendlyDate(date)})`;
  toast(`Added to ${where}`, { label: 'Undo', run: () => { app.store.removeEntry(date, entry.id); app.rerender(); } });
}
