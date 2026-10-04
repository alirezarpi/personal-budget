import { html } from '../vendor/preact-htm.js';
import { icon } from '../lib/icons.js';
import { fmt, dayDiff, WEEKDAYS, dayMon } from '../lib/format.js';
import { TxRow, InboxLink } from '../ui.js';

export function Transactions({ app }) {
  const { model, state: s } = app;
  const q = s.q.trim().toLowerCase();
  const inboxCount = model.uncat.length;
  // The current budget month by default; a search looks through everything.
  const pool = q ? model.txns : model.txnsIn(model.cur);
  const filtered = pool.filter(t =>
    (s.filter === 'all' || (s.filter === 'uncat' ? t.kind === 'uncat' : t.cat === s.filter)) &&
    (!q || `${t.merchant} ${t.raw} ${t.purpose} ${t.amt.toFixed(2)} ${t.note}`.toLowerCase().includes(q)));

  const days = [...new Set(filtered.map(t => t.date))].sort().reverse();
  const groups = days.map(date => {
    const rows = filtered.filter(t => t.date === date).sort((a, b) => b.time.localeCompare(a.time));
    const d = rows[0].d, ago = dayDiff(d, model.today);
    const tot = rows.filter(t => t.kind !== 'income').reduce((a, t) => a - t.amount, 0);
    return { date, label: (ago === 0 ? 'Today · ' : ago === 1 ? 'Yesterday · ' : '') + `${WEEKDAYS[d.getDay()]}, ${dayMon(d)}${d.getFullYear() !== model.today.getFullYear() ? ' ' + d.getFullYear() : ''}`, total: tot > 0.004 ? fmt(tot).full : '', rows };
  });

  const chips = [{ id: 'all', label: 'All' }, { id: 'uncat', label: 'Uncategorized', count: inboxCount || '' }, ...model.cats.map(c => ({ id: c.id, label: c.name }))];
  const emptyText = q ? `No payments match “${s.q.trim()}”.` : s.filter === 'uncat' ? 'Every payment has a category.' : s.filter === 'all' ? `No payments in ${model.cur.n} yet.` : 'No payments in this category yet this month.';

  return html`
  <div class="pad">
    <h1 class="large-title" style="margin-top:8px">Transactions</h1>
    <label style="display:flex;align-items:center;gap:6px;height:36px;border-radius:10px;background:var(--fill);padding:0 8px;margin-top:10px;color:var(--ink2)">
      ${icon('search', 'var(--ink2)', 18, 2)}
      <input type="search" value=${s.q} onInput=${e => app.set({ q: e.target.value })} placeholder="Merchant, purpose or amount" aria-label="Search payments"
        style="border:0;background:transparent;font:inherit;font-size:17px;color:var(--ink);flex:1;outline:none;min-width:0;letter-spacing:-0.3px;-webkit-appearance:none" />
    </label>
    <div style="display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin:4px -20px 0;padding:0 20px">
      ${chips.map(c => html`<button key=${c.id} class="chip" aria-pressed=${s.filter === c.id ? 'true' : 'false'} onClick=${() => app.set({ filter: c.id })}><span>${c.label}${c.count ? html`<span class="count">${c.count}</span>` : null}</span></button>`)}
    </div>
    ${inboxCount > 0 && s.filter === 'all' && !q && html`
      <${InboxLink} count=${inboxCount} title="Uncategorized" sub="Sort once and Monat remembers the merchant" onClick=${() => app.push({ t: 'inbox' })} style="margin-top:8px" />`}
    ${groups.map(g => html`
      <div key=${g.date} style="margin-top:22px">
        <div class="group-head"><span>${g.label}</span><span>${g.total}</span></div>
        ${g.rows.map(t => html`<${TxRow} key=${t.id} t=${t} cats=${model.cats} onOpen=${id => app.push({ t: 'txn', id })} />`)}
      </div>`)}
    ${!groups.length && html`<p class="body ink2" style="padding:48px 0">${emptyText}</p>`}
  </div>`;
}
