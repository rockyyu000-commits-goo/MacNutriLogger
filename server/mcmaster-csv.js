// Parser for the McMaster dining menu CSV export
// (columns: location,tab,course,name,serving_unit,price,calories_kcal,fat_g,...).
// Nutrition values are per serving (kcal agrees with macros); serving_unit "100g" is a pricing label.
import { slug } from './db.js';

/** RFC-4180-ish CSV -> array of { header: value } rows. Handles quotes, CRLF and a BOM. */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const head = rows.shift().map((h) => h.replace(/^\uFEFF/, '').trim());
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const DINING_HALLS = new Set(['Centro', 'La Piazza', 'Lincoln Alexander Hall', 'The Bistro @ MKR']);
const SERVING = { portion: 'Portion', porion: 'Portion', piortion: 'Portion', portions: 'Portion', each: 'Each', slice: 'Slice', sandwich: 'Sandwich', kilogram: 'Kilogram' };
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s(\-/])([a-z])/g, (_, a, b) => a + b.toUpperCase());

/** CSV rows -> { locations, items } ready for DB.bulk / DB.replaceScraped. */
export function rowsToData(rows) {
  const locations = new Map(), items = [], seen = new Map();
  for (const r of rows) {
    if (!r.location || !r.name || r.calories_kcal === '' || r.calories_kcal == null) continue; // no nutrition published
    const locId = `mac-${slug(r.location)}`;
    locations.set(locId, { id: locId, name: r.location, type: DINING_HALLS.has(r.location) ? 'dining_hall' : 'cafe', source: 'mcmaster' });
    const kcal = Number(r.calories_kcal);
    const flags = [];
    if (kcal === 0) flags.push('zero-calories');
    if (kcal > 2500) flags.push('suspect-calories');
    const unit = (r.serving_unit || '').toLowerCase();
    const it = {
      locationId: locId, category: titleCase(r.tab || 'Menu'), course: r.course || null, name: r.name.replace(/\s+/g, ' '),
      serving: unit === '100g' ? 'Portion' : SERVING[unit] || r.serving_unit || null,
      price: r.price === '' ? null : Number(r.price), calories: kcal, fat: r.fat_g, satFat: r.sat_fat_g, cholesterol: r.cholesterol_mg,
      sodium: r.sodium_mg, carbs: r.carbs_g, fiber: r.fiber_g, sugar: r.sugars_g, protein: r.protein_g,
      vitaminC: r.vitamin_c_mg, calcium: r.calcium_mg, iron: r.iron_mg, flags, source: 'mcmaster',
    };
    // Same item listed twice with identical numbers is a duplicate; with different numbers it's a variant.
    let id = `${locId}--${slug(r.tab || 'menu')}--${slug(it.name)}`;
    const sig = JSON.stringify([it.calories, it.protein, it.carbs, it.fat]);
    if (seen.has(id)) {
      if (seen.get(id) === sig) continue;
      let n = 2;
      while (seen.has(`${id}-${n}`)) n++;
      id = `${id}-${n}`;
    }
    seen.set(id, sig);
    items.push({ ...it, id });
  }
  return { locations: [...locations.values()], items };
}
