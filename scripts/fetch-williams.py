#!/usr/bin/env python3
"""Williams Fresh Cafe publishes one image-only Nutrition Facts PDF per item
(https://williamsfreshcafe.com/nutrition-information/). Download them all, OCR each label (rapidocr-onnxruntime),
and write data/seed/chains/williams-fresh-cafe.json. Slow (~200 PDFs); cache dir: argv[1].
  pip install rapidocr-onnxruntime pdfplumber
  python3 scripts/fetch-williams.py /tmp/williams > data/seed/chains/williams-fresh-cafe.json
Item names come from the file names; every row is cross-checked (kcal vs macros) and flagged if the OCR looks wrong."""
import json, os, re, subprocess, sys, time, urllib.parse, urllib.request
from rapidocr_onnxruntime import RapidOCR
CACHE = sys.argv[1]; os.makedirs(CACHE, exist_ok=True)
H = {'user-agent': 'Mozilla/5.0'}
def get(url):
    for attempt in range(6):
        try: return urllib.request.urlopen(urllib.request.Request(url, headers=H), timeout=60).read()
        except Exception: time.sleep(3 * (attempt + 1))
    raise SystemExit(f'giving up on {url}')
page = get('https://williamsfreshcafe.com/nutrition-information/').decode()
links = sorted(set(re.findall(r'href="(https://williamsfreshcafe\.com/wp-content/uploads/[^"]+\.pdf)"', page)))
links = [l for l in links if 'atering' not in l]
ocr = RapidOCR()
def slug(s): return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))
def num(s):
    m = re.search(r'(\d+(?:[.,]\d+)?)', s or ''); return float(m.group(1).replace(',', '.')) if m else None
items = []; seen = {}; bad = []
for url in links:
    fn = urllib.parse.unquote(url.rsplit('/', 1)[1])[:-4]
    pdf = os.path.join(CACHE, fn + '.pdf')
    if not os.path.exists(pdf):
        try: open(pdf, 'wb').write(get(url)); time.sleep(0.5)
        except SystemExit: bad.append((fn, 'download failed')); continue
    png = os.path.join(CACHE, fn)
    if not os.path.exists(png + '-000.png'):
        if subprocess.run(['pdfimages', '-png', pdf, png], capture_output=True).returncode != 0 or not os.path.exists(png + '-000.png'):
            os.remove(pdf); bad.append((fn, 'bad pdf (removed; re-run to retry)')); continue
    res, _ = ocr(png + '-000.png')
    if not res: bad.append((fn, 'no text')); continue
    # rebuild lines by y position
    boxes = sorted(((sum(p[1] for p in b) / 4, min(p[0] for p in b), t) for b, t, _ in res))
    lines = []
    for y, x, t in boxes:
        if lines and abs(lines[-1][0] - y) < 9: lines[-1][1].append((x, t))
        else: lines.append([y, [(x, t)]])
    text = '\n'.join(' '.join(t for _, t in sorted(l[1])) for l in lines)
    def grab(pat, cast=num):
        m = re.search(pat, text, re.I | re.M); return cast(m.group(1)) if m else None
    N = r'(\d+(?:[.,]\d+)?)\s*(?:g|mg)\b'
    SEP = r'(?:\s*/\s*[A-Za-z\u00C0-\u017F]+)?\s*'  # optional French half of a bilingual label
    it = dict(calories=grab(r'calor\w*(?:\s*/\s*calories)?\s*[:/]?\s*(\d+)'),
              fat=grab(r'^\W*(?:total\s+)?fat' + SEP + N), satFat=grab(r'saturated' + SEP + N),
              carbs=grab(r'carbohydrates?' + SEP + N), fiber=grab(r'fib(?:re|er)s?' + SEP + N), sugar=grab(r'sugars?' + SEP + N),
              protein=grab(r'protein\w*' + SEP + N), cholesterol=grab(r'cholesterol' + SEP + N), sodium=grab(r'sodium' + SEP + N))
    serving = grab(r'\(\s*(\d+(?:[.,]\d+)?)\s*(?:g|mL|ml)\b', float)
    flags = []
    need = ['calories', 'fat', 'carbs', 'protein']
    if any(it[k] is None for k in need): bad.append((fn, 'missing fields', it)); continue
    if it['calories'] == 0 and 4 * it['protein'] + 4 * it['carbs'] + 9 * it['fat'] > 30: bad.append((fn, 'calories read as 0', it)); continue
    est = 4 * it['protein'] + 4 * max(it['carbs'] - (it['fiber'] or 0), 0) + 9 * it['fat']
    if it['calories'] > 50 and abs(est - it['calories']) / it['calories'] > .35: flags.append('kcal-vs-macros-mismatch')
    name = re.sub(r'\s+', ' ', fn.replace('_', ' ').replace('-', ' ')).strip()
    iid = f'williams-fresh-cafe--{slug(name)}'; k = seen.get(iid, 0); seen[iid] = k + 1
    items.append(dict(id=iid if not k else f'{iid}-{k+1}', locationId='williams-fresh-cafe', category='Menu', name=name,
                      serving=f'{serving:g} g' if serving else None, source='chain', flags=flags, **{kk: v for kk, v in it.items()}))
print(json.dumps({'items': items}, indent=1, ensure_ascii=False))
for b in bad: print('SKIPPED', b, file=sys.stderr)
print(f'{len(items)} items, {len(bad)} skipped, {sum(1 for i in items if i["flags"])} flagged', file=sys.stderr)
