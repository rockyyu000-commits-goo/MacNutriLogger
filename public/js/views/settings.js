// Goals, backup/restore of the diary, and info about the loaded menu data.
import { app, loadData } from '../app.js';
import { MACROS, dateKey, fmt, kcalFromMacros } from '../lib/nutrition.js';
import { html, setHTML, toast } from '../ui.js';

const GOAL_FIELDS = [
  ['calories', 'Calories', 'kcal'],
  ['protein', 'Protein', 'g'],
  ['carbs', 'Carbs', 'g'],
  ['fat', 'Fat', 'g'],
];
let confirmClear = false;

function macroHint(g) {
  const kcal = kcalFromMacros(g);
  const diff = kcal - g.calories;
  if (Math.abs(diff) <= g.calories * 0.05) return html`Your macro goals add up to ${fmt(kcal)} kcal, which matches your calorie goal.`;
  return html`Your macro goals add up to <b>${fmt(kcal)} kcal</b>, ${fmt(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than your calorie goal.`;
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function render(root, _param, { signal }) {
  const g = app.store.getGoals();
  const days = app.store.logDates();
  const statusText = { loading: 'Loading…', ready: 'Up to date', offline: 'Offline, showing the saved copy', error: 'Could not reach the server' }[app.status];

  setHTML(root, html`
    <section>
      <header class="section-head"><h2>Daily goals</h2></header>
      <div class="card pad">
        <div class="grid4">
          ${GOAL_FIELDS.map(([k, label, unit]) => html`<label class="field"><span>${label} <span class="muted">${unit}</span></span>
            <input type="number" inputmode="numeric" min="1" step="1" data-goal="${k}" value="${g[k]}"></label>`)}
        </div>
        <p class="muted" id="goal-hint">${macroHint(g)}</p>
      </div>
    </section>

    <section>
      <header class="section-head"><h2>Your diary</h2></header>
      <div class="card pad">
        <p>${days.length ? html`${days.length} day${days.length === 1 ? '' : 's'} logged, since ${days[0]}.` : 'Nothing logged yet.'}
          The diary is stored only in this browser, so back it up before clearing site data or switching phones.</p>
        <div class="actions start">
          <button type="button" class="btn" data-export ${days.length ? '' : 'disabled'}>Download backup</button>
          <label class="btn">Restore backup<input type="file" id="restore" accept="application/json,.json" hidden></label>
          <button type="button" class="btn danger" data-clear ${days.length ? '' : 'disabled'}>${confirmClear ? 'Tap again to erase everything' : 'Erase diary'}</button>
        </div>
      </div>
    </section>

    <section>
      <header class="section-head"><h2>Menu data</h2></header>
      <div class="card pad">
        <p>${fmt(app.items.length)} foods at ${app.locations.length} places. <span class="muted">${statusText}.</span></p>
        <p class="muted">McMaster numbers come from Hospitality Services; chain numbers come from each chain's published nutrition guide.
          Items marked with a warning triangle have numbers that look wrong at the source.</p>
        <div class="actions start">
          <button type="button" class="btn" data-refresh>Check for new menus</button>
          <a class="btn" href="/admin.html">Edit menus (admin)</a>
        </div>
      </div>
    </section>
    <p class="muted center">MacNutriLogger 2 · not affiliated with McMaster University</p>`);

  root.addEventListener('change', async (e) => {
    const k = e.target.dataset.goal;
    if (k && MACROS.includes(k)) {
      const v = Math.round(Number(e.target.value));
      if (!(v > 0)) { e.target.value = app.store.getGoals()[k]; return toast('Goals must be more than 0'); }
      app.store.setGoals({ [k]: v });
      e.target.value = v;
      setHTML(root.querySelector('#goal-hint'), macroHint(app.store.getGoals()));
      toast('Goal saved');
    }
    if (e.target.id === 'restore' && e.target.files[0]) {
      try {
        const res = app.store.import(JSON.parse(await e.target.files[0].text()));
        toast(`Restored ${res.entries} entries across ${res.days} days`);
      } catch (err) {
        toast(err instanceof SyntaxError ? 'That file is not valid JSON' : err.message);
      }
      app.rerender();
    }
  }, { signal });

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    if ('export' in t.dataset) download(`macnutrilogger-diary-${dateKey()}.json`, JSON.stringify(app.store.export(), null, 1));
    else if ('clear' in t.dataset) {
      if (!confirmClear) { confirmClear = true; app.rerender(); setTimeout(() => { if (confirmClear) { confirmClear = false; app.rerender(); } }, 5000); return; }
      confirmClear = false;
      app.store.clearLogs();
      app.rerender();
      toast('Diary erased');
    } else if ('refresh' in t.dataset) {
      t.disabled = true;
      await loadData();
      toast(app.status === 'ready' ? 'Menus are up to date' : 'Could not reach the server');
      app.rerender();
    }
  }, { signal });
}
