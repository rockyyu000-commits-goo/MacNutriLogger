// JSON-file store for the editable menu data: locations (places) and items (foods).
// The file format is { locations: [...], items: [...] } and is unchanged from v1, so an
// existing data/db.json keeps working.
import fs from 'node:fs';
import path from 'node:path';

export const NUMERIC_FIELDS = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat', 'cholesterol', 'vitaminC', 'calcium', 'iron', 'price'];
export const LOCATION_TYPES = ['dining_hall', 'cafe', 'restaurant'];

/** Thrown for bad input; the HTTP layer turns it into a 400. */
export class ValidationError extends Error {}

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const text = (v, max = 300) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const coord = (v, name) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ValidationError(`location.${name} must be a number`);
  return n;
};

export function cleanLocation(l) {
  if (!l || typeof l !== 'object') throw new ValidationError('location must be an object');
  const name = text(l.name);
  if (!name) throw new ValidationError('location.name required');
  const id = text(l.id) || slug(name);
  if (!id) throw new ValidationError('location.id required');
  return {
    id,
    name,
    type: LOCATION_TYPES.includes(l.type) ? l.type : 'restaurant',
    brand: text(l.brand),
    lat: coord(l.lat, 'lat'),
    lon: coord(l.lon, 'lon'),
    address: text(l.address),
    cuisine: text(l.cuisine),
    priceRange: text(l.priceRange),
    source: text(l.source, 40) || 'manual', // mcmaster | google-list | manual
    active: l.active !== false,
  };
}

export function cleanItem(i) {
  if (!i || typeof i !== 'object') throw new ValidationError('item must be an object');
  const name = text(i.name);
  const locationId = text(i.locationId);
  if (!name || !locationId) throw new ValidationError('item.name and item.locationId required');
  const serving = text(i.serving, 80);
  const out = {
    id: text(i.id) || `${locationId}--${slug(name)}${serving ? '-' + slug(serving) : ''}`,
    locationId,
    name,
    category: text(i.category, 120), // station / menu section
    course: text(i.course, 120), // sub-section within a category
    serving,
    source: text(i.source, 40) || 'manual', // mcmaster | chain | photo | manual
    flags: Array.isArray(i.flags) ? i.flags.map((f) => text(f, 60)).filter(Boolean) : [], // data-quality notes
    locked: !!i.locked, // hand-edited: never overwritten by a re-import
    updatedAt: new Date().toISOString(),
  };
  for (const k of NUMERIC_FIELDS) {
    const v = i[k];
    if (v == null || v === '') out[k] = null;
    else if (Number.isFinite(Number(v))) out[k] = Number(v);
    else throw new ValidationError(`item.${k} must be a number`);
  }
  return out;
}

