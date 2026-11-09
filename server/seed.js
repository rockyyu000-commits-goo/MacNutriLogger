// First-run data: McMaster menus (CSV), nearby restaurants, and official chain nutrition.
// Every step is idempotent and never overwrites something that is already in the database.
import fs from 'node:fs';
import path from 'node:path';
import { parseCsv, rowsToData } from './mcmaster-csv.js';

export function seedAll(db, seedDir, log = () => {}) {
  const summary = { mcmaster: 0, restaurants: 0, chains: {} };

  const menuCsv = path.join(seedDir, 'mcmaster_menu.csv');
  if (!db.items.size && fs.existsSync(menuCsv)) {
    summary.mcmaster = db.bulk(rowsToData(parseCsv(fs.readFileSync(menuCsv, 'utf8')))).items;
    log(`Seeded ${summary.mcmaster} McMaster menu items`);
  }

  const nearby = path.join(seedDir, 'nearby_restaurants.json');
  if (fs.existsSync(nearby)) {
    summary.restaurants = db.seedLocations(JSON.parse(fs.readFileSync(nearby, 'utf8')).locations);
    if (summary.restaurants) log(`Seeded ${summary.restaurants} restaurants`);
  }

  const chainDir = path.join(seedDir, 'chains');
  if (fs.existsSync(chainDir)) {
    for (const f of fs.readdirSync(chainDir).filter((x) => x.endsWith('.json')).sort()) {
      const n = db.seedItems(JSON.parse(fs.readFileSync(path.join(chainDir, f), 'utf8')).items);
      if (n) { summary.chains[f] = n; log(`Seeded ${n} items from ${f}`); }
    }
  }
  return summary;
}
