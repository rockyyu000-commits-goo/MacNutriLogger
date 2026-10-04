// Tiny JSON-file store. Locations and items are the editable "menu" data.
import fs from 'node:fs';
import path from 'node:path';

const NUM = ['calories', 'protein', 'carbs', 'fat', 'fiber', 'sugar', 'sodium', 'satFat', 'cholesterol', 'vitaminC', 'calcium', 'iron', 'price'];

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function cleanLocation(l) {
  if (!l.name) throw new Error('location.name required');
  return {
    id: l.id || slug(l.name),
    name: String(l.name),
    type: l.type || 'restaurant', // dining_hall | cafe | restaurant
    brand: l.brand || null,
    lat: l.lat == null ? null : Number(l.lat),
    lon: l.lon == null ? null : Number(l.lon),
    address: l.address || null,
    cuisine: l.cuisine || null,
    priceRange: l.priceRange || null,
    source: l.source || 'manual', // mcmaster | osm | manual
    active: l.active !== false,
  };
}

export function cleanItem(i) {
  if (!i.name || !i.locationId) throw new Error('item.name and item.locationId required');
  const out = {
    id: i.id || `${i.locationId}--${slug(i.name)}${i.serving ? '-' + slug(i.serving) : ''}`,
    locationId: i.locationId,
    name: String(i.name),
    category: i.category || null, // station / menu section / folder
    serving: i.serving || null,
    source: i.source || 'manual', // mcmaster | chain | photo | manual
    course: i.course || null, // sub-section within a category
    flags: Array.isArray(i.flags) ? i.flags : [], // data-quality notes, e.g. 'suspect-calories'
    locked: !!i.locked, // locked items are never overwritten by the scraper
    updatedAt: new Date().toISOString(),
  };
  for (const k of NUM) {
    if (i[k] == null || i[k] === '') out[k] = null;
    else if (Number.isFinite(Number(i[k]))) out[k] = Number(i[k]);
    else throw new Error(`item.${k} must be a number`);
  }
  return out;
}

export class DB {
  constructor(file) {
    this.file = file;
    this.data = { locations: [], items: [] };
    if (fs.existsSync(file)) this.data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1));
    fs.renameSync(tmp, this.file);
  }
  upsert(kind, rec) {
    const arr = this.data[kind];
    const i = arr.findIndex((r) => r.id === rec.id);
    if (i >= 0) arr[i] = { ...arr[i], ...rec };
    else arr.push(rec);
    return rec;
  }
  // Add seed locations that don't exist yet; never overwrites edits.
  seedLocations(locs) {
    let n = 0;
    for (const l of locs.map(cleanLocation)) if (!this.data.locations.some((x) => x.id === l.id)) { this.data.locations.push(l); n++; }
    if (n) this.save();
    return n;
  }
  // Load a chain's official items once (only if the location has no chain items yet).
  seedItems(items) {
    const byLoc = Map.groupBy(items, (i) => i.locationId);
    let n = 0;
    for (const [loc, its] of byLoc) {
      if (!this.data.locations.some((l) => l.id === loc) || this.data.items.some((i) => i.locationId === loc && i.source === 'chain')) continue;
      its.forEach((i) => this.upsertItem({ ...i, source: 'chain' })); n += its.length;
    }
    if (n) this.save();
    return n;
  }
  upsertLocation(l) { return this.upsert('locations', cleanLocation(l)); }
  upsertItem(i) {
    if (!this.data.locations.some((l) => l.id === i.locationId)) throw new Error(`unknown locationId ${i.locationId}`);
    return this.upsert('items', cleanItem(i));
  }
  deleteLocation(id) {
    this.data.locations = this.data.locations.filter((l) => l.id !== id);
    this.data.items = this.data.items.filter((i) => i.locationId !== id);
  }
  deleteItem(id) { this.data.items = this.data.items.filter((i) => i.id !== id); }
  // Bulk upsert; used by the admin UI, the scrapers, and photo-transcribed menus.
  bulk({ locations = [], items = [] }) {
    locations.forEach((l) => this.upsertLocation(l));
    items.forEach((i) => this.upsertItem(i));
    this.save();
    return { locations: locations.length, items: items.length };
  }
  // Scraper helper: replace unlocked items of a source for given locations.
  replaceScraped(source, locationIds, items) {
    const ids = new Set(locationIds);
    this.data.items = this.data.items.filter((i) => !(i.source === source && ids.has(i.locationId) && !i.locked));
    items.forEach((i) => {
      const existing = this.data.items.find((x) => x.id === cleanItem({ ...i, source }).id);
      if (!existing?.locked) this.upsertItem({ ...i, source });
    });
    this.save();
  }
}
