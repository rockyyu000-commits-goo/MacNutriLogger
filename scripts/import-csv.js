// Import the McMaster menu CSV (columns: location,tab,course,name,serving_unit,price,calories_kcal,...).
//   node scripts/import-csv.js menu.csv
// Replaces unlocked 'mcmaster' items for the locations in the file; hand-edited items are kept.
// Restart the server afterwards (it reads data/db.json at startup).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB } from '../server/db.js';
import { parseCsv, rowsToData } from '../server/mcmaster-csv.js';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/import-csv.js menu.csv'); process.exit(1); }
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { locations, items } = rowsToData(parseCsv(fs.readFileSync(file, 'utf8')));
const db = new DB(process.env.DB_FILE || path.join(root, 'data', 'db.json'));
for (const l of locations) {
  if (db.locations.has(l.id)) continue; // keep edits (address, name, hidden) made in the admin page
  db.upsertLocation(l);
}
const n = db.replaceScraped('mcmaster', locations.map((l) => l.id), items);
console.log(`Imported ${n} of ${items.length} items into ${locations.length} locations; flagged: ${items.filter((i) => i.flags.length).length}`);
