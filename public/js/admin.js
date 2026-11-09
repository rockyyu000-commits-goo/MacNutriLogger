// Menu admin: edit places and items in place, add new ones, bulk import, download a backup.
// Every change goes through /api/admin/* with the bearer token and is saved immediately.
import { hasWarning } from './lib/nutrition.js';
import { normalize } from './lib/search.js';
import { $, $$, html, setHTML, toast } from './ui.js';

const PAGE = 100;
const ITEM_COLS = [
  ['name', 'Name', 'text', 'name'],
  ['category', 'Category', 'text', 'mid'],
  ['serving', 'Serving', 'text', 'mid'],
  ['calories', 'kcal', 'num'],
  ['protein', 'Protein', 'num'],
  ['carbs', 'Carbs', 'num'],
  ['fat', 'Fat', 'num'],
  ['sodium', 'Sodium', 'num'],
  ['price', '$', 'num'],
];
const LOC_FIELDS = [['name', 'Name'], ['brand', 'Brand (chains)'], ['cuisine', 'Cuisine'], ['priceRange', 'Price range'], ['address', 'Address']];
const LOC_TYPES = { restaurant: 'Restaurant', cafe: 'Café', dining_hall: 'Dining hall' };

const state = { data: { locations: [], items: [] }, selected: null, isNew: false, locFilter: '', flaggedOnly: false, itemFilter: '', page: 0 };
const token = () => $('#token').value.trim();
const itemsAt = (id) => state.data.items.filter((i) => i.locationId === id);

