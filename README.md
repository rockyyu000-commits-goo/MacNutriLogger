# MacNutriLogger

Calorie and macro tracker for McMaster: dining-hall menus plus nearby chain restaurants (about 4,700 foods at 66 places),
as an installable, offline-capable web app. No dependencies and no build step; needs Node 20 or newer.

```bash
ADMIN_TOKEN=choose-a-secret npm start      # http://localhost:3000, admin at /admin.html
```

```bash
npm test
```

See [docs/WINDOWS.md](docs/WINDOWS.md) to run it 24/7 on a Windows laptop (auto-start, no sleep, private HTTPS via Tailscale).

## The app

| Tab | What it does |
|---|---|
| **Diary** | One day at a time: calories left, protein/carbs/fat against your goals, entries grouped by meal. Tap an entry to change servings or meal, or remove it. *Quick add* logs food that isn't on any menu; *Copy yesterday* fills an empty day. |
| **Places** | Favourites, on campus, chains, other nearby. A place opens as folders (stations / menu sections) with a filter box. |
| **Search** | All menus at once. Filter to campus / chains / favourite places, sort by calories, protein, or protein per 100 kcal. With an empty box it lists favourite foods and recently logged ones. |
| **Trends** | Calories per day against your goal for 7 / 30 / 90 days, averages, streak. |
| **Settings** | Goals, diary backup / restore / erase, menu refresh, link to admin. |

Tap a food's name for its full nutrition label, servings (0.25 steps) and meal; tap **+** to log one serving straight away.
Every add has an Undo.

The diary lives in the browser (`localStorage`), not on the server. Use *Settings → Download backup* before clearing site data
or moving to a new phone. A diary from version 1 is converted automatically the first time version 2 opens.

Items with a warning triangle have numbers that look wrong at the source (for example calories that don't match the macros).
Fix them in the admin page and the warning clears.

## Layout

```
server/server.js         HTTP server: static files + JSON API (gzip, ETag, security headers)
server/db.js             JSON-file store (data/db.json), validation, seeding rules
server/seed.js           first-run load of data/seed/*
server/mcmaster-csv.js   parser for the McMaster menu CSV
public/                  the PWA: index.html, css/, js/ (ES modules), sw.js, admin.html
public/js/lib/           logic with no DOM access (nutrition maths, search, diary store); unit-tested from Node
scripts/                 importers and the per-chain data fetchers / PDF parsers
data/seed/               bundled menu data (loaded once into data/db.json, which is gitignored)
test/                    node:test suites for the server, the store and the client logic
```

Environment: `PORT` (3000), `HOST` (127.0.0.1; use `0.0.0.0` to listen on the LAN), `ADMIN_TOKEN` (admin API is off without it),
`DB_FILE` (`data/db.json`).

## API

| | |
|---|---|
| `GET /api/data` | `{ version, locations, items }`: everything the app needs, gzipped, with an ETag |
| `GET /api/health` | `{ ok, locations, items }` |
| `GET /api/admin/ping`, `GET /api/admin/export` | check the token; download all menu data |
| `POST /api/admin/import` | bulk upsert `{ locations, items }` (all-or-nothing) |
| `POST /api/admin/locations`, `PUT`/`DELETE /api/admin/locations/:id` | create, partially update, delete (with its items) |
| `POST /api/admin/items`, `PUT`/`DELETE /api/admin/items/:id` | create, partially update (locks the item), delete |

Admin routes need `Authorization: Bearer $ADMIN_TOKEN`. An item's `source` (`mcmaster`, `chain`, `photo`, `manual`) says how
trustworthy a number is; `locked` items (anything edited by hand) are never overwritten by a re-import.

## Getting data in

| Source | How | Notes |
|---|---|---|
| McMaster dining halls | `node scripts/import-csv.js menu.csv`, then restart the server | `data/seed/mcmaster_menu.csv` (1,463 items, 9 locations) seeds an empty database. Values are per serving; absurd rows (over 2,500 kcal) are flagged. There is no live scraper: macnutrition.mcmaster.ca loads item nutrition through script callbacks, so re-run your own CSV export. |
| Nearby restaurants | `data/seed/nearby_restaurants.json` | 57 places (Main St W / King St W / Newton Ave), added on start if missing. |
| Chain nutrition | `data/seed/chains/*.json` | Subway, Mr.Sub, Tim Hortons, Pita Pit, barBURRITO, Quesada, Sushi Shop, Pizza Nova, Williams Fresh Cafe. Loaded once per chain; later edits are never overwritten. |
| Anything else | `/admin.html`, or `ADMIN_TOKEN=… node scripts/import.js menu.json` | For example menus transcribed from photos, in the shape below. |

```json
{ "locations": [{ "name": "Subway", "brand": "Subway", "address": "1331 Main St W" }],
  "items": [{ "locationId": "subway", "name": "Turkey 6in", "category": "Subs", "serving": "6 in",
              "calories": 280, "protein": 18, "carbs": 46, "fat": 3.5, "source": "photo" }] }
```

A location's id defaults to its name in lower-case with dashes (`Pita Pit` → `pita-pit`).

### Refreshing chain data

Each file in `data/seed/chains/` is generated by a script, run only when a chain publishes a new guide. Most use just the
Python standard library; Pita Pit needs `pdfplumber` and Williams needs `rapidocr_onnxruntime`.

| Chain | Command | Source / notes |
|---|---|---|
| Subway | `pdftotext -layout CAN_Nutrition.pdf n.txt && python3 scripts/parse-subway-pdf.py n.txt` | Official PDF linked from subway.com/en-ca/menunutrition/nutrition. Footlongs are 2× the 6" values (per Subway's note). |
| Mr.Sub | `python3 scripts/parse-mrsub-pdf.py n.txt` | PDF June 2025 (mrsub.ca/nutrition). Small/Large/Kid's/Breakfast blocks are inferred from position in the PDF. |
| Tim Hortons | `python3 scripts/fetch-tims.py` | Public CMS behind timhortons.ca. As-served numbers (default toppings/milk included). |
| Pita Pit | `python3 scripts/parse-pitapit-pdf.py guide.pdf` | Aug 2026 guide (pitapit.ca/nutrition). Position-based parser; rows it can't name or verify are skipped or flagged `verify-name`. |
| barBURRITO | `python3 scripts/fetch-barburrito.py` | Component data from the site's calculator, scaled the way its JS does. Add components together for a full order. |
| Quesada / Sushi Shop | `python3 scripts/parse-layout-pdf.py quesada\|sushi-shop n.txt` | Official PDFs (Aug 2026 / 2026). |
| Pizza Nova | `python3 scripts/fetch-pizzanova.py` | Calories only, per slice. |
| Williams Fresh Cafe | `python3 scripts/fetch-williams.py cachedir` | One image-only Nutrition Facts PDF per item, read with OCR. Rows that fail a calories-vs-macros check are flagged. |

A regenerated chain file only loads into a database that has no `chain` items for that place yet. To refresh an existing
install, import the new file with `scripts/import.js` (items with the same id are replaced).

Not covered yet (no usable published nutrition found): Smoke's Poutinerie, Lava Pizza & Wings, Quik Chik, Chung Chun Rice Hotdog,
Starbucks, and the independent restaurants. They appear as places without nutrition; use Quick add for meals there.
