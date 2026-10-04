import { html } from '../vendor/preact-htm.js';
import { icon, glyph, CATEGORY_COLORS, CATEGORY_ICONS, colorVar } from '../lib/icons.js';
import { money, ord } from '../lib/format.js';
import { Back, Toggle, Seg, Figure, chevR } from '../ui.js';

export function Budgets({ app }) {
  const { model } = app;
  const cats = model.cats;
  const total = cats.reduce((a, c) => a + c.limit, 0);
  // Income is what came in this budget month, or last month's if the salary hasn't arrived yet.
  const income = model.incomeIn(model.cur) || (model.periods[model.CUR - 1] ? model.incomeIn(model.periods[model.CUR - 1]) : 0);
  const segs = [...cats.map(c => ({ f: c.limit, c: c.colorVar, k: c.id })), ...(income > total ? [{ f: income - total, c: 'var(--fill)', k: 'rest' }] : [])];

  return html`
  <div class="pad">
    <h1 class="large-title" style="margin-top:8px">Budgets</h1>
    ${income > 0 ? html`
      <p class="body" style="margin-top:8px">${money(total)} of ${money(income)} income is budgeted.</p>
      <p class="callout" style="margin-top:2px">${income >= total ? `${money(income - total)} isn’t assigned to a category.` : `That’s ${money(total - income)} more than comes in.`}</p>`
    : html`<p class="body" style="margin-top:8px">${money(total)} is budgeted each month.</p>`}
    ${segs.length > 0 && html`
      <div style="display:flex;gap:2px;height:10px;margin-top:16px" aria-hidden="true">${segs.map(s => html`<div key=${s.k} style=${{ flex: s.f, background: s.c, borderRadius: '2px' }}></div>`)}</div>
      <div style="display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--ink2);margin-top:6px;letter-spacing:0.4px;text-transform:uppercase"><span>Budgeted</span>${income > 0 && html`<span>Income ${money(income)}</span>`}</div>`}
    <div style="margin-top:26px;border-top:0.5px solid var(--line)">
      ${cats.map(c => html`
        <button key=${c.id} onClick=${() => app.push({ t: 'edit', id: c.id })} style="display:grid;grid-template-columns:28px 1fr auto 16px;column-gap:12px;align-items:center;min-height:62px;border-bottom:0.5px solid var(--line);width:100%">
          <div>${icon(c.icon, c.colorVar, 24)}</div>
          <div><div style="font-size:17px;font-weight:500">${c.name}</div><div class="label" style="margin-top:1px">${c.fixed ? `Fixed cost · due on the ${ord(c.due)}` : `Alert at ${c.thr}%` + (c.carry ? ' · unused carries over' : '')}</div></div>
          <div style="font-size:17px;font-weight:600">${money(c.limit)}</div>
          <div class="ink3">${chevR()}</div>
        </button>`)}
      <button onClick=${() => app.push({ t: 'edit', id: 'new' })} style="display:flex;align-items:center;gap:12px;min-height:56px;border-bottom:0.5px solid var(--line);font-size:17px;width:100%">
        <div style="width:28px;display:flex;justify-content:center">${icon('plus', 'var(--ink)', 22, 1.8)}</div>New category
      </button>
    </div>
    <p class="foot" style="margin-top:14px">Limits reset on the month start day, the ${ord(model.startDay)}.</p>
  </div>`;
}

