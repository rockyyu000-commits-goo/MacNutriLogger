// Bottom sheets: food details (add / edit an entry) and quick add.
import { app, currentMeal, logItem, placeName } from './app.js';
import { MEALS, NUTRIENTS, flagNotes, fmt, mealLabel, scale } from './lib/nutrition.js';
import { $, $$, closeSheet, html, icon, openSheet, setHTML, star, toast } from './ui.js';

const mealPicker = (selected) => html`
  <div class="seg" role="radiogroup" aria-label="Meal">
    ${MEALS.map((m) => html`<button type="button" role="radio" aria-checked="${m.id === selected}" data-meal="${m.id}">${m.label}</button>`)}
  </div>`;

function factsTable(n, qty) {
  const s = scale(n, qty);
  const rows = NUTRIENTS.filter((x) => s[x.key] != null);
  if (!rows.length) return html`<p class="muted">No nutrition published for this item.</p>`;
  return html`<table class="facts"><tbody>
    ${rows.map((x) => html`<tr class="${x.sub ? 'sub' : ''}${x.key === 'calories' ? ' kcal' : ''}"><th scope="row">${x.label}</th><td>${fmt(s[x.key])}${x.unit ? ' ' + x.unit : ''}</td></tr>`)}
  </tbody></table>`;
}

/**
 * Shared sheet for a menu item or an existing log entry.
 * opts: { title, sub, serving, n, notes, qty, meal, favId, primary(meal, kcal), onSubmit({qty, meal}), onRemove }
 */
function foodSheet(opts) {
  let qty = opts.qty ?? 1;
  let meal = opts.meal ?? currentMeal();
  const root = openSheet(html`
    <header class="sheet-head">
      <div>
        <h2>${opts.title}</h2>
        <p class="muted">${opts.sub}</p>
      </div>
      ${opts.favId ? html`<button type="button" class="icon-btn" data-fav aria-label="Favourite" aria-pressed="false"></button>` : ''}
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
    </header>
    ${(opts.notes ?? []).map((n) => html`<p class="note ${n.level}">${n.level === 'warn' ? icon('warn') : ''}<span>${n.text}</span></p>`)}
    <div class="qty">
      <label for="qty">Servings <span class="muted">× ${opts.serving || '1 serving'}</span></label>
      <div class="stepper">
        <button type="button" data-step="-0.5" aria-label="Less">−</button>
        <input id="qty" type="number" inputmode="decimal" min="0.25" max="99" step="0.25" value="${qty}">
        <button type="button" data-step="0.5" aria-label="More">+</button>
      </div>
    </div>
    ${mealPicker(meal)}
    <div id="facts"></div>
    <div class="sheet-actions">
      ${opts.onRemove ? html`<button type="button" class="btn danger" data-remove>Remove</button>` : ''}
      <button type="button" class="btn primary" data-submit></button>
    </div>`);

  const update = () => {
    setHTML($('#facts', root), factsTable(opts.n, qty));
    $('[data-submit]', root).textContent = opts.primary(meal, opts.n.calories == null ? null : opts.n.calories * qty);
    $$('[data-meal]', root).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.meal === meal)));
    const fav = $('[data-fav]', root);
    if (fav) {
      const on = app.store.favItems().includes(opts.favId);
      fav.setAttribute('aria-pressed', String(on));
      setHTML(fav, star(on));
    }
  };
  const setQty = (v, writeBack = true) => {
    if (!Number.isFinite(v) || v <= 0) return;
    qty = Math.min(99, Math.max(0.25, Math.round(v * 100) / 100));
    if (writeBack) $('#qty', root).value = qty;
    update();
  };

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.step) setQty(qty + Number(t.dataset.step) < 0.25 ? 0.25 : qty + Number(t.dataset.step));
    else if (t.dataset.meal) { meal = t.dataset.meal; update(); }
    else if ('fav' in t.dataset) { app.store.toggleFavItem(opts.favId); update(); }
    else if ('submit' in t.dataset) { closeSheet(); opts.onSubmit({ qty, meal }); }
    else if ('remove' in t.dataset) { closeSheet(); opts.onRemove(); }
  });
  $('#qty', root).addEventListener('input', (e) => setQty(Number(e.target.value), false));
  $('#qty', root).addEventListener('blur', (e) => { e.target.value = qty; });
  update();
}

const kcalSuffix = (kcal) => (kcal == null ? '' : ` · ${fmt(kcal)} kcal`);

/** Details for a menu item, with "Add to <meal>". */
export function itemSheet(item) {
  const loc = app.locById.get(item.locationId);
  foodSheet({
    title: item.name,
    sub: [loc?.name, item.category, item.course, item.price != null ? `$${item.price.toFixed(2)}` : null].filter(Boolean).join(' · '),
    serving: item.serving,
    n: item, // scale() only reads the nutrient keys
    notes: flagNotes(item),
    favId: item.id,
    primary: (meal, kcal) => `Add to ${mealLabel(meal)}${kcalSuffix(kcal)}`,
    onSubmit: ({ qty, meal }) => { logItem(item, { qty, meal }); app.rerender(); },
  });
}

