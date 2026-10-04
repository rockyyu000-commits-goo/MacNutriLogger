// Pulls today's McMaster dining menus into the database.
// NOTE: written without access to the live site (blocked in the build sandbox).
// Step 1: `node scripts/scrape-mcmaster.js --dump` saves the raw HTML to data/raw/ so the
//         parser below can be tuned against the real markup.
// Step 2: `node scripts/scrape-mcmaster.js` parses it and replaces unlocked 'mcmaster' items.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB, slug } from '../server/db.js';

const URL_ = 'https://macnutrition.mcmaster.ca/Nutrition/ServiceMenuReport/Today';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const strip = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const num = (s) => { const m = String(s ?? '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };

// Generic heuristic: any <table> whose header row has a "Calories" column is a menu table;
// the nearest preceding heading (h1-h5/caption) is the station/location label.
export function parseMenus(html) {
  const out = [];
  const tableRe = /<table[\s\S]*?<\/table>/gi;
  let m;
  while ((m = tableRe.exec(html))) {
    const t = m[0];
    const rows = [...t.matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((r) => [...r[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => strip(c[1])));
    const hi = rows.findIndex((r) => r.some((c) => /calories|energy/i.test(c)));
    if (hi < 0) continue;
    const head = rows[hi].map((c) => c.toLowerCase());
    const col = (re) => head.findIndex((c) => re.test(c));
    const idx = { name: Math.max(0, col(/item|name|food|description/)), serving: col(/serving|portion|size/), calories: col(/calor|energy/), protein: col(/protein/), carbs: col(/carb/), fat: col(/^(total )?fat/), fiber: col(/fib/), sugar: col(/sugar/), sodium: col(/sodium/) };
    const before = html.slice(0, m.index);
    const headings = [...before.matchAll(/<(h[1-5]|caption)[^>]*>([\s\S]*?)<\/\1>/gi)];
    const label = headings.length ? strip(headings[headings.length - 1][2]) : 'Unknown';
    for (const r of rows.slice(hi + 1)) {
      if (!r[idx.name]) continue;
      const g = (k) => (idx[k] >= 0 ? num(r[idx[k]]) : null);
      out.push({ label, name: r[idx.name], serving: idx.serving >= 0 ? r[idx.serving] : null, calories: g('calories'), protein: g('protein'), carbs: g('carbs'), fat: g('fat'), fiber: g('fiber'), sugar: g('sugar'), sodium: g('sodium') });
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const res = await fetch(URL_);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  if (process.argv.includes('--dump')) {
    fs.mkdirSync(path.join(root, 'data/raw'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data/raw/today.html'), html);
    console.log('Saved data/raw/today.html');
  } else {
    const rows = parseMenus(html);
    if (!rows.length) throw new Error('Parsed 0 items: run with --dump and adjust parseMenus() to the real markup');
    const db = new DB(process.env.DB_FILE || path.join(root, 'data', 'db.json'));
    const locs = [...new Set(rows.map((r) => r.label))].map((name) => ({ id: `mac-${slug(name)}`, name, type: 'dining_hall', source: 'mcmaster' }));
    // Dining halls need coordinates for "near me"; set them once in the admin UI (kept on re-scrape).
    locs.forEach((l) => { const e = db.data.locations.find((x) => x.id === l.id); db.upsertLocation({ ...l, lat: e?.lat ?? null, lon: e?.lon ?? null }); });
    db.replaceScraped('mcmaster', locs.map((l) => l.id), rows.map(({ label, ...r }) => ({ ...r, locationId: `mac-${slug(label)}` })));
    console.log(`Imported ${rows.length} items into ${locs.length} locations`);
  }
}
