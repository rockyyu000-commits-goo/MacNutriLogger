// Fills in coordinates for McMaster locations and discovers nearby restaurants via Google Places API (New).
//   GOOGLE_MAPS_API_KEY=... node scripts/google-places.js [radiusMetres=600]
// Enable "Places API (New)" on the key's project. Cost is a few cents per run (well inside the free monthly credit).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB } from '../server/db.js';

export const CAMPUS = { lat: 43.2609, lon: -79.9192 }; // approx. centre of McMaster main campus
const FIELDS = 'places.id,places.displayName,places.location,places.formattedAddress,places.types';
const TYPES = ['restaurant', 'fast_food_restaurant', 'cafe', 'coffee_shop', 'bakery', 'sandwich_shop', 'pizza_restaurant', 'meal_takeaway'];

export function placeToLocation(p) {
  return {
    id: `gp-${p.id}`, name: p.displayName?.text, brand: null, address: p.formattedAddress || null,
    type: /cafe|coffee/.test((p.types || []).join()) ? 'cafe' : 'restaurant',
    lat: p.location?.latitude, lon: p.location?.longitude, source: 'google',
  };
}

async function call(key, endpoint, body) {
  const r = await fetch(`https://places.googleapis.com/v1/places:${endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': FIELDS }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Places ${endpoint} ${r.status}: ${await r.text()}`);
  return (await r.json()).places || [];
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) throw new Error('Set GOOGLE_MAPS_API_KEY');
  const radius = Number(process.argv[2] || 600);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const db = new DB(process.env.DB_FILE || path.join(root, 'data', 'db.json'));
  const circle = { circle: { center: { latitude: CAMPUS.lat, longitude: CAMPUS.lon }, radius } };

  // 1) campus dining locations lacking coordinates
  for (const l of db.data.locations.filter((x) => x.source === 'mcmaster' && x.lat == null)) {
    const [p] = await call(key, 'searchText', { textQuery: `${l.name} McMaster University Hamilton`, locationBias: circle, maxResultCount: 1 });
    if (p) { Object.assign(l, { lat: p.location.latitude, lon: p.location.longitude, address: p.formattedAddress }); console.log('located', l.name, l.lat, l.lon); }
    else console.log('NOT FOUND, set manually in /admin.html:', l.name);
  }
  // 2) nearby restaurants, one request per type (20 results max each)
  const found = new Map();
  for (const t of TYPES) for (const p of await call(key, 'searchNearby', { includedTypes: [t], maxResultCount: 20, locationRestriction: circle })) found.set(p.id, p);
  const known = new Set(db.data.locations.filter((x) => x.source === 'mcmaster').map((x) => x.name.toLowerCase()));
  const locations = [...found.values()].map(placeToLocation).filter((l) => l.name && !known.has(l.name.toLowerCase()));
  locations.forEach((l) => { const e = db.data.locations.find((x) => x.id === l.id); db.upsertLocation({ ...l, active: e?.active ?? true }); });
  db.save();
  console.log(`Found ${locations.length} nearby places:\n` + locations.map((l) => ` - ${l.name} (${l.address})`).join('\n'));
}
