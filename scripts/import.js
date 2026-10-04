// Import menu data from a JSON file (e.g. transcribed from menu photos):
//   ADMIN_TOKEN=... node scripts/import.js menu.json [http://localhost:3000]
// File shape: { "locations": [...], "items": [{ "locationId": "...", "name": "...", "calories": 0, ... }] }
import fs from 'node:fs';
const [file, base = 'http://localhost:3000'] = process.argv.slice(2);
const r = await fetch(`${base}/api/admin/import`, { method: 'POST', headers: { authorization: `Bearer ${process.env.ADMIN_TOKEN}`, 'content-type': 'application/json' }, body: fs.readFileSync(file, 'utf8') });
console.log(r.status, await r.text());
