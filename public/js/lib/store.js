// The food diary. Everything the user logs lives in the browser (localStorage), one key per day.
// `storage` is injectable (anything with the Web Storage interface) so this runs in tests too.
import { DEFAULT_GOALS, MACROS, addDays, dateKey, isDateKey, mealForTime, snapshot, totals } from './nutrition.js';

const P = 'mnl2:'; // v2 key prefix; v1 used un-prefixed "log:<date>", "goals", "favs"
const LOG = P + 'log:';
const MEAL_IDS = ['breakfast', 'lunch', 'dinner', 'snacks'];

let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : fallback);

/** Coerce anything (old data, an imported backup) into a valid log entry, or null. */
export function cleanEntry(e) {
  if (!e || typeof e !== 'object' || !e.name) return null;
  const n = {};
  for (const [k, v] of Object.entries(e.n && typeof e.n === 'object' ? e.n : {})) if (Number.isFinite(v)) n[k] = v;
  const qty = num(e.qty, 1);
  return {
    id: typeof e.id === 'string' && e.id ? e.id : uid(),
    itemId: e.itemId ?? null, // null for quick-add entries
    name: String(e.name).slice(0, 200),
    place: e.place ? String(e.place).slice(0, 200) : null,
    serving: e.serving ? String(e.serving).slice(0, 80) : null,
    qty: qty > 0 && qty <= 99 ? qty : 1,
    meal: MEAL_IDS.includes(e.meal) ? e.meal : 'snacks',
    at: num(e.at, Date.now()),
    n,
  };
}

/** Build a log entry from a menu item. The nutrients are copied so later menu edits don't rewrite history. */
export function entryFromItem(item, { qty = 1, meal, place = null, at = Date.now() } = {}) {
  return cleanEntry({ itemId: item.id, name: item.name, place, serving: item.serving, qty, meal: meal ?? mealForTime(new Date(at)), at, n: snapshot(item) });
}

export class Store {
  constructor(storage) {
    this.s = storage;
    this.migrateV1();
  }

  // --- raw access ---
  read(key, fallback) {
    try {
      const v = JSON.parse(this.s.getItem(key));
      return v ?? fallback;
    } catch { return fallback; }
  }
  write(key, value) {
    this.s.setItem(key, JSON.stringify(value));
  }
  keys() {
    const out = [];
    for (let i = 0; i < this.s.length; i++) out.push(this.s.key(i));
    return out;
  }

  // --- goals ---
  getGoals() {
    const g = this.read(P + 'goals', {});
    const out = {};
    for (const k of MACROS) out[k] = num(g?.[k], 0) > 0 ? Number(g[k]) : DEFAULT_GOALS[k];
    return out;
  }
  setGoals(g) {
    this.write(P + 'goals', { ...this.getGoals(), ...g });
  }

