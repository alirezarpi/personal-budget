import { html } from '../vendor/preact-htm.js';
import { icon, glyph } from '../lib/icons.js';
import { categoryRing, paceChart, monthBars } from '../lib/charts.js';
import { row, dueIn } from '../lib/budget.js';
import { fmt, money, ord, dayMon, dayMonth, wdDayMonth } from '../lib/format.js';
import { Back, Figure, TxRow } from '../ui.js';

export function Category({ app, id }) {
  const { model, md, state: s } = app;
  const c = model.cats.find(x => x.id === id);
  if (!c) return html`<div><${Back} label="Back" onClick=${app.pop} /><p class="pad body ink2">This category no longer exists.</p></div>`;
  const mi = s.month, M = md.M;
  const rw = md.ring.find(r => r.id === c.id) || row(model, c, 0, mi, () => {});
  const txs = md.fut ? [] : model.txnsIn(M, t => t.cat === c.id);
  const series = [];
  for (let i = Math.max(0, mi - 5); i <= mi; i++) series.push({ label: model.periods[i].s, v: model.spentFor(i, c), cur: i === mi });
  const prior = series.filter(x => !x.cur), avg = prior.length ? prior.reduce((a, x) => a + x.v, 0) / prior.length : 0;
  const st = rw.st, dl = md.daysLeft, today = model.todayN;
  const name = c.name.toLowerCase();

  let copy = '', copy2 = '';
  if (c.fixed) {
    copy = st === 'settled'
      ? `Paid on ${rw.paid ? wdDayMonth(rw.paid.d) : dayMonth(rw.dueDate)}. Nothing more is expected this month.`
      : md.past ? `${money(rw.spent)} of ${money(c.limit)} was paid in ${M.n}.`
      : `Due on the ${ord(c.due)}. ${money(c.limit - rw.spent)} is held back from safe-to-spend.`;
  } else if (md.cur) {
    const proj = rw.spent / today * M.dim;
    if (st === 'over') {
      copy = `${money(-rw.left)} over the limit, with ${dl} ${dl === 1 ? 'day' : 'days'} to go.`;
      copy2 = `Anything more for ${name} this month reduces what’s safe to spend elsewhere.`;
    } else {
      copy = `${money(rw.left)} left for ${name}. ${dl} ${dl === 1 ? 'day' : 'days'} to go.`;
      if (today >= 3) copy2 = proj > c.limit
        ? `At this pace it reaches about ${money(Math.round(proj))} by ${dayMonth(M.end)}. ${money(rw.left / dl)} a day keeps it under.`
        : `At this pace it ends near ${money(Math.round(proj))}, under the limit.`;
    }
  } else if (md.past) copy = `${M.n}: ${money(rw.spent)} of ${money(c.limit)}.`;
  else copy = `${money(c.limit)} available from ${dayMonth(M.start)}.`;

  const stText = { ok: 'On track', close: 'Close to the limit', over: 'Over the limit', settled: 'Settled for ' + M.n, due: 'Not paid yet' }[st] + (c.fixed ? '' : ' · alert at ' + c.thr + '%');
  const showPace = md.cur && !c.fixed && today > 1;
  const nextPeriod = model.periods[mi + 1];
  const payee = txs[0] ? txs[0].merchant : model.txns.find(t => t.cat === c.id)?.merchant;

  return html`
  <div>
    <${Back} label=${app.backLabel} onClick=${app.pop} right=${html`<button class="nav-btn" onClick=${() => app.push({ t: 'edit', id: c.id })}>Edit</button>`} />
    <div class="pad">
      <div style="display:flex;align-items:center;gap:10px;margin-top:4px">${icon(c.icon, c.colorVar, 30, 1.8)}<h1 class="large-title">${c.name}</h1></div>
      <div class="callout" style="margin-top:2px">${(c.fixed ? 'Fixed cost · ' : '') + M.n + ' ' + M.end.getFullYear()}</div>

      <div style="display:grid;grid-template-columns:156px 1fr;column-gap:22px;align-items:center;margin-top:24px">
        <div style="position:relative;width:156px;height:156px">
          ${categoryRing(rw, 156)}
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
            <div style="font-size:28px;font-weight:600;letter-spacing:-0.8px">${st === 'settled' ? 'Paid' : Math.round(rw.p * 100) + '%'}</div>
            <div style="font-size:11px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;color:var(--ink2)">${st === 'settled' ? 'Settled' : st === 'over' ? 'Of limit' : 'Used'}</div>
          </div>
        </div>
        <div>
          <div style="padding-bottom:8px;border-bottom:0.5px solid var(--line)"><div class="label">Spent</div><${Figure} v=${rw.spent} size=${28} cents=${17} track=${-0.8} /></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--line);font-size:15px"><span class="ink2">Limit</span><span style="font-weight:500">${fmt(c.limit).full}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:15px"><span class="ink2">${rw.left < 0 ? 'Over' : 'Left'}</span><span style=${{ fontWeight: 600, color: rw.left < 0 ? 'var(--over)' : 'var(--ink)' }}>${fmt(rw.left).full}</span></div>
        </div>
      </div>

      <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '22px', fontSize: '15px', fontWeight: 600, color: st === 'over' ? 'var(--over)' : 'var(--ink)' }}>${glyph(st)}<span>${stText}</span></div>
      <p class="body" style="margin-top:6px">${copy}</p>
      ${copy2 && html`<p class="callout" style="line-height:1.4;margin-top:4px;text-wrap:pretty">${copy2}</p>`}

      ${showPace && html`
        <div class="section">
          <h2>Pace</h2>
          <div class="aside">
            <span style="display:flex;align-items:center;gap:5px"><span style=${{ width: '12px', height: '2px', background: c.colorVar, display: 'block' }}></span>Actual</span>
            <span style="display:flex;align-items:center;gap:5px"><span style="width:12px;border-top:1px dashed var(--ink2);display:block"></span>Even pace</span>
          </div>
        </div>
        <div style="margin-top:14px">${paceChart(rw, txs.map(t => ({ di: model.dayIndex(M, t.d), amt: -t.amount })), M.dim, today, { start: dayMon(M.start), end: dayMon(M.end) }, 'pace')}</div>`}

      ${c.fixed && html`
        <div class="section"><h2>Payment</h2></div>
        <div class="kv"><span class="ink2" style="font-size:15px">Paid on</span><span style="font-weight:500;color:var(--ink)">${rw.paid ? wdDayMonth(rw.paid.d) : '—'}</span></div>
        ${payee && html`<div class="kv"><span class="ink2" style="font-size:15px">To</span><span style="font-weight:500;color:var(--ink)">${payee}</span></div>`}
        <div class="kv"><span class="ink2" style="font-size:15px">Next due</span><span style="font-weight:500;color:var(--ink)">${dayMonth(st === 'settled' || md.past ? (nextPeriod ? dueIn(nextPeriod, c.due) : rw.dueDate) : rw.dueDate)}</span></div>`}

      <div class="section"><h2>Last 6 months</h2><div class="aside">${prior.length ? 'Average ' + money(Math.round(avg)) : ''}</div></div>
      <div style="margin-top:14px">${monthBars(series, c.limit, c.colorVar)}</div>

      <div class="section" style="margin-top:28px"><h2>${M.n}</h2><div class="aside">${txs.length ? (txs.length === 1 ? '1 payment' : txs.length + ' payments') : ''}</div></div>
      ${txs.map(t => html`<${TxRow} key=${t.id} t=${t} cats=${model.cats} plain onOpen=${tid => app.push({ t: 'txn', id: tid })} />`)}
      ${!txs.length && html`<p class="callout" style="padding:16px 0;line-height:1.4">${md.fut ? 'No payments yet.' : `Nothing spent on ${name} in ${M.n}${md.cur ? ' so far' : ''}.`}</p>`}
    </div>
  </div>`;
}