/** Edit or remove something already in the diary. */
export function entrySheet(date, entry) {
  const item = entry.itemId ? app.itemById.get(entry.itemId) : null;
  foodSheet({
    title: entry.name,
    sub: entry.place || 'Quick add',
    serving: entry.serving,
    n: entry.n,
    notes: item ? flagNotes(item) : [],
    favId: item ? item.id : null,
    qty: entry.qty,
    meal: entry.meal,
    primary: (_meal, kcal) => `Save${kcalSuffix(kcal)}`,
    onSubmit: ({ qty, meal }) => { app.store.updateEntry(date, entry.id, { qty, meal }); app.rerender(); },
    onRemove: () => {
      app.store.removeEntry(date, entry.id);
      app.rerender();
      toast('Removed', { label: 'Undo', run: () => { app.store.addEntry(date, entry); app.rerender(); } });
    },
  });
}

/** Log something that isn't on any menu: a name and whatever numbers you know. */
export function quickAddSheet() {
  let meal = currentMeal();
  const field = (name, label, unit) => html`
    <label class="field"><span>${label}${unit ? html` <span class="muted">${unit}</span>` : ''}</span>
      <input name="${name}" type="number" inputmode="decimal" min="0" step="any" placeholder="0"></label>`;
  const root = openSheet(html`
    <header class="sheet-head">
      <div><h2>Quick add</h2><p class="muted">For food that isn't on a menu here.</p></div>
      <button type="button" class="icon-btn" data-close aria-label="Close">${icon('close')}</button>
    </header>
    <form id="quick" novalidate>
      <label class="field wide"><span>Name</span><input name="name" type="text" maxlength="80" placeholder="e.g. Homemade pasta" autocomplete="off"></label>
      <div class="grid4">
        ${field('calories', 'Calories', 'kcal')}${field('protein', 'Protein', 'g')}${field('carbs', 'Carbs', 'g')}${field('fat', 'Fat', 'g')}
      </div>
      ${mealPicker(meal)}
      <p class="form-error" id="quick-error" hidden></p>
      <div class="sheet-actions"><button type="submit" class="btn primary">Add</button></div>
    </form>`);

  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-meal]');
    if (!t) return;
    meal = t.dataset.meal;
    $$('[data-meal]', root).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.meal === meal)));
  });
  $('#quick', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const n = {};
    for (const k of ['calories', 'protein', 'carbs', 'fat']) {
      const v = String(f.get(k)).trim();
      if (v === '') continue;
      if (!Number.isFinite(Number(v)) || Number(v) < 0) return fail(`${k[0].toUpperCase() + k.slice(1)} must be a number, 0 or more.`);
      n[k] = Number(v);
    }
    if (!Object.keys(n).length) return fail('Enter at least the calories.');
    const date = app.date;
    const entry = app.store.addEntry(date, { itemId: null, name: String(f.get('name')).trim() || 'Quick add', qty: 1, meal, at: Date.now(), n });
    closeSheet();
    app.rerender();
    toast(`Added to ${mealLabel(meal)}`, { label: 'Undo', run: () => { app.store.removeEntry(date, entry.id); app.rerender(); } });
  });
  function fail(msg) {
    const el = $('#quick-error', root);
    el.textContent = msg;
    el.hidden = false;
  }
}

/** Compact, tappable row for a menu item: tap the text for details, "+" to log one serving. */
export function itemRow(item, { showPlace = false } = {}) {
  const warn = item.flags?.some((f) => ['suspect-calories', 'zero-calories', 'kcal-vs-macros-mismatch', 'verify-name'].includes(f));
  const kcal = item.calories == null ? '? kcal' : `${fmt(item.calories)} kcal`;
  const macros = [['P', item.protein], ['C', item.carbs], ['F', item.fat]].filter(([, v]) => v != null).map(([l, v]) => `${l} ${fmt(v)}`).join(' · ');
  const lead = showPlace ? placeName(item) : item.serving;
  return html`<li class="row">
    <button type="button" class="row-main" data-item="${item.id}">
      <span class="row-title">${item.name}${warn ? html` <span class="warn-mark" title="Check this data">${icon('warn')}</span>` : ''}</span>
      <span class="row-sub">${lead ? html`${lead} · ` : ''}<b>${kcal}</b>${macros ? ` · ${macros}` : ''}</span>
    </button>
    <button type="button" class="add" data-add="${item.id}" aria-label="Add ${item.name}">${icon('plus')}</button>
  </li>`;
}

/** Handle taps on rows produced by itemRow. Returns true if the click was handled. */
export function handleItemClick(e) {
  const add = e.target.closest('[data-add]');
  if (add) {
    const item = app.itemById.get(add.dataset.add);
    if (item) { logItem(item); app.rerender({ keepScroll: true }); }
    return true;
  }
  const open = e.target.closest('[data-item]');
  if (open) {
    const item = app.itemById.get(open.dataset.item);
    if (item) itemSheet(item);
    return true;
  }
  return false;
}
