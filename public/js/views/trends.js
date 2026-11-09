// History: calories per day against the goal, averages, and a list of logged days.
import { app } from '../app.js';
import { addDays, dateKey, fmt, friendlyDate, parseKey } from '../lib/nutrition.js';
import { html, raw, setHTML } from '../ui.js';

let range = 7;
const RANGES = [7, 30, 90];

function chart(days, goal) {
  const W = 320, H = 150, padL = 34, padB = 18, padT = 8;
  const max = Math.max(goal, ...days.map((d) => d.calories), 1) * 1.08;
  const y = (v) => padT + (H - padT - padB) * (1 - v / max);
  const slot = (W - padL) / days.length;
  const bw = Math.max(1.5, Math.min(22, slot * 0.7));
  const tick = Math.ceil(days.length / 7);
  const bars = days.map((d, i) => {
    const x = padL + slot * i + (slot - bw) / 2;
    const label = i % tick === 0 || i === days.length - 1
      ? `<text x="${(x + bw / 2).toFixed(1)}" y="${H - 4}" text-anchor="middle">${days.length <= 7 ? parseKey(d.date).toLocaleDateString('en-CA', { weekday: 'narrow' }) : parseKey(d.date).getDate()}</text>` : '';
    if (!d.count) return label;
    const top = y(d.calories);
    return `<a href="#/today/${d.date}"><rect class="${d.calories > goal * 1.1 ? 'over' : ''}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${(H - padB - top).toFixed(1)}" rx="${Math.min(3, bw / 2)}"><title>${d.date}: ${fmt(d.calories)} kcal</title></rect></a>${label}`;
  }).join('');
  const gy = y(goal).toFixed(1);
  return raw(`<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories per day for the last ${days.length} days">
    <line class="axis" x1="${padL}" x2="${W}" y1="${H - padB}" y2="${H - padB}"/>
    <line class="goal" x1="${padL}" x2="${W}" y1="${gy}" y2="${gy}"/>
    <text class="goal-label" x="${padL - 4}" y="${gy}" text-anchor="end" dominant-baseline="middle">${fmt(goal)}</text>
    <text x="${padL - 4}" y="${H - padB}" text-anchor="end" dominant-baseline="middle">0</text>
    ${bars}</svg>`);
}

export function render(root, _param, { signal }) {
  const today = dateKey();
  const goals = app.store.getGoals();
  const days = app.store.history(today, range);
  const logged = days.filter((d) => d.count);
  const avg = (k) => (logged.length ? logged.reduce((a, d) => a + d[k], 0) / logged.length : null);
  const onTarget = logged.filter((d) => Math.abs(d.calories - goals.calories) <= goals.calories * 0.1).length;
  let streak = 0;
  for (let d = app.store.getLog(today).length ? today : addDays(today, -1); app.store.getLog(d).length; d = addDays(d, -1)) streak++;

  const stat = (label, value, unit, goal) => html`<div class="stat"><span class="muted">${label}</span><b>${fmt(value)}${value == null ? '' : html`<small> ${unit}</small>`}</b>${goal ? html`<span class="muted">goal ${fmt(goal)}</span>` : ''}</div>`;

  setHTML(root, html`
    <div class="seg" role="radiogroup" aria-label="Range">
      ${RANGES.map((r) => html`<button type="button" role="radio" aria-checked="${r === range}" data-range="${r}">${r} days</button>`)}
    </div>
    <section class="card pad">
      <header class="section-head flush"><h2>Calories</h2><span class="muted">dashed line = goal</span></header>
      ${logged.length ? chart(days, goals.calories) : html`<p class="empty">Nothing logged in the last ${range} days.</p>`}
    </section>
    <section class="stats">
      ${stat('Avg calories', avg('calories'), 'kcal', goals.calories)}
      ${stat('Avg protein', avg('protein'), 'g', goals.protein)}
      ${stat('Avg carbs', avg('carbs'), 'g', goals.carbs)}
      ${stat('Avg fat', avg('fat'), 'g', goals.fat)}
      ${stat('Days logged', logged.length, `of ${range}`)}
      ${stat('Within 10% of goal', onTarget, onTarget === 1 ? 'day' : 'days')}
      ${stat('Current streak', streak, streak === 1 ? 'day' : 'days')}
    </section>
    ${logged.length ? html`
      <section>
        <header class="section-head"><h2>Logged days</h2><span class="muted">averages count these only</span></header>
        <ul class="list card">${[...logged].reverse().map((d) => html`<li class="row">
          <a class="row-main" href="#/today/${d.date}">
            <span class="row-title">${friendlyDate(d.date, today)}</span>
            <span class="row-sub">${d.count} item${d.count === 1 ? '' : 's'} · P ${fmt(d.protein)} · C ${fmt(d.carbs)} · F ${fmt(d.fat)}</span>
          </a>
          <span class="row-kcal"><b>${fmt(d.calories)}</b><span>kcal</span></span>
        </li>`)}</ul>
      </section>` : ''}`);

  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-range]');
    if (b) { range = Number(b.dataset.range); app.rerender(); }
  }, { signal });
}
