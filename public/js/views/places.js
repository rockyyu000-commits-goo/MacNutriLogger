// Places: favourites, on campus, chains, other nearby. Each place opens its own menu page.
import { app } from '../app.js';
import { normalize } from '../lib/search.js';
import { html, icon, setHTML, star } from '../ui.js';

let query = '';

const count = (l) => app.itemsByLoc.get(l.id)?.length ?? 0;

function placeRow(l, favs) {
  const n = count(l);
  const sub = [l.cuisine, l.priceRange, l.address].filter(Boolean).join(' · ');
  return html`<li class="row">
    <a class="row-main" href="#/place/${encodeURIComponent(l.id)}">
      <span class="row-title">${l.name}</span>
      <span class="row-sub">${n ? html`<b>${n} items</b>` : 'No nutrition yet'}${sub ? ` · ${sub}` : ''}</span>
    </a>
    <button type="button" class="icon-btn" data-fav="${l.id}" aria-label="Favourite ${l.name}" aria-pressed="${favs.has(l.id)}">${star(favs.has(l.id))}</button>
  </li>`;
}

function groupsHtml() {
  const favs = new Set(app.store.favPlaces());
  const q = normalize(query);
  const tokens = q ? q.split(' ') : [];
  const locs = app.locations.filter((l) => {
    if (l.active === false) return false;
    const hay = normalize(`${l.name} ${l.cuisine ?? ''} ${l.brand ?? ''} ${l.address ?? ''}`);
    return tokens.every((t) => hay.includes(t));
  });
  // Places with nutrition first, then alphabetical.
  const sorted = (list) => list.sort((a, b) => (count(b) > 0) - (count(a) > 0) || a.name.localeCompare(b.name));
  const campus = (l) => l.source === 'mcmaster';
  const groups = [
    ['Favourites', locs.filter((l) => favs.has(l.id))],
    ['On campus', locs.filter((l) => campus(l) && !favs.has(l.id))],
    ['Chains', locs.filter((l) => !campus(l) && l.brand && !favs.has(l.id))],
    ['Other nearby', locs.filter((l) => !campus(l) && !l.brand && !favs.has(l.id))],
  ].filter(([, list]) => list.length);
  if (!groups.length) return html`<p class="empty">No places match “${query}”.</p>`;
  return groups.map(([title, list]) => html`
    <section>
      <header class="section-head"><h2>${title}</h2><span class="muted">${list.length}</span></header>
      <ul class="list card">${sorted(list).map((l) => placeRow(l, favs))}</ul>
    </section>`);
}

export function render(root, _param, { signal }) {
  if (!app.locations.length) {
    setHTML(root, app.status === 'loading'
      ? html`<p class="empty">Loading menus…</p>`
      : html`<p class="empty">No places loaded. ${app.status === 'error' ? 'The server could not be reached.' : html`Add some in <a href="/admin.html">admin</a>.`}</p>`);
    return;
  }
  setHTML(root, html`
    <div class="searchbar">${icon('search')}<input type="search" id="place-q" placeholder="Find a place or cuisine" value="${query}" autocomplete="off" enterkeyhint="search"></div>
    <div id="groups">${groupsHtml()}</div>`);
  const groups = root.querySelector('#groups');
  root.addEventListener('input', (e) => {
    if (e.target.id !== 'place-q') return;
    query = e.target.value;
    setHTML(groups, groupsHtml());
  }, { signal });
  root.addEventListener('click', (e) => {
    const fav = e.target.closest('[data-fav]');
    if (!fav) return;
    app.store.toggleFavPlace(fav.dataset.fav);
    setHTML(groups, groupsHtml());
  }, { signal });
}
