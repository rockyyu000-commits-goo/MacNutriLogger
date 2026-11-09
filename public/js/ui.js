// Small DOM helpers: safe HTML templating, toast, bottom sheet.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Safe {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
/** Mark a string as already-safe HTML. */
export const raw = (s) => new Safe(String(s));
// Booleans print as "true"/"false" so aria-checked="${x === y}" works; use a ternary for optional markup.
const render = (v) => (v == null ? '' : v instanceof Safe ? v.s : Array.isArray(v) ? v.map(render).join('') : esc(v));

/** Tagged template that escapes every interpolated value unless it is html`…` / raw(). */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += render(v) + strings[i + 1]; });
  return new Safe(out);
}
export function setHTML(el, tpl) {
  el.innerHTML = render(tpl);
}

// Icons (inline SVG, 24px grid, stroke = currentColor)
const ICON = {
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  back: '<path d="m15 5-7 7 7 7"/>',
  prev: '<path d="m14 6-6 6 6 6"/>',
  next: '<path d="m10 6 6 6-6 6"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  warn: '<path d="M12 4 2.5 20h19L12 4z"/><path d="M12 10v5M12 17.5v.01"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`);
export const star = (on) => raw(`<svg class="icon star${on ? ' on' : ''}" viewBox="0 0 24 24" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.5 2.6 5.4 5.9.8-4.300 4.100 1 5.800L12 16.900l-5.200 2.700 1-5.800-4.300-4.100 5.900-.8L12 3.5z"/></svg>`);

// --- toast ---------------------------------------------------------------------------------
let toastTimer;
/** Brief message at the bottom; optional { label, run } action (e.g. Undo). */
export function toast(message, action) {
  const el = $('#toast');
  setHTML(el, html`<span>${message}</span>${action ? html`<button type="button">${action.label}</button>` : ''}`);
  if (action) $('button', el).onclick = () => { hide(); action.run(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  const hide = () => { el.hidden = true; };
  toastTimer = setTimeout(hide, action ? 5000 : 2500);
}

// --- bottom sheet (a <dialog>) -----------------------------------------------------------------
/**
 * Open the sheet with `content` and return its element. `onClose` runs once when it closes
 * for any reason (button, backdrop, Escape).
 */
export function openSheet(content, { onClose } = {}) {
  const dlg = $('#sheet');
  setHTML(dlg, html`<div class="sheet-body">${content}</div>`);
  dlg.onclick = (e) => { if (e.target === dlg || e.target.closest('[data-close]')) dlg.close(); };
  dlg.onclose = () => { dlg.onclose = null; setHTML(dlg, ''); onClose?.(); };
  if (!dlg.open) dlg.showModal();
  return dlg.firstElementChild;
}
export function closeSheet() {
  const dlg = $('#sheet');
  if (dlg.open) dlg.close();
}
export const sheetOpen = () => $('#sheet').open;
