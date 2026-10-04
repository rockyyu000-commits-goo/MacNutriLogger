#!/usr/bin/env python3
"""Mr.Sub nutrition PDF (pdftotext -layout) -> data/seed/chains/mr-sub.json
pdftotext -layout MR-SUB-Nutritional-Facts.pdf n.txt && python3 scripts/parse-mrsub-pdf.py n.txt > data/seed/chains/mr-sub.json
First 11 numeric columns: serving g, kcal, fat, sat fat, trans fat, cholesterol, sodium, carbs, fibre, sugars, protein.
The build-your-own tables are split into Small / Large / Kid's / Breakfast blocks by position in the PDF."""
import re, sys, json
def slug(s): return re.sub(r'^-|-$','',re.sub(r'[^a-z0-9]+','-',s.lower()))
GROUPS = {"kid's meal": "Kid's Meal", 'sweet treats': 'Sweet Treats', 'breakfast (where available)': 'Breakfast',
          'coffee, baked goods, muffins & bagels (where available)': 'Coffee & Baked Goods'}
group = 'Signature Subs'; breads = 0; section = None; items = []; seen = {}; warn = []
for pi, pg in enumerate(open(sys.argv[1], encoding='utf-8').read().split('\f')):
    for ln in pg.split('\n'):
        p = ln.split()
        while p and re.fullmatch(r'[a-zA-Z]{1,3}', p[-1]): p.pop()  # allergen markers (a, aa, ...)
        k = 0
        while k < len(p) and re.fullmatch(r'[\d.]+', p[-1-k]): k += 1
        if k >= 10:
            v = [float(x) for x in p[len(p)-k:][:11]]
            name = ' '.join(p[:len(p)-k]).strip()
            if not name: continue
            kcal = v[1]; est = 4*v[10] + 4*max(v[7]-v[8], 0) + 9*v[2]
            fl = ['kcal-vs-macros-mismatch'] if kcal > 50 and abs(est-kcal)/kcal > .4 else []
            it = dict(locationId='mr-sub', category=f'{group} · {section}' if section else group, name=name,
                      serving=f'{v[0]:g} g', calories=v[1], fat=v[2], satFat=v[3], cholesterol=v[5], sodium=v[6], carbs=v[7], fiber=v[8], sugar=v[9], protein=v[10], flags=fl, source='chain')
            base = f"mr-sub--{slug(it['category'])}--{slug(name)}"; n = seen.get(base, 0); seen[base] = n + 1
            it['id'] = base if n == 0 else f'{base}-{n+1}'
            if fl: warn.append((it['category'], name, v[1], round(est)))
            items.append(it); continue
        t = ln.strip()
        if not t or re.search(r'\((g|mg|%)\)|^Calories|Nutritional Information|generated with|differences in|Enterprises|information listed', t) or len(t) > 80 or len(ln) - len(ln.lstrip()) > 60: continue
        low = t.lower()
        if low in GROUPS: group = GROUPS[low]; section = None
        elif low == 'pick your bread':
            breads += 1
            if group in ('Signature Subs', 'Small', 'Large'): group = 'Small' if breads == 1 else 'Large'
            section = 'Bread'
        elif low == "kid's meal": group = "Kid's Meal"
        else: section = t.title() if t.islower() else t
print(json.dumps({'items': items}, indent=1, ensure_ascii=False))
for w in warn: print('WARN', w, file=sys.stderr)