  // --- the log ---
  getLog(date) {
    const raw = this.read(LOG + date, []);
    return Array.isArray(raw) ? raw.map(cleanEntry).filter(Boolean) : [];
  }
  setLog(date, entries) {
    if (entries.length) this.write(LOG + date, entries);
    else this.s.removeItem(LOG + date);
  }
  addEntry(date, entry) {
    const e = cleanEntry(entry);
    this.setLog(date, [...this.getLog(date), e]);
    return e;
  }
  updateEntry(date, id, patch) {
    this.setLog(date, this.getLog(date).map((e) => (e.id === id ? cleanEntry({ ...e, ...patch, id }) : e)));
  }
  removeEntry(date, id) {
    this.setLog(date, this.getLog(date).filter((e) => e.id !== id));
  }
  /** Append copies of one day's entries to another day. Returns how many were copied. */
  copyDay(from, to) {
    const src = this.getLog(from);
    if (!src.length) return 0;
    this.setLog(to, [...this.getLog(to), ...src.map((e) => cleanEntry({ ...e, id: uid(), at: Date.now() }))]);
    return src.length;
  }
  /** Dates that have at least one entry, oldest first. */
  logDates() {
    return this.keys().filter((k) => k.startsWith(LOG)).map((k) => k.slice(LOG.length)).filter(isDateKey).sort();
  }
  /** Per-day macro totals for the `days` days ending at `end` (inclusive), oldest first. */
  history(end, days) {
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const date = addDays(end, -i);
      const entries = this.getLog(date);
      out.push({ date, count: entries.length, ...totals(entries) });
    }
    return out;
  }
  /** Most recently logged distinct foods (newest first), looking back `days` days from `end`. */
  recent(limit = 15, end = dateKey(), days = 30) {
    const seen = new Set(), out = [];
    for (let i = 0; i < days && out.length < limit; i++) {
      const entries = this.getLog(addDays(end, -i)).sort((a, b) => b.at - a.at);
      for (const e of entries) {
        const key = e.itemId ?? `custom:${e.name.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(e);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  // --- favourites ---
  favPlaces() { return this.read(P + 'favPlaces', []); }
  favItems() { return this.read(P + 'favItems', []); }
  #toggle(key, id) {
    const list = this.read(key, []);
    const on = !list.includes(id);
    this.write(key, on ? [...list, id] : list.filter((x) => x !== id));
    return on;
  }
  toggleFavPlace(id) { return this.#toggle(P + 'favPlaces', id); }
  toggleFavItem(id) { return this.#toggle(P + 'favItems', id); }

  // --- backup ---
  export() {
    const logs = {};
    for (const d of this.logDates()) logs[d] = this.getLog(d);
    return { app: 'MacNutriLogger', format: 2, exportedAt: new Date().toISOString(), goals: this.getGoals(), favPlaces: this.favPlaces(), favItems: this.favItems(), logs };
  }
  /** Restore a backup. Days present in the backup replace the same days here; other days are kept. */
  import(backup) {
    if (!backup || typeof backup !== 'object' || backup.format !== 2 || typeof backup.logs !== 'object') throw new Error('Not a MacNutriLogger backup file');
    let days = 0, entries = 0;
    for (const [date, list] of Object.entries(backup.logs)) {
      if (!isDateKey(date) || !Array.isArray(list)) continue;
      const clean = list.map(cleanEntry).filter(Boolean);
      this.setLog(date, clean);
      days++; entries += clean.length;
    }
    if (backup.goals) this.setGoals(backup.goals);
    const strings = (a) => (Array.isArray(a) ? a.filter((x) => typeof x === 'string') : []);
    this.write(P + 'favPlaces', [...new Set([...this.favPlaces(), ...strings(backup.favPlaces)])]);
    this.write(P + 'favItems', [...new Set([...this.favItems(), ...strings(backup.favItems)])]);
    return { days, entries };
  }
  clearLogs() {
    for (const k of this.keys().filter((k) => k.startsWith(LOG))) this.s.removeItem(k);
  }

  /** One-time upgrade of v1 data ("log:<date>" arrays of whole menu items, "goals", "favs"). Old keys are left in place. */
  migrateV1() {
    if (this.read(P + 'migrated', false)) return;
    for (const k of this.keys()) {
      if (!k.startsWith('log:')) continue;
      const date = k.slice(4);
      const old = this.read(k, []);
      if (!isDateKey(date) || !Array.isArray(old) || this.s.getItem(LOG + date) != null) continue;
      const entries = old.map((i) => i?.name && cleanEntry({
        itemId: i.id ?? null, name: i.name, place: i.locName, serving: i.serving, qty: 1,
        at: i.loggedAt, meal: mealForTime(new Date(num(i.loggedAt, Date.now()))), n: snapshot(i),
      })).filter(Boolean);
      if (entries.length) this.write(LOG + date, entries);
    }
    const goals = this.read('goals', null);
    if (goals && this.s.getItem(P + 'goals') == null) this.setGoals(goals);
    const favs = this.read('favs', null);
    if (Array.isArray(favs) && this.s.getItem(P + 'favPlaces') == null) this.write(P + 'favPlaces', favs);
    this.write(P + 'migrated', true);
  }
}
