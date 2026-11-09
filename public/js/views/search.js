// Search every menu at once. With an empty box it shows favourite foods and recently logged ones.
import { app, currentMeal, relogEntry } from '../app.js';
import { MEALS, dateKey, fmt, friendlyDate, macroLine, servingLine } from '../lib/nutrition.js';
import { SORTS, search } from '../lib/search.js';
import { handleItemClick, itemRow } from '../sheets.js';
import { html, icon, setHTML } from '../ui.js';

const LIMIT = 60;
const SCOPES = {
  all: { label: 'Everywhere', test: () => true },
  campus: { label: 'On campus', test: (i) => app.locById.get(i.locationId)?.source === 'mcmaster' },
  chains: { label: 'Chains', test: (i) => app.locById.get(i.locationId)?.source !== 'mcmaster' },
  favs: { label: 'Favourite places', test: (i, favs) => favs.has(i.locationId) },
};
const state = { query: '', scope: 'all', sort: 'relevance' };

const recentRow = (e) => html`<li class="row">
  <div class="row-main static">
    <span class="row-title">${e.name}</span>
    <span class="row-sub">${e.place ? html`${e.place} · ` : ''}${servingLine(e.serving, e.qty)} · <b>${macroLine(e.n, e.qty)}</b></span>
  </div>
  <button type="button" class="add" data-relog="${e.id}" aria-label="Add ${e.name} again">${icon('plus')}</button>
</li>`;

function resultsHtml(recent) {
  if (!state.query.trim() && state.sort === 'relevance' && state.scope === 'all') {
    const favs = app.store.favItems().map((id) => app.itemById.get(id)).filter(Boolean);
    if (!favs.length && !recent.length) return html`<p class="empty">Search ${fmt(app.items.length)} foods from ${app.locations.length} places.<br>Tip: tap a food's name for full nutrition and to set servings.</p>`;
    return html`
      ${favs.length ? html`<section><header class="section-head"><h2>Favourite foods</h2></header><ul class="list card">${favs.map((i) => itemRow(i, { showPlace: true }))}</ul></section>` : ''}
      ${recent.length ? html`<section><header class="section-head"><h2>Recent</h2></header><ul class="list card">${recent.map(recentRow)}</ul></section>` : ''}`;
  }
  const favPlaces = new Set(app.store.favPlaces());
  const scope = SCOPES[state.scope];
  const { items, total } = search(app.index, state.query, { limit: LIMIT, sort: state.sort, filter: (i) => scope.test(i, favPlaces) });
  if (!items.length) return html`<p class="empty">No foods match${state.query.trim() ? html` “${state.query.trim()}”` : ''}${state.scope !== 'all' ? ` in ${scope.label.toLowerCase()}` : ''}.</p>`;
  return html`<ul class="list card">${items.map((i) => itemRow(i, { showPlace: true }))}</ul>
    ${total > items.length ? html`<p class="muted center">Showing ${items.length} of ${fmt(total)}. Type more to narrow it down.</p>` : ''}`;
}

export function render(root, _param, { signal }) {
  const meal = currentMeal();
  const recent = app.store.recent(12);
  setHTML(root, html`
    <div class="searchbar">${icon('search')}<input type="search" id="food-q" placeholder="Search foods, e.g. chicken wrap" value="${state.query}" autocomplete="off" enterkeyhint="search"></div>
    <div class="chips" role="radiogroup" aria-label="Where to search">
      ${Object.entries(SCOPES).map(([id, s]) => html`<button type="button" role="radio" class="chip" aria-checked="${id === state.scope}" data-scope="${id}">${s.label}</button>`)}
    </div>
    <div class="toolbar">
      <label class="inline">Adding to
        <select id="meal">${MEALS.map((m) => html`<option value="${m.id}" ${m.id === meal ? 'selected' : ''}>${m.label}</option>`)}</select>
        ${app.date !== dateKey() ? html`<span class="muted">(${friendlyDate(app.date)})</span>` : ''}
      </label>
      <label class="inline">Sort
        <select id="sort">${Object.entries(SORTS).map(([id, s]) => html`<option value="${id}" ${id === state.sort ? 'selected' : ''}>${s.label}</option>`)}</select>
      </label>
    </div>
    <div id="results">${resultsHtml(recent)}</div>`);

  const results = root.querySelector('#results');
  const refresh = () => setHTML(results, resultsHtml(app.store.recent(12)));
  root.addEventListener('input', (e) => {
    if (e.target.id === 'food-q') { state.query = e.target.value; refresh(); }
  }, { signal });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'sort') { state.sort = e.target.value; refresh(); }
    if (e.target.id === 'meal') app.meal = e.target.value;
  }, { signal });
  root.addEventListener('click', (e) => {
    const scope = e.target.closest('[data-scope]');
    if (scope) {
      state.scope = scope.dataset.scope;
      root.querySelectorAll('[data-scope]').forEach((b) => b.setAttribute('aria-checked', String(b === scope)));
      return refresh();
    }
    const relog = e.target.closest('[data-relog]');
    if (relog) {
      const entry = recent.find((x) => x.id === relog.dataset.relog) ?? app.store.recent(30).find((x) => x.id === relog.dataset.relog);
      if (entry) relogEntry(entry);
      return;
    }
    handleItemClick(e);
  }, { signal });
}
