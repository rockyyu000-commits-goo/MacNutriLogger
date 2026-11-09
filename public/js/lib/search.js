// Menu search: every word of the query must appear (at the start of a word, or anywhere for
// words of 4+ letters) in the item's name, category or place. Pure functions, used by the app and tests.

/** Lowercase, strip accents, collapse punctuation: "Café One – Crêpe" -> "cafe one crepe". */
export function normalize(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Precompute searchable text once per data load. */
export function buildIndex(items, locationById) {
  return items.map((item) => {
    const place = locationById.get(item.locationId);
    const name = normalize(item.name);
    return { item, name, hay: ` ${name} ${normalize(item.category)} ${normalize(item.course)} ${normalize(place?.name)} ${normalize(place?.brand)}` };
  });
}

// Shorter fragments only match at the start of a word, so "old" doesn't find "cold".
const MID_WORD = 4;

function score(entry, tokens, phrase) {
  let s = 0;
  for (const t of tokens) {
    const inName = entry.name.indexOf(t);
    if (inName === 0 || entry.name.includes(' ' + t)) s += 10; // word start in the name
    else if (inName > 0 && t.length >= MID_WORD) s += 4; // "burger" in "cheeseburger"
    else if (entry.hay.includes(' ' + t)) s += 2; // category / place
    else if (t.length >= MID_WORD && entry.hay.includes(t)) s += 1;
    else return -1; // every token must match
  }
  if (entry.name === phrase) s += 30;
  else if (entry.name.startsWith(phrase)) s += 15;
  else if (entry.name.includes(phrase)) s += 6;
  return s - Math.min(entry.name.length, 60) / 60; // prefer short, specific names
}

export const SORTS = {
  relevance: { label: 'Best match' },
  'kcal-asc': { label: 'Fewest calories', key: (i) => i.calories, dir: 1 },
  'protein-desc': { label: 'Most protein', key: (i) => i.protein, dir: -1 },
  'density-desc': { label: 'Protein per 100 kcal', key: (i) => (i.protein != null && i.calories > 0 ? (i.protein / i.calories) * 100 : null), dir: -1 },
};

/**
 * @param index   from buildIndex
 * @param query   free text; empty matches everything that passes `filter`
 * @param opts    { limit, filter(item), sort: keyof SORTS }
 * @returns { items, total } best matches first
 */
export function search(index, query, { limit = 60, filter, sort = 'relevance' } = {}) {
  const phrase = normalize(query);
  const tokens = phrase ? phrase.split(' ') : [];
  const hits = [];
  for (const entry of index) {
    if (filter && !filter(entry.item)) continue;
    const s = tokens.length ? score(entry, tokens, phrase) : 0;
    if (s >= 0) hits.push({ item: entry.item, s });
  }
  const by = SORTS[sort]?.key;
  if (by) {
    // Items without the value (e.g. calories-only chains when sorting by protein) go last.
    const withVal = hits.map((h) => ({ ...h, v: by(h.item) }));
    const dir = SORTS[sort].dir;
    withVal.sort((a, b) => (a.v == null) - (b.v == null) || dir * (a.v - b.v) || b.s - a.s);
    return { items: withVal.slice(0, limit).map((h) => h.item), total: hits.length };
  }
  hits.sort((a, b) => b.s - a.s || a.item.name.localeCompare(b.item.name));
  return { items: hits.slice(0, limit).map((h) => h.item), total: hits.length };
}
