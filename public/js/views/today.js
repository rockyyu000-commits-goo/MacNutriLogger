// Diary for one day: calorie ring, macro bars, entries grouped by meal.
import { app } from '../app.js';
import { MEALS, addDays, dateKey, fmt, friendlyDate, isDateKey, macroLine, servingLine, totals } from '../lib/nutrition.js';
import { entrySheet, quickAddSheet } from '../sheets.js';
import { html, icon, setHTML, toast } from '../ui.js';

const R = 52, CIRC = 2 * Math.PI * R;

function ring(eaten, goal) {
  const frac = goal > 0 ? Math.min(1, eaten / goal) : 0;
  const left = goal - eaten;
  return html`<div class="ring${left < 0 ? ' over' : ''}">
    <svg viewBox="0 0 120 120" role="img" aria-label="${fmt(eaten)} of ${fmt(goal)} kcal eaten">
      <circle class="ring-track" cx="60" cy="60" r="${R}"/>
      <circle class="ring-fill" cx="60" cy="60" r="${R}" stroke-dasharray="${(CIRC * frac).toFixed(1)} ${CIRC.toFixed(1)}" transform="rotate(-90 60 60)"/>
    </svg>
    <div class="ring-label"><b>${fmt(Math.abs(left))}</b><span>kcal ${left < 0 ? 'over' : 'left'}</span></div>
  </div>`;
}

const macroBar = (label, cls, value, goal) => html`
  <div class="macro ${cls}">
    <div class="macro-top"><span>${label}</span><span><b>${fmt(value)}</b> / ${fmt(goal)} g</span></div>
    <div class="bar"><i style="width:${goal > 0 ? Math.min(100, (value / goal) * 100).toFixed(1) : 0}%"></i></div>
  </div>`;

const entryRow = (e) => html`<li class="row">
  <button type="button" class="row-main" data-entry="${e.id}">
    <span class="row-title">${e.name}</span>
    <span class="row-sub">${e.place ? html`${e.place} · ` : ''}${servingLine(e.serving, e.qty)}</span>
  </button>
  <button type="button" class="row-kcal" data-entry="${e.id}" tabindex="-1" aria-hidden="true"><b>${e.n.calories == null ? '?' : fmt(e.n.calories * e.qty)}</b><span>kcal</span></button>
</li>`;

export function render(root, _param, { signal }) {
  const date = app.date, today = dateKey();
  const log = app.store.getLog(date);
  const goals = app.store.getGoals();
  const t = totals(log);
  const yesterday = addDays(date, -1);
  const canCopy = !log.length && app.store.getLog(yesterday).length > 0;

  setHTML(root, html`
    <div class="datebar">
      <button type="button" class="icon-btn" data-shift="-1" aria-label="Previous day">${icon('prev')}</button>
      <button type="button" class="date-btn" data-pick>
        <b>${friendlyDate(date, today)}</b>
        <span class="muted">${date}</span>
      </button>
      <input type="date" id="datepick" value="${date}" max="${addDays(today, 365)}" tabindex="-1" aria-label="Pick a day">
      <button type="button" class="icon-btn" data-shift="1" aria-label="Next day">${icon('next')}</button>
    </div>
    ${date !== today ? html`<p class="center"><button type="button" class="link" data-today>Back to today</button></p>` : ''}

    <section class="card summary">
      ${ring(t.calories, goals.calories)}
      <div class="summary-side">
        <div class="eaten"><span><b>${fmt(t.calories)}</b> eaten</span><span><b>${fmt(goals.calories)}</b> goal</span></div>
        ${macroBar('Protein', 'p', t.protein, goals.protein)}
        ${macroBar('Carbs', 'c', t.carbs, goals.carbs)}
        ${macroBar('Fat', 'f', t.fat, goals.fat)}
      </div>
    </section>

    ${MEALS.map((m) => {
      const entries = log.filter((e) => e.meal === m.id).sort((a, b) => a.at - b.at);
      const mt = totals(entries);
      return html`<section class="meal">
        <header class="section-head">
          <h2>${m.label}</h2>
          <span class="muted">${entries.length ? macroLine(mt) : ''}</span>
          <button type="button" class="add small" data-add-meal="${m.id}" aria-label="Add to ${m.label}">${icon('plus')}</button>
        </header>
        ${entries.length ? html`<ul class="list card">${entries.map(entryRow)}</ul>` : html`<p class="empty-line">Nothing yet</p>`}
      </section>`;
    })}

    <div class="actions">
      <button type="button" class="btn" data-quick>Quick add</button>
      ${canCopy ? html`<button type="button" class="btn" data-copy>Copy ${friendlyDate(yesterday, today).toLowerCase()}</button>` : ''}
    </div>`);

  const go = (d) => { app.date = d; app.rerender(); };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if (t.dataset.shift) go(addDays(date, Number(t.dataset.shift)));
    else if ('today' in t.dataset) go(today);
    else if ('pick' in t.dataset) {
      const input = root.querySelector('#datepick');
      try { input.showPicker(); } catch { input.focus(); input.click(); }
    } else if (t.dataset.entry) {
      const entry = log.find((x) => x.id === t.dataset.entry);
      if (entry) entrySheet(date, entry);
    } else if (t.dataset.addMeal) {
      app.meal = t.dataset.addMeal;
      location.hash = '#/search';
    } else if ('quick' in t.dataset) quickAddSheet();
    else if ('copy' in t.dataset) {
      const n = app.store.copyDay(yesterday, date);
      app.rerender();
      toast(`Copied ${n} item${n === 1 ? '' : 's'}`, { label: 'Undo', run: () => { app.store.setLog(date, []); app.rerender(); } });
    }
  }, { signal });
  root.addEventListener('change', (e) => {
    if (e.target.id === 'datepick' && isDateKey(e.target.value)) go(e.target.value);
  }, { signal });
}
