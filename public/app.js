const $ = (s) => document.querySelector(s);
const store = {
  get: (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
};
const BAD = ['suspect-calories', 'zero-calories', 'kcal-vs-macros-mismatch'];
let data = { locations: [], items: [] }, tab = 'near', q = '', lq = '';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = () => new Date().toLocaleDateString('en-CA');
const goals = () => store.get('goals', { calories: 2200, protein: 150, carbs: 250, fat: 70 });
const logFor = () => store.get('log:' + today(), []);
const macros = (i) => `${i.calories ?? '?'} kcal · P${i.protein ?? '?'} C${i.carbs ?? '?'} F${i.fat ?? '?'}`;

async function load() {
  try { data = await (await fetch('/api/data')).json(); } catch { /* offline: service worker serves the cached copy */ }
  render();
}
const favs = () => store.get('favs', []);
function toggleFav(id) { const f = favs(); store.set('favs', f.includes(id) ? f.filter((x) => x !== id) : [...f, id]); render(); }
function addLog(id) {
  const it = data.items.find((i) => i.id === id); if (!it) return;
  store.set('log:' + today(), [...logFor(), { ...it, loggedAt: Date.now(), locName: data.locations.find((l) => l.id === it.locationId)?.name }]);
  render();
}
const itemRow = (i) => `<div class="item"><div class="n">${esc(i.name)}<small>${esc(i.serving || '')} ${macros(i)}${i.flags?.some((f) => BAD.includes(f)) ? ' ⚠ check data' : ''}${i.price != null ? ' · $' + i.price : ''}</small></div><button class="add" data-add="${esc(i.id)}">+</button></div>`;

function locationCard(l, open) {
  const items = data.items.filter((i) => i.locationId === l.id);
  const cats = [...new Set(items.map((i) => i.category || 'Menu'))];
  const body = items.length
    ? cats.map((c) => `<div class="muted" style="padding:6px 12px">${esc(c)}</div>` + items.filter((i) => (i.category || 'Menu') === c).map(itemRow).join('')).join('')
    : '<div class="item muted">No nutrition added yet</div>';
  const star = favs().includes(l.id) ? '★' : '☆';
  const sub = [l.cuisine, l.priceRange, l.address].filter(Boolean).join(' · ');
  return `<details ${open ? 'open' : ''}><summary><span>${esc(l.name)}${sub ? `<small class="muted" style="display:block">${esc(sub)}</small>` : ''}</span><span><span class="muted">${items.length ? items.length + ' items' : ''}</span> <button class="del" data-fav="${esc(l.id)}">${star}</button></span></summary>${body}</details>`;
}
function renderNear() {
  const m = lq.trim().toLowerCase();
  const locs = data.locations.filter((l) => l.active && (!m || `${l.name} ${l.cuisine || ''} ${l.brand || ''}`.toLowerCase().includes(m)));
  if (!data.locations.length) return '<div class="empty">No locations loaded yet. Add some in <a href="/admin.html">admin</a>.</div>';
  const byName = (a, b) => (b.n - a.n) || a.l.name.localeCompare(b.l.name); // places with nutrition first
  const wrap = locs.map((l) => ({ l, n: data.items.filter((i) => i.locationId === l.id).length }));
  const f = favs();
  const groups = [
    ['Favourites', wrap.filter((x) => f.includes(x.l.id))],
    ['On campus', wrap.filter((x) => x.l.source === 'mcmaster' && !f.includes(x.l.id))],
    ['Chains (Subway, Pita Pit…)', wrap.filter((x) => x.l.source !== 'mcmaster' && x.l.brand && !f.includes(x.l.id))],
    ['Other nearby', wrap.filter((x) => x.l.source !== 'mcmaster' && !x.l.brand && !f.includes(x.l.id))],
  ];
  return groups.filter(([, a]) => a.length).map(([t, a]) => `<h2>${t}</h2>` + a.sort(byName).map((x) => locationCard(x.l, !!m && locs.length <= 3)).join('')).join('') || '<div class="empty">No matches.</div>';
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
  $('#lq').style.display = tab === 'near' ? '' : 'none';
  $('#view').innerHTML = { near: renderNear, log: renderLog, search: renderSearch, goals: renderGoals }[tab]();
  document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  if (keepQ) { const e = $('#q'); e.focus(); e.setSelectionRange(q.length, q.length); }
}
document.addEventListener('click', (e) => {
  const t = e.target;
  if (t.dataset.tab) { tab = t.dataset.tab; render(); }
  if (t.dataset.add) addLog(t.dataset.add);
  if (t.dataset.fav) { e.preventDefault(); toggleFav(t.dataset.fav); }
  if (t.dataset.del) { const l = logFor(); l.splice(+t.dataset.del, 1); store.set('log:' + today(), l); render(); }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'lq') { lq = e.target.value; render(); }
  if (e.target.id === 'q') { q = e.target.value; render(); }
  if (e.target.dataset.goal) store.set('goals', { ...goals(), [e.target.dataset.goal]: +e.target.value });
});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
load();