export function Edit({ app }) {
  const { state: s, md } = app;
  const d = s.draft;
  if (!d) return null;
  const set = o => app.set({ draft: { ...d, ...o } });
  const isNew = d.id === 'new';
  const step = d.limit >= 200 ? 10 : 5;
  const row = md.cur && md.ring.find(r => r.id === d.id);
  const nextName = app.model.periods[app.model.CUR + 1]?.n || 'next month';
  const toggles = [
    { k: 'fixed', label: 'Fixed cost', sub: 'Same amount every month. Shown as settled once paid, with no pace.' },
    { k: 'carry', label: 'Carry over unused budget', sub: row && row.left > 0 ? `${money(row.left)} unused this month would raise ${nextName}’s limit to ${money(d.limit + row.left)}.` : 'Whatever is left at month end moves to next month’s limit.' },
  ];

  return html`
  <div>
    <div style="display:grid;grid-template-columns:1fr auto 1fr;align-items:center;height:44px;padding:0 8px">
      <button onClick=${app.pop} style="height:44px;display:flex;align-items:center;padding:0 8px;font-size:17px;justify-self:start">Cancel</button>
      <div style="font-size:17px;font-weight:600">${isNew ? 'New category' : 'Edit category'}</div>
      <button onClick=${app.saveDraft} disabled=${s.saving} style="height:44px;display:flex;align-items:center;justify-content:flex-end;padding:0 8px;font-size:17px;font-weight:600;justify-self:end">Save</button>
    </div>
    <div class="pad">
      <div style="display:flex;align-items:center;gap:12px;margin-top:16px">
        ${icon(d.icon, colorVar(d.color), 34, 1.8)}
        <div><div class="title2">${d.name || 'New category'}</div><div class="callout">${money(d.limit)} a month${d.fixed ? ' · fixed' : ''}</div></div>
      </div>

      <label class="label" for="cat-name" style="display:block;margin-top:26px">Name</label>
      <input id="cat-name" value=${d.name} maxlength="40" onInput=${e => set({ name: e.target.value })} placeholder="Category name"
        style="display:block;width:100%;box-sizing:border-box;height:44px;border:0;border-bottom:0.5px solid var(--line);background:transparent;font:inherit;font-size:17px;color:var(--ink);outline:none;border-radius:0" />

      <div class="label" style="margin-top:22px">Color</div>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);margin-top:4px" role="radiogroup" aria-label="Color">
        ${CATEGORY_COLORS.map(k => html`<button key=${k} role="radio" aria-checked=${d.color === k ? 'true' : 'false'} aria-label=${k} onClick=${() => set({ color: k })} style="height:44px;display:flex;align-items:center;justify-content:center">
          <div style=${{ width: '28px', height: '28px', borderRadius: '14px', background: colorVar(k), boxShadow: d.color === k ? '0 0 0 2px var(--bg), 0 0 0 4px var(--ink)' : 'none' }}></div></button>`)}
      </div>
      <p class="foot">Each color is tuned to stay distinct from the others in light and dark mode.</p>

      <div class="label" style="margin-top:22px">Icon</div>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);margin-top:4px" role="radiogroup" aria-label="Icon">
        ${CATEGORY_ICONS.map(k => html`<button key=${k} role="radio" aria-checked=${d.icon === k ? 'true' : 'false'} aria-label=${k} onClick=${() => set({ icon: k })} style=${{ height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '10px', background: d.icon === k ? 'var(--fill)' : 'transparent' }}>
          ${icon(k, d.icon === k ? colorVar(d.color) : 'var(--ink2)', 24)}</button>`)}
      </div>

      <div style="margin-top:24px;border-top:0.5px solid var(--line)">
        <div style="display:flex;align-items:center;justify-content:space-between;min-height:64px;border-bottom:0.5px solid var(--line)">
          <span style="font-size:17px">Monthly limit</span>
          <div class="stepper">
            <button aria-label="Lower limit" onClick=${() => set({ limit: Math.max(5, d.limit - step) })}>−</button>
            <div style="min-width:86px;text-align:center"><${Figure} v=${d.limit} size=${24} cents=${15} track=${-0.5} /></div>
            <button aria-label="Raise limit" onClick=${() => set({ limit: d.limit + step })}>+</button>
          </div>
        </div>
        ${!d.fixed && html`
        <div style="padding:12px 0;border-bottom:0.5px solid var(--line)">
          <div style="font-size:17px">Alert me at</div>
          <${Seg} options=${[70, 80, 90, 100].map(v => ({ value: v, label: v + '%' }))} value=${d.thr} onPick=${v => set({ thr: v })} />
          <p class="foot" style="margin-top:4px">${d.thr >= 100 ? 'You’ll hear from Monat only when the limit is reached.' : `You’ll get a notification at ${money(d.limit * d.thr / 100)}, and again at the limit.`}</p>
        </div>`}
        ${toggles.map(x => html`
          <div key=${x.k} class="switch-row">
            <div><div class="t">${x.label}</div><div class="s">${x.sub}</div></div>
            <${Toggle} on=${d[x.k]} label=${x.label} onClick=${() => set({ [x.k]: !d[x.k], ...(x.k === 'fixed' && !d.fixed ? { thr: 100 } : {}) })} />
          </div>`)}
        ${d.fixed && html`
          <div style="display:flex;align-items:center;justify-content:space-between;min-height:56px;border-bottom:0.5px solid var(--line)">
            <span style="font-size:17px">Due on</span>
            <div class="stepper">
              <button aria-label="Earlier" onClick=${() => set({ due: Math.max(1, d.due - 1) })}>−</button>
              <div style="min-width:56px;text-align:center;font-size:17px;font-weight:600">${ord(d.due)}</div>
              <button aria-label="Later" onClick=${() => set({ due: Math.min(28, d.due + 1) })}>+</button>
            </div>
          </div>`}
      </div>
      ${!isNew && html`
        <button onClick=${app.deleteDraft} style="margin-top:28px;min-height:44px;display:flex;align-items:center;gap:8px;font-size:17px;color:var(--over);text-wrap:pretty">
          ${s.confirmDelete ? html`${glyph('over')}<span>Tap again to delete. Its payments become uncategorized.</span>` : 'Delete category'}
        </button>`}
    </div>
  </div>`;
}

export const blankDraft = () => ({ id: 'new', name: '', limit: 50, thr: 80, fixed: false, due: 1, color: 'x', icon: 'book', carry: false });
