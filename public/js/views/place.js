// One place's menu: categories as collapsible folders (rendered on first open), with a filter box.
import { app } from '../app.js';
import { normalize } from '../lib/search.js';
import { handleItemClick, itemRow } from '../sheets.js';
import { html, icon, setHTML, star } from '../ui.js';

const SEP = ' · ';
const MAX_FLAT = 150;

// Per-place UI state, kept across re-renders so adding an item doesn't collapse the folders.
const state = { id: null, query: '', open: new Set() };

/** "Burritos · Small · Protein" -> folder "Burritos", sub-heading "Small · Protein". */
function split(item) {
  const [folder, ...rest] = (item.category || 'Menu').split(SEP);
  const sub = [...rest, item.course].filter((x) => x && x !== '~None').join(SEP);
  return { folder, sub };
}

function folders(items) {
  const map = new Map();
  for (const item of items) {
    const { folder, sub } = split(item);
    if (!map.has(folder)) map.set(folder, new Map());
    const subs = map.get(folder);
    if (!subs.has(sub)) subs.set(sub, []);
    subs.get(sub).push(item);
  }
  return map;
}

function folderBody(subs) {
  return [...subs].map(([sub, items]) => html`
    ${sub && subs.size > 1 ? html`<h3 class="sub-head">${sub}</h3>` : ''}
    <ul class="list">${items.map((i) => itemRow(i))}</ul>`);
}

function menuHtml(items) {
  const q = normalize(state.query);
  if (q) {
    const tokens = q.split(' ');
    const hits = items.filter((i) => { const hay = normalize(`${i.name} ${i.category ?? ''} ${i.course ?? ''}`); return tokens.every((t) => hay.includes(t)); });
    if (!hits.length) return html`<p class="empty">Nothing here matches “${state.query}”.</p>`;
    return html`<ul class="list card">${hits.slice(0, MAX_FLAT).map((i) => itemRow(i))}</ul>
      ${hits.length > MAX_FLAT ? html`<p class="muted center">Showing ${MAX_FLAT} of ${hits.length}. Type more to narrow it down.</p>` : ''}`;
  }
  const map = folders(items);
  const only = map.size === 1;
  return [...map].map(([folder, subs]) => {
    const n = [...subs.values()].reduce((a, l) => a + l.length, 0);
    const open = only || state.open.has(folder);
    return html`<details class="card folder" data-folder="${folder}" ${open ? 'open' : ''}>
      <summary><span>${folder}</span><span class="muted">${n}</span>${icon('chevron')}</summary>
      <div class="folder-body">${open ? folderBody(subs) : ''}</div>
    </details>`;
  });
}

export function render(root, param, { signal }) {
  const loc = app.locById.get(param);
  if (!loc) {
    setHTML(root, html`<p class="empty">${app.status === 'loading' ? 'Loading…' : html`That place isn't in the menu data. <a href="#/places">All places</a>`}</p>`);
    return;
  }
  if (state.id !== loc.id) { state.id = loc.id; state.query = ''; state.open = new Set(); }
  const items = app.itemsByLoc.get(loc.id) ?? [];
  const fav = app.store.favPlaces().includes(loc.id);
  const sub = [loc.cuisine, loc.priceRange, loc.address].filter(Boolean).join(' · ');

  setHTML(root, html`
    <header class="page-head">
      <a class="icon-btn" href="#/places" aria-label="All places">${icon('back')}</a>
      <div>
        <h2>${loc.name}</h2>
        <p class="muted">${sub || (loc.source === 'mcmaster' ? 'McMaster Hospitality Services' : '')}</p>
      </div>
      <button type="button" class="icon-btn" data-fav aria-label="Favourite" aria-pressed="${fav}">${star(fav)}</button>
    </header>
    ${items.length ? html`
      <div class="searchbar">${icon('search')}<input type="search" id="menu-q" placeholder="Filter ${items.length} items" value="${state.query}" autocomplete="off" enterkeyhint="search"></div>
      <div id="menu">${menuHtml(items)}</div>`
    : html`<p class="empty">No nutrition added for this place yet. You can log a meal here with <a href="#/today">Quick add</a>.</p>`}`);

  const menu = root.querySelector('#menu');
  const all = folders(items);
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'menu-q') return;
    state.query = e.target.value;
    setHTML(menu, menuHtml(items));
  }, { signal });
  // 'toggle' doesn't bubble, so listen in the capture phase; fill a folder the first time it opens.
  root.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.dataset?.folder) return;
    if (d.open) {
      state.open.add(d.dataset.folder);
      const body = d.querySelector('.folder-body');
      if (!body.firstElementChild) setHTML(body, folderBody(all.get(d.dataset.folder)));
    } else state.open.delete(d.dataset.folder);
  }, { capture: true, signal });
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-fav]')) { app.store.toggleFavPlace(loc.id); app.rerender(); return; }
    handleItemClick(e);
  }, { signal });
}