export class DB {
  constructor(file) {
    this.file = file;
    this.locations = new Map();
    this.items = new Map();
    this.revision = 0; // bumped on every change; lets callers cache derived data
    if (file && fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const l of raw.locations || []) if (l?.id) this.locations.set(l.id, l);
      for (const i of raw.items || []) if (i?.id) this.items.set(i.id, i);
    }
  }

  /** Plain snapshot in the on-disk / API shape. */
  get data() {
    return { locations: [...this.locations.values()], items: [...this.items.values()] };
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file); // atomic: a crash never leaves a half-written db
  }

  itemsAt(locationId) {
    return [...this.items.values()].filter((i) => i.locationId === locationId);
  }

  upsertLocation(l) {
    const rec = cleanLocation(l);
    this.locations.set(rec.id, rec);
    this.revision++;
    return rec;
  }

  upsertItem(i) {
    const rec = cleanItem(i);
    if (!this.locations.has(rec.locationId)) throw new ValidationError(`unknown locationId ${rec.locationId}`);
    this.items.set(rec.id, rec);
    this.revision++;
    return rec;
  }

  /** Partial update: fields not in `patch` keep their current value. */
  patchLocation(id, patch) {
    return this.upsertLocation({ ...this.locations.get(id), ...patch, id });
  }

  /**
   * Partial update of an item (a hand edit). Marks it locked so re-imports leave it alone, and
   * clears the data-quality warnings that the edit addresses unless the patch sets flags itself.
   */
  patchItem(id, patch) {
    const old = this.items.get(id) ?? {};
    let flags = patch.flags ?? old.flags ?? [];
    if (!patch.flags) {
      const changed = (k) => k in patch && patch[k] !== old[k];
      if (['calories', 'protein', 'carbs', 'fat'].some(changed)) flags = flags.filter((f) => !['suspect-calories', 'zero-calories', 'kcal-vs-macros-mismatch'].includes(f));
      if (changed('name')) flags = flags.filter((f) => f !== 'verify-name');
    }
    return this.upsertItem({ ...old, ...patch, flags, id, locked: true });
  }

  deleteLocation(id) {
    const had = this.locations.delete(id);
    for (const [iid, i] of this.items) if (i.locationId === id) this.items.delete(iid);
    this.revision++;
    return had;
  }

  deleteItem(id) {
    const had = this.items.delete(id);
    this.revision++;
    return had;
  }

  /** Bulk upsert (admin page, import script, photo-transcribed menus). All-or-nothing; items are replaced whole. */
  bulk({ locations = [], items = [] } = {}) {
    if (!Array.isArray(locations) || !Array.isArray(items)) throw new ValidationError('locations and items must be arrays');
    // A location that already exists is merged, so importing { name, address } doesn't wipe its other fields.
    const locs = locations.map((l) => {
      const rec = cleanLocation(l);
      const old = this.locations.get(rec.id);
      return old ? cleanLocation({ ...old, ...l, id: rec.id }) : rec;
    });
    const known = new Set([...this.locations.keys(), ...locs.map((l) => l.id)]);
    const its = items.map(cleanItem);
    const orphan = its.find((i) => !known.has(i.locationId));
    if (orphan) throw new ValidationError(`unknown locationId ${orphan.locationId}`);
    for (const l of locs) this.locations.set(l.id, l);
    for (const i of its) this.items.set(i.id, i);
    this.revision++;
    this.save();
    return { locations: locs.length, items: its.length };
  }

  /** Add seed locations that don't exist yet; never overwrites edits. Returns how many were added. */
  seedLocations(locs) {
    let n = 0;
    for (const l of locs.map(cleanLocation)) {
      if (this.locations.has(l.id)) continue;
      this.locations.set(l.id, l);
      n++;
    }
    if (n) { this.revision++; this.save(); }
    return n;
  }

  /** Load a chain's official items once: only for known locations that have no chain items yet. */
  seedItems(items) {
    const hasChain = new Set();
    for (const i of this.items.values()) if (i.source === 'chain') hasChain.add(i.locationId);
    let n = 0;
    for (const i of items) {
      if (!this.locations.has(i.locationId) || hasChain.has(i.locationId)) continue;
      const rec = cleanItem({ ...i, source: 'chain' });
      this.items.set(rec.id, rec);
      n++;
    }
    if (n) { this.revision++; this.save(); }
    return n;
  }

  /** Re-import helper: replace the unlocked items of `source` at the given locations. */
  replaceScraped(source, locationIds, items) {
    const ids = new Set(locationIds);
    for (const [iid, i] of this.items) {
      if (i.source === source && ids.has(i.locationId) && !i.locked) this.items.delete(iid);
    }
    let n = 0;
    for (const i of items) {
      const rec = cleanItem({ ...i, source });
      if (!this.locations.has(rec.locationId)) throw new ValidationError(`unknown locationId ${rec.locationId}`);
      if (this.items.get(rec.id)?.locked) continue;
      this.items.set(rec.id, rec);
      n++;
    }
    this.revision++;
    this.save();
    return n;
  }
}
