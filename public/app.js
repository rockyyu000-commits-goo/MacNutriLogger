const $ = (s) => document.querySelector(s);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const HERE_M = 75, NEAR_M = 500;
let data = { locations: [], items: [] }, pos = null, tab = 'near', q = '';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date().toLocaleDateString('en-CA');
export function dist(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const goals = () => store.get('goals', { calories: 2200, protein: 150, carbs: 250, fat: 70 });
const logFor = () => store.get('log:' + today(), []);
const macros = (i) => `${i.calories ?? '?'} kcal · P${i.protein ?? '?'} C${i.carbs ?? '?'} F${i.fat ?? '?'}`;

async function load() {
  try { data = await (await fetch('/api/data')).json(); } catch { $('#gps').textContent = 'offline'; }
  render();
}
function locate() {
  if (!navigator.geolocation) return;
  navigator.geolocation.watchPosition((p) => { pos = { lat: p.coords.latitude, lon: p.coords.longitude }; $('#gps').textContent = 'GPS on'; if (tab === 'near') render(); },
    () => { $('#gps').textContent = 'GPS off'; }, { enableHighAccuracy: true, maximumAge: 15000 });
}
function addLog(id) {
  const it = data.items.find((i) => i.id === id); if (!it) return;
  store.set('log:' + today(), [...logFor(), { ...it, loggedAt: Date.now(), locName: data.locations.find((l) => l.id === it.locationId)?.name }]);
  render();
}
const itemRow = (i) => `<div class="item"><div class="n">${esc(i.name)}<small>${esc(i.serving || '')} ${macros(i)}</small></div><button class="add" data-add="${esc(i.id)}">+</button></div>`;

function locationCard(l, d, open) {
  const items = data.items.filter((i) => i.locationId === l.id);
  const cats = [...new Set(items.map((i) => i.category || 'Menu'))];
  const body = items.length
    ? cats.map((c) => `<div class="muted" style="padding:6px 12px">${esc(c)}</div>` + items.filter((i) => (i.category || 'Menu') === c).map(itemRow).join('')).join('')
    : '<div class="item muted">No items yet</div>';
  const cls = d != null && d <= HERE_M ? 'here' : '';
  return `<details class="${cls}" ${open ? 'open' : ''}><summary><span>${esc(l.name)} <span class="tag">${esc(l.type.replace('_', ' '))}</span></span><span class="muted">${d == null ? '' : d < 1000 ? Math.round(d) + ' m' : (d / 1000).toFixed(1) + ' km'}</span></summary>${body}</details>`;
}

function renderNear() {
  const locs = data.locations.filter((l) => l.active).map((l) => ({ l, d: pos && l.lat != null ? dist(pos, l) : null }));
  locs.sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9) || a.l.name.localeCompare(b.l.name));
  if (!locs.length) return '<div class="empty">No locations loaded yet. Run the scraper / OSM import or add some in <a href="/admin.html">admin</a>.</div>';
  const here = locs.filter((x) => x.d != null && x.d <= HERE_M), near = locs.filter((x) => x.d != null && x.d > HERE_M && x.d <= NEAR_M), rest = locs.filter((x) => !here.includes(x) && !near.includes(x));
  const sec = (t, a, open) => (a.length ? `<h2>${t}</h2>` + a.map((x) => locationCard(x.l, x.d, open)).join('') : '');
  return (pos ? '' : '<p class="muted">Enable location to sort by distance.</p>') + sec("You're here", here, true) + sec('Within 500 m', near, false) + sec(pos ? 'Further away / no coordinates' : 'All locations', rest, false);
}
function renderLog() {
  const log = logFor(), g = goals(), t = { calories: 0, protein: 0, carbs: 0, fat: 0 };
  log.forEach((i) => Object.keys(t).forEach((k) => (t[k] += i[k] || 0)));
  const bar = (k, label, unit) => `<div>${label}: <b>${Math.round(t[k])}</b> / ${g[k]} ${unit}</div><div class="bar"><i style="width:${Math.min(100, (t[k] / g[k]) * 100)}%"></i></div>`;
  return `<h2>${today()}</h2>${bar('calories', 'Calories', 'kcal')}${bar('protein', 'Protein', 'g')}${bar('carbs', 'Carbs', 'g')}${bar('fat', 'Fat', 'g')}` +
    (log.length ? log.map((i, n) => `<div class="item"><div class="n">${esc(i.name)}<small>${esc(i.locName || '')} · ${macros(i)}</small></div><button class="del" data-del="${n}">×</button></div>`).join('') : '<div class="empty">Nothing logged yet.</div>');
}
function renderSearch() {
  const m = q.trim().toLowerCase();
  const res = m ? data.items.filter((i) => i.name.toLowerCase().includes(m)).slice(0, 50) : [];
  return `<h2>Search</h2><input type="search" id="q" placeholder="e.g. chicken" value="${esc(q)}">` + res.map((i) => itemRow({ ...i, serving: `${data.locations.find((l) => l.id === i.locationId)?.name ?? ''} · ${i.serving || ''}` })).join('');
}
function renderGoals() {
  const g = goals();
  return '<h2>Daily goals</h2>' + ['calories', 'protein', 'carbs', 'fat'].map((k) => `<label>${k}</label><input type="number" data-goal="${k}" value="${g[k]}">`).join('');
}
function render() {
  const keepQ = document.activeElement?.id === 'q';
  $('#view').innerHTML = { near: renderNear, log: renderLog, search: renderSearch, goals: renderGoals }[tab]();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (keepQ) { const e = $('#q'); e.focus(); e.setSelectionRange(q.length, q.length); }
}
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); }
  if (t.dataset.add) addLog(t.dataset.add);
  if (t.dataset.del) { const l = logFor(); l.splice(+t.dataset.del, 1); store.set('log:' + today(), l); render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { q = e.target.value; render(); }
  if (e.target.dataset.goal) store.set('goals', { ...goals(), [e.target.dataset.goal]: +e.target.value });
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
locate(); load();
