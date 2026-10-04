#!/usr/bin/env python3
"""Convert Subway Canada's nutrition PDF (pdftotext -layout output) to data/seed/chains/subway.json.
Usage: pdftotext -layout CAN_Nutrition.pdf n.txt && python3 scripts/parse-subway-pdf.py n.txt > data/seed/chains/subway.json
Columns: serving g, kcal, fat, sat fat, trans fat, cholesterol, sodium, carbs, fibre, sugars, protein, calcium %DV, iron %DV"""
import re, sys, json
TOP = {'SANDWICHES','WRAPS','SALADS','POWER BOWLS','BREAKFAST','BREADS & CONDIMENTS','DESSERTS & SIDES'}
SKIP = ('Values','Double','information','(one','Nutrition','CANADA','October','Adults','*','1 ','Some','The gluten','dressing','information')
def slug(s): return re.sub(r'^-|-$','',re.sub(r'[^a-z0-9]+','-',s.lower()))
top = cat = None; items = []; seen = {}
for ln in open(sys.argv[1], encoding='utf-8'):
    ln = ln.rstrip()
    m = re.match(r'^\s*(\S.*?)\s{2,}((?:\d+\s+)+\d+)\s*$', ln)
    if m and len(m.group(2).split()) == 13:
        v = [int(x) for x in m.group(2).split()]
        name = re.sub(r'[®™]|\*+|\s+\d$', '', m.group(1)).strip()
        name = re.sub(r'\s+', ' ', name)
        base = f"subway--{slug(cat or top)}--{slug(name)}"
        n = seen.get(base, 0); seen[base] = n + 1
        iid = base if n == 0 else f"{base}-{n+1}"
        sixinch = bool(cat and cat.startswith('6"') and 'Fresh Fit' not in (cat or '') or cat in ('6" Fresh Fit','6" Breakfast Sandwiches'))
        it = dict(id=iid, locationId='subway', category=cat or top, name=name,
                  serving=f"{v[0]} g", calories=v[1], fat=v[2], satFat=v[3], cholesterol=v[5], sodium=v[6],
                  carbs=v[7], fiber=v[8], sugar=v[9], protein=v[10], calcium=v[11], iron=v[12], source='chain')
        items.append(it)
        if cat and (cat.startswith('6"') and 'Offer' not in cat):  # footlong = 2 x 6" per Subway's note
            d = dict(it, id=iid + '-footlong', name=name + ' (Footlong)', serving=f"{v[0]*2} g", flags=['derived-2x-from-6in'])
            for k in ('calories','fat','satFat','cholesterol','sodium','carbs','fiber','sugar','protein'): d[k] = it[k]*2
            items.append(d)
        continue
    head = re.match(r'^\s*(\S.*?)(\s{2,}|$)', ln)
    if head and not re.search(r'\d{2,}\s*$', ln):
        t = head.group(1).strip()
        if t in TOP: top, cat = t.title(), None
        elif t and not t.startswith(SKIP) and len(t) < 120 and top: cat = re.sub(r'\s*\(.*$', '', t.replace('**','')).strip()
print(json.dumps({'items': items}, indent=1, ensure_ascii=False))
