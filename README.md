# MacNutriLogger

Calorie/macro tracker (installable PWA) for McMaster: dining-hall menus plus nearby chain restaurants,
browsed as folders: favourites, on campus, chains, other nearby, with a search box. No dependencies; Node ≥ 20.

```
ADMIN_TOKEN=choose-a-secret npm start      # http://localhost:3000, admin at /admin.html
npm test
```

## Getting data in
| Source | Command | Notes |
|---|---|---|
| McMaster dining halls (CSV) | `node scripts/import-csv.js file.csv` | Done: `data/seed/mcmaster_menu.csv` (1,463 items, 9 locations) auto-seeds an empty DB. Values are per serving; suspect rows (e.g. >2500 kcal) are flagged. |
| McMaster live scrape (optional) | `npm run scrape -- --dump` then `npm run scrape` | **Parser untested against the live site** (it was blocked when written). `--dump` saves the raw HTML to `data/raw/`; adjust `parseMenus()` in `scripts/scrape-mcmaster.js` if it parses 0 items. Rerun daily (cron). Hand-edited items are never overwritten. |
| Nearby restaurants | `data/seed/nearby_restaurants.json` | 57 places (Main St W / King St W / Newton Ave) seeded as empty folders on first start. No nutrition yet. |
| Chain nutrition / menu photos | `ADMIN_TOKEN=… node scripts/import.js menu.json` or paste into `/admin.html` | Send me photos of menus; I transcribe them to JSON of the shape below. |

```json
{ "locations": [{ "name": "Subway", "lat": 43.26, "lon": -79.92 }],
  "items": [{ "locationId": "subway", "name": "Turkey 6in", "category": "Subs", "serving": "6 in",
              "calories": 280, "protein": 18, "carbs": 46, "fat": 3.5, "source": "photo" }] }
```

Everything is editable later: `PUT/DELETE /api/admin/{locations,items}/:id`, `POST /api/admin/import` (Bearer `ADMIN_TOKEN`).
Item `source` (`mcmaster`, `chain`, `photo`, `manual`) tells you how trustworthy a number is.
Data lives in `data/db.json` (gitignored); the food log lives in the browser's localStorage.