async function api(method, path, body) {
  const res = await fetch('/api/admin/' + path, {
    method,
    headers: { authorization: 'Bearer ' + token(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'GET' && path === 'export' && res.ok) return res.blob();
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json;
}
const guard = (fn) => async (...args) => {
  try { return await fn(...args); } catch (err) { toast(err.message === 'unauthorized' ? 'Wrong or missing admin token' : err.message); }
};

async function load() {
  state.data = await (await fetch('/api/data', { cache: 'no-cache' })).json();
  renderLocs();
  renderEditor();
}

async function checkToken() {
  const el = $('#auth-status');
  if (!token()) { el.textContent = 'Enter the token to make changes.'; return; }
  try { await api('GET', 'ping'); el.textContent = 'Token accepted. Changes save as you make them.'; } catch (err) { el.textContent = err.message === 'unauthorized' ? 'That token is not correct.' : err.message; }
}

// --- place list ---------------------------------------------------------------------------
function renderLocs() {
  const q = normalize(state.locFilter);
  const flagged = new Map();
  for (const i of state.data.items) if (hasWarning(i)) flagged.set(i.locationId, (flagged.get(i.locationId) ?? 0) + 1);
  const counts = new Map();
  for (const i of state.data.items) counts.set(i.locationId, (counts.get(i.locationId) ?? 0) + 1);
  const locs = state.data.locations
    .filter((l) => (!q || normalize(`${l.name} ${l.brand ?? ''} ${l.cuisine ?? ''}`).includes(q)) && (!state.flaggedOnly || flagged.has(l.id)))
    .sort((a, b) => a.name.localeCompare(b.name));
  $('#counts').textContent = `${state.data.locations.length} places, ${state.data.items.length} items`;
  setHTML($('#locs'), locs.length ? locs.map((l) => html`<li class="row" aria-current="${l.id === state.selected}">
    <button type="button" class="row-main" data-loc="${l.id}">
      <span class="row-title">${l.name} ${l.active === false ? html`<span class="tag">hidden</span>` : ''} ${flagged.has(l.id) ? html`<span class="tag warn">${flagged.get(l.id)} flagged</span>` : ''}</span>
      <span class="row-sub">${counts.get(l.id) ?? 0} items · ${l.source}${l.address ? ` · ${l.address}` : ''}</span>
    </button></li>`) : html`<li class="empty">No places match.</li>`);
}

// --- place editor -------------------------------------------------------------------------
function cell(item, [key, , type, cls]) {
  const v = item?.[key] ?? '';
  return html`<td><input class="cell ${type === 'num' ? 'num' : cls}" data-field="${key}" ${type === 'num' ? html`type="number" step="any" min="0" inputmode="decimal"` : html`type="text"`} value="${v}" aria-label="${key}"></td>`;
}

function renderEditor() {
  const el = $('#editor');
  const loc = state.isNew ? { name: '', type: 'restaurant', active: true } : state.data.locations.find((l) => l.id === state.selected);
  if (!loc) { el.hidden = true; return; }
  el.hidden = false;
  const all = state.isNew ? [] : itemsAt(loc.id);
  const q = normalize(state.itemFilter);
  const shown = all.filter((i) => (!q || normalize(`${i.name} ${i.category ?? ''}`).includes(q))).sort((a, b) => hasWarning(b) - hasWarning(a) || (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  state.page = Math.min(state.page, pages - 1);
  const pageItems = shown.slice(state.page * PAGE, (state.page + 1) * PAGE);

  setHTML(el, html`
    <header class="section-head"><h2>${state.isNew ? 'New place' : loc.name}</h2><span class="muted">${state.isNew ? '' : `id: ${loc.id}`}</span></header>
    <form class="card pad" id="loc-form">
      <div class="loc-form">
        ${LOC_FIELDS.map(([k, label]) => html`<label class="field"><span>${label}</span><input name="${k}" value="${loc[k] ?? ''}" ${k === 'name' ? 'required' : ''} autocomplete="off"></label>`)}
        <label class="field"><span>Type</span><select name="type">${Object.entries(LOC_TYPES).map(([id, label]) => html`<option value="${id}" ${loc.type === id ? 'selected' : ''}>${label}</option>`)}</select></label>
        <label class="field check"><input type="checkbox" name="active" ${loc.active !== false ? 'checked' : ''}> Shown in the app</label>
      </div>
      <div class="actions start">
        <button type="submit" class="btn primary grow0">${state.isNew ? 'Create place' : 'Save place'}</button>
        ${state.isNew ? html`<button type="button" class="btn" id="cancel-new">Cancel</button>` : html`<button type="button" class="btn danger" id="del-loc">Delete place and its ${all.length} items</button>`}
      </div>
    </form>
    ${state.isNew ? '' : html`
      <div class="card pad" style="margin-top:10px">
        <div class="admin-bar">
          <input type="search" id="item-filter" placeholder="Filter ${all.length} items" value="${state.itemFilter}" autocomplete="off">
          <span class="muted">Edit a cell and press Tab or Enter to save. Edited items are locked against re-imports.</span>
        </div>
        <div class="table-wrap"><table class="items">
          <thead><tr>${ITEM_COLS.map(([, label]) => html`<th>${label}</th>`)}<th></th></tr></thead>
          <tbody>${pageItems.map((i) => html`<tr data-id="${i.id}" class="${hasWarning(i) ? 'flagged' : ''}" title="${i.flags?.length ? 'Flags: ' + i.flags.join(', ') : ''}">
            ${ITEM_COLS.map((c) => cell(i, c))}<td><button type="button" class="del" data-del="${i.id}">Delete</button></td></tr>`)}</tbody>
          <tfoot><tr data-new>${ITEM_COLS.map((c) => cell(null, c))}<td><button type="button" class="btn" id="add-item">Add</button></td></tr></tfoot>
        </table></div>
        ${pages > 1 ? html`<div class="pager">
          <button type="button" class="btn" data-page="-1" ${state.page === 0 ? 'disabled' : ''}>Previous</button>
          <span class="muted">Page ${state.page + 1} of ${pages} (${shown.length} items)</span>
          <button type="button" class="btn" data-page="1" ${state.page >= pages - 1 ? 'disabled' : ''}>Next</button>
        </div>` : ''}
      </div>`}`);
}

const cellValue = (input) => {
  const v = input.value.trim();
  if (input.type !== 'number') return v || null;
  if (v === '') return null;
  if (!Number.isFinite(Number(v)) || Number(v) < 0) throw new Error(`${input.dataset.field} must be a number, 0 or more`);
  return Number(v);
};
const flash = (input, cls) => { input.classList.remove('saved', 'failed'); input.classList.add(cls); if (cls === 'saved') setTimeout(() => input.classList.remove('saved'), 1200); };

// --- events -------------------------------------------------------------------------------
$('#token').value = localStorage.getItem('tok') || '';
$('#token').addEventListener('change', () => { localStorage.setItem('tok', token()); checkToken(); });

$('#loc-filter').addEventListener('input', (e) => { state.locFilter = e.target.value; renderLocs(); });
$('#flagged-only').addEventListener('change', (e) => { state.flaggedOnly = e.target.checked; renderLocs(); });
$('#new-loc').addEventListener('click', () => { state.isNew = true; state.selected = null; renderLocs(); renderEditor(); $('#editor').scrollIntoView({ behavior: 'smooth' }); $('#editor input').focus(); });
$('#locs').addEventListener('click', (e) => {
  const b = e.target.closest('[data-loc]');
  if (!b) return;
  Object.assign(state, { selected: b.dataset.loc, isNew: false, itemFilter: '', page: 0 });
  renderLocs();
  renderEditor();
  $('#editor').scrollIntoView({ behavior: 'smooth' });
});

const editor = $('#editor');
editor.addEventListener('submit', guard(async (e) => {
  e.preventDefault();
  if (e.target.id !== 'loc-form') return;
  const f = new FormData(e.target);
  const body = Object.fromEntries(LOC_FIELDS.map(([k]) => [k, String(f.get(k)).trim() || null]));
  body.type = f.get('type');
  body.active = f.get('active') != null;
  if (state.isNew) {
    if (state.data.locations.some((l) => normalize(l.name).replaceAll(' ', '-') === normalize(body.name).replaceAll(' ', '-'))) throw new Error('A place with that name already exists');
    const rec = await api('POST', 'locations', body);
    Object.assign(state, { isNew: false, selected: rec.id });
    toast('Place created');
  } else {
    await api('PUT', 'locations/' + encodeURIComponent(state.selected), body);
    toast('Place saved');
  }
  await load();
}));

editor.addEventListener('input', (e) => {
  if (e.target.id !== 'item-filter') return;
  state.itemFilter = e.target.value;
  state.page = 0;
  const pos = e.target.selectionStart;
  renderEditor();
  const el = $('#item-filter');
  el.focus();
  el.setSelectionRange(pos, pos);
});

// Save one cell of an existing item when it changes.
editor.addEventListener('change', async (e) => {
  const input = e.target;
  const row = input.closest('tr[data-id]');
  if (!row || !input.dataset.field) return;
  try {
    const value = cellValue(input);
    if (input.dataset.field === 'name' && !value) throw new Error('name is required');
    const rec = await api('PUT', 'items/' + encodeURIComponent(row.dataset.id), { [input.dataset.field]: value });
    const idx = state.data.items.findIndex((i) => i.id === rec.id);
    if (idx >= 0) state.data.items[idx] = rec;
    flash(input, 'saved');
  } catch (err) {
    flash(input, 'failed');
    toast(err.message === 'unauthorized' ? 'Wrong or missing admin token' : err.message);
  }
});
editor.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.classList.contains('cell')) return;
  e.preventDefault();
  if (e.target.closest('tr[data-new]')) $('#add-item').click(); else e.target.blur();
});

editor.addEventListener('click', guard(async (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.id === 'cancel-new') { state.isNew = false; renderEditor(); return; }
  if (t.dataset.page) { state.page += Number(t.dataset.page); renderEditor(); return; }
  if (t.id === 'del-loc') {
    const loc = state.data.locations.find((l) => l.id === state.selected);
    if (!confirm(`Delete "${loc.name}" and all ${itemsAt(loc.id).length} of its items? This cannot be undone.`)) return;
    await api('DELETE', 'locations/' + encodeURIComponent(loc.id));
    state.selected = null;
    toast('Place deleted');
    return load();
  }
  if (t.dataset.del) {
    const item = state.data.items.find((i) => i.id === t.dataset.del);
    if (!confirm(`Delete "${item.name}"?`)) return;
    await api('DELETE', 'items/' + encodeURIComponent(item.id));
    state.data.items = state.data.items.filter((i) => i.id !== item.id);
    renderLocs();
    return renderEditor();
  }
  if (t.id === 'add-item') {
    const body = { locationId: state.selected, source: 'manual' };
    for (const input of $$('tr[data-new] .cell', editor)) body[input.dataset.field] = cellValue(input);
    if (!body.name) throw new Error('Give the new item a name');
    const rec = await api('POST', 'items', body);
    state.data.items = state.data.items.filter((i) => i.id !== rec.id).concat(rec);
    state.itemFilter = rec.name;
    state.page = 0;
    renderLocs();
    renderEditor();
    toast('Item added');
  }
}));

$('#import').addEventListener('click', guard(async () => {
  let body;
  try { body = JSON.parse($('#json').value); } catch { throw new Error('That is not valid JSON'); }
  const res = await api('POST', 'import', body);
  toast(`Imported ${res.locations} places and ${res.items} items`);
  $('#json').value = '';
  await load();
}));
$('#export').addEventListener('click', guard(async () => {
  const blob = await api('GET', 'export');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `macnutrilogger-menu-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}));

load().catch(() => toast('Could not load the menu data'));
checkToken();
