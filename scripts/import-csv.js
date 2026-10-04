// Import the McMaster menu CSV (columns: location,tab,course,name,serving_unit,price,calories_kcal,...).
//   node scripts/import-csv.js menu.csv
// Replaces unlocked 'mcmaster' items for the locations in the file; hand-edited items are kept.
// Nutrition values are per serving (kcal agrees with macros); serving_unit "100g" is a pricing label.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB, slug } from '../server/db.js';

export function parseCsv(text) {
  const rows = []; let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); f = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else f += c;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  const head = rows.shift().map((h) => h.replace(/^﻿/, '').trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const DINING_HALLS = new Set(['Centro', 'La Piazza', 'Lincoln Alexander Hall', 'The Bistro @ MKR']);
const title = (s) => s.toLowerCase().replace(/(^|[\s(\-/])([a-z])/g, (_, a, b) => a + b.toUpperCase());
const SERVING = { portion: 'Portion', porion: 'Portion', piortion: 'Portion', portions: 'Portion', each: 'Each', slice: 'Slice', sandwich: 'Sandwich', kilogram: 'Kilogram' };

export function rowsToData(rows) {
  const locations = new Map(), items = [], seen = new Map();
  for (const r of rows) {
    if (r.calories_kcal === '') continue; // no nutrition published
    const locId = `mac-${slug(r.location)}`;
    locations.set(locId, { id: locId, name: r.location, type: DINING_HALLS.has(r.location) ? 'dining_hall' : 'cafe', source: 'mcmaster' });
    const kcal = Number(r.calories_kcal);
    const flags = [];
    if (kcal === 0) flags.push('zero-calories');
    if (kcal > 2500) flags.push('suspect-calories');
    const unit = r.serving_unit.toLowerCase();
    const it = {
      locationId: locId, category: title(r.tab), course: r.course || null, name: r.name.replace(/\s+/g, ' '),
      serving: unit === '100g' ? 'Portion' : SERVING[unit] || r.serving_unit || null,
      price: r.price === '' ? null : Number(r.price), calories: kcal, fat: r.fat_g, satFat: r.sat_fat_g, cholesterol: r.cholesterol_mg,
      sodium: r.sodium_mg, carbs: r.carbs_g, fiber: r.fiber_g, sugar: r.sugars_g, protein: r.protein_g,
      vitaminC: r.vitamin_c_mg, calcium: r.calcium_mg, iron: r.iron_mg, flags, source: 'mcmaster',
    };
    let id = `${locId}--${slug(r.tab)}--${slug(it.name)}`;
    const sig = JSON.stringify([it.calories, it.protein, it.carbs, it.fat]);
    if (seen.has(id)) { if (seen.get(id) === sig) continue; let n = 2; while (seen.has(`${id}-${n}`)) n++; id = `${id}-${n}`; }
    seen.set(id, sig);
    items.push({ ...it, id });
  }
  return { locations: [...locations.values()], items };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { locations, items } = rowsToData(parseCsv(fs.readFileSync(process.argv[2], 'utf8')));
  const db = new DB(process.env.DB_FILE || path.join(root, 'data', 'db.json'));
  locations.forEach((l) => { const e = db.data.locations.find((x) => x.id === l.id); db.upsertLocation({ ...l, lat: e?.lat ?? null, lon: e?.lon ?? null }); });
  db.replaceScraped('mcmaster', locations.map((l) => l.id), items);
  console.log(`Imported ${items.length} items into ${locations.length} locations; flagged: ${items.filter((i) => i.flags.length).length}`);
}
