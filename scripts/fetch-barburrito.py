#!/usr/bin/env python3
"""barBURRITO Canada: read the nutrition calculator on barburrito.ca and write data/seed/chains/barburrito.json.
  python3 scripts/fetch-barburrito.py > data/seed/chains/barburrito.json
The calculator sums selected components with size-dependent multipliers (see js/nutrition-calculator.js);
this script applies the same multipliers so each component is stored at the quantity used for that item/size.
Log a custom order by adding its components (tortilla + protein + toppings + sauces) for the same size."""
import json, re, sys, urllib.request
from html.parser import HTMLParser
URL = 'https://www.barburrito.ca/nutrition-information/'
html = urllib.request.urlopen(urllib.request.Request(URL, headers={'user-agent': 'Mozilla/5.0'}), timeout=60).read().decode()
def slug(s): return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))
class P(HTMLParser):
    def __init__(s):
        super().__init__(); s.stack = []; s.rows = []; s.labels = {}; s.cur_for = None; s.buf = ''
    def handle_starttag(s, t, a):
        a = dict(a); s.stack.append((t, a))
        if t == 'label' and a.get('for'): s.cur_for = a['for']; s.buf = ''
        if t == 'input' and a.get('type') in ('radio', 'checkbox'):
            fs = [x[1] for x in s.stack if x[0] == 'fieldset']
            s.rows.append((a, [(f.get('data-item-fieldset'), f.get('data-item-tortilla-size')) for f in fs]))
    def handle_data(s, d):
        if s.cur_for: s.buf += d
    def handle_endtag(s, t):
        if t == 'label' and s.cur_for: s.labels[s.cur_for] = re.sub(r'\s+', ' ', s.buf).strip(); s.cur_for = None
        while s.stack and s.stack[-1][0] != t: s.stack.pop()
        if s.stack: s.stack.pop()
p = P(); p.feed(html)
GROUP = {'select_protein': 'Protein', 'select_base_toppings': 'Base toppings', 'select_additional_toppings': 'Additional toppings',
         'select_sauces': 'Sauces', 'combo': 'Combo add-on', 'select_included': 'Included', 'select_tortilla': 'Tortilla'}
sizes = {}  # menu type -> [(value,label)]
for a, fs in p.rows:
    if a.get('name') == 'select_size': sizes.setdefault(fs[0][0], []).append((a['value'], p.labels.get(a['id'], a['value'])))
def mult(kind, size, name, value):
    """Mirror of js/nutrition-calculator.js toppings multipliers."""
    if kind == 'burritos':
        base = {'regular': 1.5, 'large': 2, 'bowl': 1.5}.get(size, 1)
        if name == 'select_protein': return {'large': 3, 'bowl': 2, 'regular': 2}.get(size, base)
        if name == 'select_base_toppings': return base
        return 1
    if kind == 'quesadillas': return 2 if name in ('select_protein', 'select_base_toppings') else 1
    if kind == 'tacos':
        base = 2 if size == '3tacos' else 0.6666666667
        if name == 'select_protein': return 3 if value == 'fish' else base
        if name == 'select_base_toppings': return 1.5 if value == 'cheese' else base
        if name == 'select_tortilla_3tacos': return 3
        return 1
    return 1
F = {'calories': 'data-calories', 'fat': 'data-fat', 'satFat': 'data-sat-fat', 'cholesterol': 'data-choles', 'sodium': 'data-sodium',
     'carbs': 'data-carbs', 'fiber': 'data-fibre', 'sugar': 'data-sugar', 'protein': 'data-protein', 'calcium': 'data-calcium', 'iron': 'data-iron'}
items = []; seen = {}
for kind, szs in sizes.items():
    for size, size_label in szs:
        for a, fs in p.rows:
            name = a.get('name'); fsk = [x for x in fs if x[0] == kind]
            if not fsk or name == 'select_size' or 'data-calories' not in a: continue
            tort = [x[1] for x in fs if x[1]]  # tortilla fieldset only applies to its own size
            if tort and tort[0] != size: continue
            if kind == 'burritos' and name == 'select_protein' and a['value'] == 'bang bang shrimp' and size != 'regular': continue
            m = mult(kind, size, name, a['value'])
            g = 'Tortilla' if name.startswith('select_tortilla') else GROUP.get(name, name)
            lab = p.labels.get(a['id'], a['value'])
            it = dict(locationId='barburrito', category=f"{kind.title()} · {size_label} · {g}", name=f"{lab} ({kind[:-1] if kind != 'tacos' else 'taco'}, {size_label})",
                      serving=f"{round(float(a['data-serving-size']) * m)} g" if a.get('data-serving-size') else None, source='chain', flags=[])
            for k, attr in F.items():
                try: it[k] = round(float(a[attr]) * m, 1)
                except (KeyError, ValueError): it[k] = None
            if m != 1: it['flags'].append(f'scaled-x{round(m, 2)}')
            iid = f"barburrito--{slug(it['category'])}--{slug(lab)}"; k = seen.get(iid, 0); seen[iid] = k + 1
            it['id'] = iid if not k else f'{iid}-{k+1}'
            items.append(it)
print(json.dumps({'items': items}, indent=1, ensure_ascii=False))
print(f'{len(items)} items', {k: [s for s, _ in v] for k, v in sizes.items()}, file=sys.stderr)
