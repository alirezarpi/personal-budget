import { html } from '../vendor/preact-htm.js';
import { icon } from '../lib/icons.js';
import { WEEKDAYS, MONTHS, parseDate, dayDiff, wdShort, dayMon } from '../lib/format.js';
import { fieldLabel } from '../lib/rules.js';
import { Back, Toggle, Figure, chevR } from '../ui.js';

export function Txn({ app, id }) {
  const { model, state: s } = app;
  const t = model.txns.find(x => x.id === id);
  if (!t) return html`<div><${Back} label="Back" onClick=${app.pop} /><p class="pad body ink2">This payment no longer exists.</p></div>`;
  const c = model.cats.find(x => x.id === t.cat);
  const inc = t.kind === 'income';
  const account = app.data.settings.account;
  const booked = t.booked ? parseDate(t.booked) : null;
  const fields = [
    { k: 'Payment', v: t.method || '—' },
    ...(account ? [{ k: 'Account', v: `ING ${account.name} ${account.short || ''}`.trim() }] : []),
    ...(t.iban ? [{ k: 'Counterparty IBAN', v: t.iban.slice(0, 4) + ' ···· ' + t.iban.slice(-7) }] : []),
    ...(booked ? [{ k: 'Booked', v: dayDiff(booked, model.today) === 0 ? 'Today' : `${wdShort(booked)} ${dayMon(booked)}` }] : []),
  ];
  const note = s.notes[t.id] !== undefined ? s.notes[t.id] : t.note;
  // Why it's in this category: a rule, the catch-all, or a choice made by hand.
  const rule = t.source === 'rule' ? app.data.rules.find(r => r.id === t.rule) : null;
  const filedBy = !c ? null : rule ? `Rule “${rule.pattern}”` : t.source === 'fallback' ? 'Catch-all, no rule matched' : 'You';
  const ruleCat = rule ? rule.cat : c?.id;

  return html`
  <div>
    <${Back} label=${app.backLabel} onClick=${app.pop} />
    <div class="pad">
      <h1 class="title2" style="margin-top:6px">${t.merchant}</h1>
      <div style="margin-top:6px"><${Figure} v=${t.amt} sign=${t.amount > 0 ? '+' : ''} size=${52} cents=${26} track=${-2} /></div>
      <div class="callout" style="margin-top:2px">${WEEKDAYS[t.d.getDay()]}, ${t.d.getDate()} ${MONTHS[t.d.getMonth()]} ${t.d.getFullYear()}${t.time ? ' · ' + t.time : ''}</div>

      <div style="margin-top:26px;border-top:0.5px solid var(--line)">
        <button class="kv" disabled=${inc} aria-expanded=${s.picker ? 'true' : 'false'} onClick=${() => !inc && app.set({ picker: !s.picker })}>
          <span>Category</span>
          <span style=${{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '17px', color: c ? 'var(--ink)' : 'var(--ink2)' }}>
            ${c && icon(c.icon, c.colorVar, 20)}${inc ? 'Income' : c ? c.name : 'Choose'}${!inc && html`<span class="ink3">${chevR()}</span>`}
          </span>
        </button>
        ${s.picker && html`
          <div style="padding:4px 0 8px 12px;border-bottom:0.5px solid var(--line)">
            ${model.cats.map(x => html`
              <button key=${x.id} onClick=${() => app.setCategory(t.id, x.id)} style="display:flex;align-items:center;gap:10px;min-height:44px;font-size:17px;width:100%">
                ${icon(x.icon, x.colorVar, 20)}<span style="flex:1">${x.name}</span><span style=${{ fontWeight: 600, opacity: x.id === t.cat ? 1 : 0 }}>✓</span>
              </button>`)}
            ${t.cat && html`<button onClick=${() => app.setCategory(t.id, null)} style="display:flex;align-items:center;gap:10px;min-height:44px;font-size:17px;width:100%;color:var(--ink2)"><span style="width:20px"></span>Remove category</button>`}
          </div>`}
        ${filedBy && html`
          <button class="kv" disabled=${filedBy === 'You'} onClick=${() => app.push({ t: 'edit', id: ruleCat })}>
            <span>Filed by</span>
            <span style="display:flex;align-items:center;gap:8px">${filedBy}${filedBy !== 'You' && html`<span class="ink3">${chevR()}</span>`}</span>
          </button>`}
        ${c && (t.learned || t.learn) && html`
          <div class="switch-row">
            <div><div class="t" style="font-size:15px;line-height:1.3">Always file ${t.merchant} under ${c.name}</div>
              <div class="s">${t.learned ? `Off removes the rules that file it under ${c.name}.` : `Adds a rule: ${fieldLabel(t.learn.field).toLowerCase()} contains “${t.learn.pattern}”.`}</div></div>
            <${Toggle} on=${t.learned} label=${`Always file ${t.merchant} under ${c.name}`} onClick=${() => app.learn(t.id, !t.learned)} />
          </div>`}
        ${fields.map(f => html`<div key=${f.k} class="kv"><span>${f.k}</span><span>${f.v}</span></div>`)}
      </div>

      <div class="label" style="margin-top:24px">Purpose (Verwendungszweck)</div>
      <div class="mono" style="font-size:13px;line-height:1.5;margin-top:6px;padding-bottom:14px;border-bottom:0.5px solid var(--line);user-select:text;-webkit-user-select:text;overflow-wrap:anywhere">${t.purpose || '—'}</div>
      <label class="label" for="note" style="display:block;margin-top:20px">Note</label>
      <textarea id="note" value=${note} onInput=${e => app.editNote(t.id, e.target.value)} onBlur=${() => app.flushNote(t.id)} placeholder="Add a note" rows="3"
        style="display:block;width:100%;box-sizing:border-box;margin-top:6px;border:0;border-bottom:0.5px solid var(--line);background:transparent;font:inherit;font-size:17px;color:var(--ink);resize:none;outline:none;padding:0 0 10px;border-radius:0"></textarea>
    </div>
  </div>`;
}
