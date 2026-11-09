// Pure nutrition/date helpers shared by the app and the tests (no DOM access here).

export const MACROS = ['calories', 'protein', 'carbs', 'fat'];

/** Everything shown on the nutrition label, in label order. */
export const NUTRIENTS = [
  { key: 'calories', label: 'Calories', unit: 'kcal' },
  { key: 'fat', label: 'Fat', unit: 'g' },
  { key: 'satFat', label: 'Saturated', unit: 'g', sub: true },
  { key: 'cholesterol', label: 'Cholesterol', unit: 'mg' },
  { key: 'sodium', label: 'Sodium', unit: 'mg' },
  { key: 'carbs', label: 'Carbohydrate', unit: 'g' },
  { key: 'fiber', label: 'Fibre', unit: 'g', sub: true },
  { key: 'sugar', label: 'Sugars', unit: 'g', sub: true },
  { key: 'protein', label: 'Protein', unit: 'g' },
  { key: 'vitaminC', label: 'Vitamin C', unit: 'mg' },
  { key: 'calcium', label: 'Calcium', unit: '' },
  { key: 'iron', label: 'Iron', unit: '' },
];
const NUTRIENT_KEYS = NUTRIENTS.map((n) => n.key);

export const MEALS = [
  { id: 'breakfast', label: 'Breakfast' },
  { id: 'lunch', label: 'Lunch' },
  { id: 'dinner', label: 'Dinner' },
  { id: 'snacks', label: 'Snacks' },
];
export const mealLabel = (id) => MEALS.find((m) => m.id === id)?.label ?? 'Snacks';

/** Which meal a food eaten at this time most likely belongs to. */
export function mealForTime(d = new Date()) {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h >= 4 && h < 10.5) return 'breakfast';
  if (h >= 10.5 && h < 15) return 'lunch';
  if (h >= 17 && h < 21) return 'dinner';
  return 'snacks';
}

export const DEFAULT_GOALS = { calories: 2200, protein: 150, carbs: 250, fat: 70 };

// --- data-quality flags -------------------------------------------------------------------
const WARN = {
  'suspect-calories': 'Calories look far too high. This is probably an error in the source data.',
  'zero-calories': 'The source lists 0 kcal for this item.',
  'kcal-vs-macros-mismatch': 'Calories do not add up from the listed macros. Double-check before trusting it.',
  'verify-name': 'The name was read from a PDF and may be matched to the wrong row.',
};
const INFO = {
  'calories-only': 'Only calories are published for this item.',
  'derived-2x-from-6in': 'Footlong values are 2× the published 6-inch values.',
  'includes-default-modifiers': 'As served, including the default toppings / milk.',
};

export const hasWarning = (item) => !!item?.flags?.some((f) => f in WARN);

/** Human-readable notes for an item's flags: [{ level: 'warn'|'info', text }]. */
export function flagNotes(item) {
  const out = [];
  for (const f of item?.flags ?? []) {
    if (WARN[f]) out.push({ level: 'warn', text: WARN[f] });
    else if (INFO[f]) out.push({ level: 'info', text: INFO[f] });
    else if (f.startsWith('scaled-x')) out.push({ level: 'info', text: `Scaled ${f.slice(8)}× from the base size, the way the restaurant's calculator does.` });
  }
  return out;
}

// --- numbers ------------------------------------------------------------------------------
/** Round for display: whole numbers above 10, one decimal below; null -> "–". */
export function fmt(n) {
  if (n == null || Number.isNaN(n)) return '–';
  const r = Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
}

/** Copy just the nutrient numbers of a menu item (what a log entry stores, per 1 serving). */
export function snapshot(item) {
  const n = {};
  for (const k of NUTRIENT_KEYS) if (item[k] != null && Number.isFinite(Number(item[k]))) n[k] = Number(item[k]);
  return n;
}

/** Nutrients multiplied by a quantity; missing values stay missing. */
export function scale(n, qty) {
  const out = {};
  for (const k of NUTRIENT_KEYS) if (n?.[k] != null) out[k] = n[k] * qty;
  return out;
}

/** Sum of the four macros over log entries ({ qty, n }). */
export function totals(entries) {
  const t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  for (const e of entries) for (const k of MACROS) t[k] += (e.n?.[k] ?? 0) * (e.qty ?? 1);
  return t;
}

export const kcalFromMacros = ({ protein = 0, carbs = 0, fat = 0 }) => protein * 4 + carbs * 4 + fat * 9;

/** "410 kcal · P 22 · C 40 · F 17" (macros omitted when the source has calories only). */
export function macroLine(n, qty = 1) {
  const kcal = n?.calories == null ? '? kcal' : `${fmt(n.calories * qty)} kcal`;
  const parts = [['P', 'protein'], ['C', 'carbs'], ['F', 'fat']].filter(([, k]) => n?.[k] != null).map(([l, k]) => `${l} ${fmt(n[k] * qty)}`);
  return [kcal, ...parts].join(' · ');
}

/** "1.5 × Portion", or just the serving when qty is 1. */
export function servingLine(serving, qty = 1) {
  if (qty === 1) return serving || '1 serving';
  return `${fmt(qty)} × ${serving || 'serving'}`;
}

// --- dates (local time, keyed as YYYY-MM-DD) ----------------------------------------------
export function dateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return dateKey(d);
}
export const isDateKey = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && dateKey(parseKey(s)) === s;

/** "Today", "Yesterday", "Tomorrow" or "Mon, Nov 9". */
export function friendlyDate(key, todayKey = dateKey()) {
  if (key === todayKey) return 'Today';
  if (key === addDays(todayKey, -1)) return 'Yesterday';
  if (key === addDays(todayKey, 1)) return 'Tomorrow';
  const d = parseKey(key);
  const sameYear = d.getFullYear() === parseKey(todayKey).getFullYear();
  return d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}
