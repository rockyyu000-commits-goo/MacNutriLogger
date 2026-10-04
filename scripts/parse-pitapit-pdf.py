#!/usr/bin/env python3
"""Pita Pit Canada Nutritionals & Allergen Guide (PDF) -> data/seed/chains/pita-pit.json (needs pdfplumber).
  python3 scripts/parse-pitapit-pdf.py guide.pdf > data/seed/chains/pita-pit.json
Columns: Cal, Fat, Sat, Trans, Chol, Carbs, Fiber, Sugar, Prot, Sodium, Potassium, Calcium, Iron."""
import json, re, sys
import pdfplumber
def slug(s): return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))
NUM = re.compile(r'^<?\d+(\.\d+)?$')
events = []  # (page, top, kind, payload)
RANK = {'Small': 0, 'Regular': 1, 'Large': 2, 'XL': 3}
for pn, page in enumerate(pdfplumber.open(sys.argv[1]).pages):
    ws = page.extract_words(x_tolerance=1.5)
    hdr = {w['text']: w for w in ws if w['text'] in ('Size', 'Cal', 'Allergens') and 90 < w['top'] < 125}
    if not {'Size', 'Cal'} <= set(hdr): continue
    sx, cx = hdr['Size']['x0'] - 12, hdr['Cal']['x0'] - 5
    ax = hdr['Allergens']['x0'] - 3 if 'Allergens' in hdr else 10_000
    title = ' '.join(w['text'] for w in ws if 60 < w['top'] < 95 and w['x0'] < 250 and (w['text'].isupper() or w['text'] in ('—', '-', '&')))
    events.append((pn, 0, 'title', title))
    body = [w for w in ws if 118 < w['top'] < page.height - 40]
    lines = {}
    for w in body: lines.setdefault(round(w['top'] / 5), []).append(w)  # ~5pt line buckets
    for key in sorted(lines):
        L = sorted(lines[key], key=lambda w: w['x0']); top = min(w['top'] for w in L)
        name = ' '.join(w['text'] for w in L if w['x0'] < sx)
        nums = [w['text'] for w in L if cx <= w['x0'] < ax and NUM.match(w['text'])]
        if len(nums) >= 12:
            lab = [w for w in body if sx <= w['x0'] < cx and top - 14 < w['top'] < top + 3]
            size = next((w['text'] for w in lab if w['text'] in RANK), '')
            below = sorted([w for w in body if sx <= w['x0'] < cx and top + 3 <= w['top'] < top + 16], key=lambda w: (w['top'], w['x0']))
            extra = ' '.join(w['text'] for w in below if w['text'] not in RANK)
            events.append((pn, top, 'row', (size, extra, nums)))
        if name:
            for m in re.finditer(r'(CREATED FOR YOU(?: — (?:PITA|SALAD BOWL|RICE BOWL))?|BUILD YOUR OWN(?: - (?:PROTEINS|TOPPINGS|SAUCES))?|JUST FRUIT FROZEN DESSERT|SMOOTHIES|COOKIES)', name):
                events.append((pn, top - 0.1, 'title', m.group(1)))
            name = re.sub(r'\b(CREATED FOR YOU(?: — (?:PITA|SALAD BOWL|RICE BOWL))?|BUILD YOUR OWN(?: - (?:PROTEINS|TOPPINGS|SAUCES))?|JUST FRUIT FROZEN DESSERT|SMOOTHIES|COOKIES)\b|Menu Item', ' ', name).strip()
            if name: events.append((pn, top, 'name', name))

# group size rows into items: a new item starts when sizes stop increasing
groups = []; cur = None; title = ''
for pn, top, kind, p in events:
    if kind == 'title': title = p; continue
    if kind == 'row':
        size, extra, nums = p
        rank = RANK.get(size, -1)
        if cur is None or rank < 0 or rank <= cur['last']:
            cur = {'title': title, 'rows': [], 'last': rank, 'names': []}; groups.append(cur)
        cur['last'] = rank; cur['rows'].append((pn, top, size, nums, extra))
spans = lambda g, pn: [t for (q, t, *_ ) in g['rows'] if q == pn]
def dist(g, pn, y):
    ts = spans(g, pn)
    if not ts: return 1e9 if not g['rows'] else 400 + abs(g['rows'][0][0] - pn) * 1000
    return 0 if min(ts) - 6 <= y <= max(ts) + 6 else min(abs(y - min(ts)), abs(y - max(ts)))
for pn, top, kind, p in events:
    if kind != 'name': continue
    same = [g for g in groups if g['title'] and any(r[0] in (pn, pn - 1) for r in g['rows'])]
    if not same: continue
    g = min(same, key=lambda g: dist(g, pn, top))
    g['names'].append((pn, top, p))
skipped = []
items = []; seen = {}
cols = ['calories', 'fat', 'satFat', None, 'cholesterol', 'carbs', 'fiber', 'sugar', 'protein', 'sodium', None, 'calcium', 'iron']
for g in groups:
    name = re.sub(r'\s+', ' ', ' '.join(t for *_, t in sorted(g['names']))).strip()
    kc = [r[3][0] for r in sorted(g['rows'], key=lambda r: RANK.get(r[2], 9))]
    nk = [float(x) for x in kc if re.fullmatch(r'\d+(\.\d+)?', x)]
    if not name or any(len(r[3]) < 13 for r in g['rows']) or nk != sorted(nk):
        skipped.append((g['title'], name or '(unnamed)', [r[2] for r in g['rows']], kc)); continue
    cat = re.sub(r'\s+', ' ', g['title']).strip().title().replace('Created For You — ', 'Created For You · ').replace('Build Your Own - ', 'Build Your Own · ')
    for pn, top, size, nums, extra in g['rows']:
        v = [float(x.lstrip('<')) for x in nums[:13]]
        it = dict(locationId='pita-pit', category=cat, name=f'{name} ({size})' if size else name, serving=(f'{size} {extra}'.strip() or None), source='chain', flags=[])
        for c, x in zip(cols, v):
            if c: it[c] = x
        kcal = it['calories']; est = 4 * it['protein'] + 4 * max(it['carbs'] - it['fiber'], 0) + 9 * it['fat']
        if kcal > 50 and abs(est - kcal) / kcal > .4: it['flags'].append('kcal-vs-macros-mismatch')
        base = f"pita-pit--{slug(cat)}--{slug(it['name'])}"; k = seen.get(base, 0); seen[base] = k + 1
        it['id'] = base if not k else f'{base}-{k+1}'
        items.append(it)
print(json.dumps({'items': items}, indent=1, ensure_ascii=False))
for sk in skipped: print('SKIPPED', sk, file=sys.stderr)
print(f'{len(items)} items, {len(skipped)} groups skipped', file=sys.stderr)
