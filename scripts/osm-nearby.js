// Finds restaurants/cafes within RADIUS metres of campus via OpenStreetMap (Overpass)
// and upserts them as locations. Nutrition is NOT included: add it via the admin UI / import.
// Usage: node scripts/osm-nearby.js [lat lon radius]   (default: McMaster centre, 600 m)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB } from '../server/db.js';

const [lat = 43.2609, lon = -79.9192, radius = 600] = process.argv.slice(2).map(Number);
const q = `[out:json][timeout:30];
(nwr["amenity"~"restaurant|fast_food|cafe|food_court"](around:${radius},${lat},${lon}););
out center tags;`;

const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' } });
if (!res.ok) throw new Error(`Overpass ${res.status}`);
const { elements } = await res.json();
const locations = elements.filter((e) => e.tags?.name).map((e) => ({
  id: `osm-${e.type[0]}${e.id}`,
  name: e.tags.name,
  brand: e.tags.brand || null,
  type: e.tags.amenity === 'cafe' ? 'cafe' : 'restaurant',
  lat: e.lat ?? e.center?.lat,
  lon: e.lon ?? e.center?.lon,
  address: [e.tags['addr:housenumber'], e.tags['addr:street']].filter(Boolean).join(' ') || null,
  source: 'osm',
}));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new DB(process.env.DB_FILE || path.join(root, 'data', 'db.json'));
db.bulk({ locations });
console.log(`Upserted ${locations.length} locations`);
