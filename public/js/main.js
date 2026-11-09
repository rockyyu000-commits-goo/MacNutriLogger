// Boot: hash router, bottom navigation, service worker.
import { app, loadData } from './app.js';
import { dateKey, isDateKey } from './lib/nutrition.js';
import { $, $$, closeSheet, sheetOpen } from './ui.js';
import * as today from './views/today.js';
import * as places from './views/places.js';
import * as place from './views/place.js';
import * as search from './views/search.js';
import * as trends from './views/trends.js';
import * as settings from './views/settings.js';

const ROUTES = {
  today: { view: today, tab: 'today', title: 'Diary' },
  places: { view: places, tab: 'places', title: 'Places' },
  place: { view: place, tab: 'places', title: 'Places' },
  search: { view: search, tab: 'search', title: 'Search' },
  trends: { view: trends, tab: 'trends', title: 'Trends' },
  settings: { view: settings, tab: 'settings', title: 'Settings' },
};

const root = $('#view');
let abort = null;
let current = '';

function parse() {
  const [, name = 'today', ...rest] = location.hash.split('/');
  let param = rest.join('/');
  try { param = decodeURIComponent(param); } catch { /* keep raw */ }
  return ROUTES[name] ? { name, param } : { name: 'today', param: '' };
}

/** Render the current route. Scroll and input focus survive a re-render of the same page. */
function render() {
  let { name, param } = parse();
  const route = ROUTES[name];
  if (name === 'today' && param) {
    // "#/today/2026-11-01" (links from Trends) picks the day once, then becomes plain "#/today"
    // so the previous/next buttons aren't overridden by the address on the next render.
    if (isDateKey(param)) app.date = param;
    history.replaceState(null, '', '#/today');
    param = '';
  }
  const key = `${name}/${param}`;
  const same = key === current;
  current = key;

  const active = document.activeElement;
  const focus = same && active?.id && root.contains(active) ? { id: active.id, start: active.selectionStart, end: active.selectionEnd } : null;
  const scroll = same ? window.scrollY : 0;

  abort?.abort(); // drops every listener the previous render attached
  abort = new AbortController();
  if (name === 'today' && !same) app.meal = null;
  route.view.render(root, param, { signal: abort.signal });

  $('#title').textContent = route.title;
  $$('nav a').forEach((a) => a.toggleAttribute('aria-current', a.dataset.tab === route.tab));
  $('#offline').hidden = app.status !== 'offline' && app.status !== 'error';
  window.scrollTo(0, scroll);
  if (focus) {
    const el = document.getElementById(focus.id);
    if (el) {
      el.focus({ preventScroll: true });
      try { el.setSelectionRange(focus.start, focus.end); } catch { /* not a text input */ }
    }
  }
}

app.rerender = render;
window.addEventListener('hashchange', () => { if (sheetOpen()) closeSheet(); render(); });

// The app can sit open in a phone tab for days: when it comes back on a new day, follow the calendar.
let lastSeen = dateKey();
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  const now = dateKey();
  if (now !== lastSeen) {
    if (app.date === lastSeen) app.date = now;
    lastSeen = now;
    if (!sheetOpen()) render();
  }
});

render();
loadData();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
