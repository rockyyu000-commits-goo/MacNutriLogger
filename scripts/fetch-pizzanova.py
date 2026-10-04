#!/usr/bin/env python3
"""Pizza Nova: the nutrition page (pizzanova.com/nutrition) ships its tables inside the Next.js bundle
as JSON.parse('[...]'). Extract them -> data/seed/chains/pizza-nova.json. Calories only (no macros published).
  python3 scripts/fetch-pizzanova.py > data/seed/chains/pizza-nova.json
Signature / create-your-own values are calories PER SLICE (the site labels them '/ slice'); 'Other favourites' carry their own serving size."""
import json, re, sys, urllib.request
BASE = 'https://www.pizzanova.com'
get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={'user-agent': 'Mozilla/5.0'}), timeout=60).read().decode()
html = get(BASE + '/nutrition')
tables = []
for c in sorted(set(re.findall(r'/_next/static/chunks/[^"]+\.js', html))):
    js = get(BASE + c)
    if 'nutritionPage' not in js and 'Cals' not in js: continue
    for m in re.finditer(r"JSON\.parse\('((?:[^'\\]|\\.)*)'\)", js):
        raw = m.group(1).replace("\\'", "'")
        for dec in (lambda x: x, lambda x: x.encode('latin-1', 'backslashreplace').decode('unicode_escape')):
            try: tables.append(json.loads(dec(raw))); break
            except Exception: continue
def slug(s): return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))
title = lambda s: re.sub(r"\b([A-Za-z])([A-Za-z']*)", lambda m: m.group(1).upper() + m.group(2).lower(), s.strip())
num = lambda v: float(v) if isinstance(v, (int, float)) or re.fullmatch(r'\d+(\.\d+)?', str(v)) else None
items = []; seen = {}
def add(cat, name, serving, kcal, extra=None):
    if kcal is None: return
    iid = f"pizza-nova--{slug(cat)}--{slug(name)}"; k = seen.get(iid, 0); seen[iid] = k + 1
    items.append(dict(id=iid if not k else f'{iid}-{k+1}', locationId='pizza-nova', category=cat, name=name, serving=serving, calories=kcal, source='chain', flags=['calories-only'] + (extra or [])))
for t in tables:
    if not t or not isinstance(t, list) or not isinstance(t[0], dict): continue
    keys = t[0].keys()
    if 'Cals' in keys:  # other favourites
        for r in t: add(title(r['Category']) + (' · ' + title(r['SubCategory']) if r.get('SubCategory') else ''), title(r['Product']), r.get('Serving Size') or None, num(r['Cals']))
    elif 'Product' in keys and 'SMALL' in keys:  # signature pizzas, per slice
        for r in t:
            for size in ('SMALL', 'MEDIUM', 'MEDIUM GLUTEN-FREE', 'LARGE', 'JUMBO', 'PARTY'):
                add(f"Signature Pizzas · {title(r['Category'])}", f"{title(r['Product'])} ({title(size)})", '1 slice', num(r.get(size)))
    elif 'Ingedient' in keys:  # build-your-own components, per slice (panzerotti = whole)
        for r in t:
            for size in ('SMALL', 'MEDIUM', 'LARGE', 'JUMBO', 'PARTY', 'PANZEROTTI'):
                add(f"Create Your Own · {title(r['Category'])}", f"{title(r['Ingedient'])} ({title(size)})", '1 panzerotti' if size == 'PANZEROTTI' else '1 slice', num(r.get(size)))
print(json.dumps({'items': items}, indent=1, ensure_ascii=False))
print(f'{len(items)} items from {len(tables)} tables', file=sys.stderr)
