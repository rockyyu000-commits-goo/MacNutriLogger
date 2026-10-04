#!/usr/bin/env python3
"""Single-line-row nutrition PDFs (pdftotext -layout) -> chain seed JSON.
  pdftotext -layout guide.pdf g.txt && python3 scripts/parse-layout-pdf.py quesada g.txt > data/seed/chains/quesada.json
Chains: quesada (Aug 2026 'regular portions' PDF), sushi-shop (2026 'ss-tvn' PDF). Column orders were read from the PDF headers."""
import json, re, sys
CONFIG = {
    'quesada':    dict(loc='quesada-burritos-tacos', families={'REGULAR BURRITOS', 'NACHOS', 'FOR BIG ASS BURRITOS', 'PRE-BUILT MAPLE CHIPOTLE', 'PRE-BUILT MAPLE', 'ROLLITOS EACH', 'DESSERTS', 'SIDES - SMALL 2 OZ', 'SIDES - LARGE 4 OZ', 'KIDS MEALS'}, cols=['calories', 'fat', 'satFat', None, 'cholesterol', 'sodium', 'protein', 'carbs', 'sugar', 'fiber'], n=10,
                       subs={'TORTILLAS', 'TORTILLAS & TACO SHELLS', 'HOT TOPPINGS', 'PROTEINS', 'COLD TOPPINGS', 'SALSA & SAUCES', 'SALSAS & SAUCES'}),
    'sushi-shop': dict(loc='sushi-shop-main-st-west', cols=['serving', 'calories', 'fat', 'satFat', None, 'cholesterol', 'sodium', 'carbs', 'fiber', 'sugar', 'protein', None, 'calcium', 'iron'], n=14, subs=set(), families=None),
}
chain = sys.argv[1]; cfg = CONFIG[chain]
def slug(s): return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))
items = []; seen = {}; family = sub = None; pending = ''
ROW = re.compile(r'^[\s★]*(?:New\s+)?(\S.*?)\s{2,}((?:[\d.]+\s+){%d}[\d.]+)\s*(.*)$' % (cfg['n'] - 1))
for ln in open(sys.argv[2], encoding='utf-8'):
    ln = ln.rstrip(); m = ROW.match(ln)
    if m:
        name = re.sub(r'\s+', ' ', m.group(1)).strip(); v = [float(x) for x in m.group(2).split()]
        cat = ' · '.join(x.title() for x in (family, sub) if x) or 'Menu'
        it = dict(locationId=cfg['loc'], category=cat, name=name, source='chain', flags=[])
        for c, x in zip(cfg['cols'], v):
            if c == 'serving': it['serving'] = f'{x:g} g'
            elif c: it[c] = x
        kcal = it['calories']; est = 4 * it.get('protein', 0) + 4 * max(it.get('carbs', 0) - it.get('fiber', 0), 0) + 9 * it.get('fat', 0)
        if kcal > 50 and abs(est - kcal) / kcal > .4: it['flags'].append('kcal-vs-macros-mismatch')
        iid = f"{cfg['loc']}--{slug(cat)}--{slug(name)}"; k = seen.get(iid, 0); seen[iid] = k + 1
        it['id'] = iid if not k else f'{iid}-{k+1}'
        items.append(it); continue
    t = ln.strip()
    if t and re.fullmatch(r"[A-Z0-9 &/'\"\-,.()]{4,60}", t) and not re.search(r'\((G|MG|KCAL)\)', t):
        if t in cfg['subs']: sub = t
        elif cfg['families'] is None or t in cfg['families']: family, sub = t, None
    elif t and cfg['subs'] == set() and re.match(r'^[A-Z][A-Z &/0-9,\'-]+( / .*)?$', t) and len(t) < 60 and not re.search(r'\d{2,}\s', t):
        family = t
print(json.dumps({'items': items}, indent=1, ensure_ascii=False))
print(f'{len(items)} items', file=sys.stderr)
