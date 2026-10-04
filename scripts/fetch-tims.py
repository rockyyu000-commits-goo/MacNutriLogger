#!/usr/bin/env python3
"""Fetch Tim Hortons Canada menu + nutrition from the public Sanity CMS behind timhortons.ca
and write data/seed/chains/tim-hortons-musc.json. Re-run to refresh.
  python3 scripts/fetch-tims.py > data/seed/chains/tim-hortons-musc.json
Uses nutritionWithModifiers (the item as ordered with its default toppings/milk) when present."""
import json, re, sys, urllib.request, urllib.error
URL = 'https://czqk28jt.api.sanity.io/v1/graphql/prod_th_ca/default'
LOCATION = 'tim-hortons-musc'
SKIP_SECTIONS = {'Merchandise', 'Tims® at Home'}
def gq(q, v=None):
    r = urllib.request.Request(URL, json.dumps({'query': q, 'variables': v or {}}).encode(), {'content-type': 'application/json'})
    try: return json.load(urllib.request.urlopen(r, timeout=120))
    except urllib.error.HTTPError as e: return json.load(e)
def slug(s): return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))
N = 'calories fat saturatedFat transFat cholesterol sodium carbohydrates fiber sugar proteins weight'
ITEM = f'_id name{{en}} nutrition{{{N}}} nutritionWithModifiers{{{N}}}'
PICKER = f'_id name{{en}} pickerAspects{{ _id name{{en}} pickerAspectOptions{{ identifier name{{en}} }} }} options{{ pickerItemMappings{{ pickerAspectValueIdentifier pickerAspect{{_id}} }} option{{ __typename ... on Item{{ {ITEM} }} }} }}'
LEAF = f'__typename ... on Item{{ {ITEM} }} ... on Picker{{ {PICKER} }}'
Q = f'query($id:ID!){{ Menu(id:$id){{ options{{ __typename ... on Section{{ _id name{{en}} options{{ {LEAF} ... on Section{{ _id name{{en}} options{{ {LEAF} }} }} }} }} }} }} }}'
mid = gq('{ allFeatureMenus { defaultMenu { _id } } }')['data']['allFeatureMenus'][0]['defaultMenu']['_id']
menu = gq(Q, {'id': mid})['data']['Menu']['options']

def walk(o, path):
    t = o['__typename']
    if t == 'Section':
        for c in o.get('options') or []: yield from walk(c, path + [o['name']['en']])
    elif t == 'Picker' and 'pickerAspects' in o:
        asp = {a['_id']: {x['identifier']: x['name']['en'] for x in a['pickerAspectOptions']} for a in o['pickerAspects']}
        for op in o['options']:
            it = op['option']
            if not it or it.get('__typename') != 'Item': continue
            lab = [asp.get(m['pickerAspect']['_id'], {}).get(m['pickerAspectValueIdentifier'], m['pickerAspectValueIdentifier']) for m in op['pickerItemMappings']]
            yield path, o['name']['en'], lab, it
    elif t == 'Item' and 'nutrition' in o: yield path, o['name']['en'], [], o

r1 = lambda x: None if x is None else round(x, 1)
items = []; seen = {}
for path, name, lab, it in walk({'__typename': 'Section', 'name': {'en': 'root'}, 'options': menu}, []):
    if len(path) < 2 or path[1] in SKIP_SECTIONS or 'Yes' in lab: continue  # 'Yes' = reusable-cup duplicate
    base, mod = it['nutrition'] or {}, it['nutritionWithModifiers'] or {}
    n = mod if mod.get('calories') is not None else base
    if n.get('calories') is None: continue
    label = ' '.join(l for l in lab if l != 'No')
    clean = lambda x: re.sub(r'\s+', ' ', x).strip()
    full = clean(f"{name} - {label}" if label else name)
    cat = ' · '.join(clean(x) for x in path[1:])
    iid = f"tims--{slug(cat)}--{slug(full)}"
    k = seen.get(iid, 0); seen[iid] = k + 1
    if k: iid += f'-{k+1}'
    v = lambda key: r1(n.get(key))
    kcal = round(n['calories']); est = 4 * (v('proteins') or 0) + 4 * max((v('carbohydrates') or 0) - (v('fiber') or 0), 0) + 9 * (v('fat') or 0)
    flags = []
    if mod.get('calories') is not None and base.get('calories') is not None and round(mod['calories']) != round(base['calories']): flags.append('includes-default-modifiers')
    if kcal > 50 and abs(est - kcal) / kcal > .4: flags.append('kcal-vs-macros-mismatch')
    items.append(dict(id=iid, locationId=LOCATION, category=cat, name=full, serving=f"{round(n['weight'])} g" if n.get('weight') else None,
        calories=kcal, fat=v('fat'), satFat=v('saturatedFat'), cholesterol=v('cholesterol'), sodium=v('sodium'), carbs=v('carbohydrates'),
        fiber=v('fiber'), sugar=v('sugar'), protein=v('proteins'), flags=flags, source='chain'))
print(json.dumps({'items': items}, indent=1, ensure_ascii=False))
