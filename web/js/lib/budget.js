// Turns raw categories and transactions into what the screens show: budget months, category states,
// the ring, safe-to-spend and the sentences around them.

import { glyph, icon, colorVar } from './icons.js';
import { fmt, money, list, MONTHS, short, parseDate, parseDateTime, addDays, dayDiff, dayMon, dayMonth } from './format.js';

// A budget month is named for the calendar month it ends in. With a start day of 25,
// "October" runs from 25 September to 24 October.
export function makePeriod(y, m, startDay) {
  const start = startDay === 1 ? new Date(y, m - 1, 1) : new Date(y, m - 2, startDay);
  const end = startDay === 1 ? new Date(y, m, 0) : new Date(y, m - 1, startDay - 1);
  const n = MONTHS[(m + 11) % 12];
  return { key: `${y}-${String(m).padStart(2, '0')}`, y, m, n, s: short(n), start, end, dim: dayDiff(start, end) + 1 };
}
export function periodFor(d, startDay) {
  let y = d.getFullYear(), m = d.getMonth() + 1;
  if (startDay !== 1 && d.getDate() >= startDay) { m += 1; if (m > 12) { m = 1; y += 1; } }
  return makePeriod(y, m, startDay);
}
const shift = (p, n, startDay) => { const t = new Date(p.y, p.m - 1 + n, 1); return makePeriod(t.getFullYear(), t.getMonth() + 1, startDay); };
const inPeriod = (p, d) => d >= p.start && d <= p.end;
export const dayIndex = (p, d) => dayDiff(p.start, d) + 1;

export function buildModel(data) {
  const now = parseDateTime(data.now);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = data.settings.month_start || 1;
  const cats = data.categories.map(c => ({ ...c, colorVar: colorVar(c.color) }));
  const txns = data.transactions.map(t => {
    const d = parseDate(t.date);
    const kind = t.cat ? 'cat' : t.amount > 0 ? 'income' : 'uncat';
    return { ...t, d, kind, amt: Math.abs(t.amount) };
  });

  const cur = periodFor(today, startDay);
  const earliest = txns.reduce((a, t) => t.d < a ? t.d : a, today);
  const periods = [];
  for (let p = periodFor(earliest, startDay); p.key <= cur.key; p = shift(p, 1, startDay)) periods.push(p);
  periods.push(shift(cur, 1, startDay));
  const CUR = periods.length - 2;
  const todayN = dayIndex(cur, today);

  // Spend per period and category. A refund (positive amount in a category) reduces spend.
  const spend = {};
  for (const t of txns) {
    if (t.kind !== 'cat') continue;
    const p = periodFor(t.d, startDay).key;
    spend[p] = spend[p] || {};
    spend[p][t.cat] = (spend[p][t.cat] || 0) - t.amount;
  }
  const spentFor = (pi, c) => (spend[periods[pi].key] || {})[c.id] || 0;
  const txnsIn = (p, filter) => txns.filter(t => inPeriod(p, t.d) && (!filter || filter(t)));
  const incomeIn = p => txnsIn(p, t => t.kind === 'income').reduce((a, t) => a + t.amount, 0);
  const uncat = txns.filter(t => t.kind === 'uncat');

  return { now, today, startDay, cats, txns, periods, CUR, cur, todayN, spentFor, txnsIn, incomeIn, uncat, inPeriod, dayIndex };
}

export function row(model, c, spent, pi, open) {
  const M = model.periods[pi], isCur = pi === model.CUR;
  const p = c.limit ? spent / c.limit : 0;
  // A fixed cost is paid once its payment lands, even a few cents under the limit.
  const st = c.fixed ? (spent > 0.005 ? 'settled' : 'due') : p > 1.00001 ? 'over' : p * 100 >= c.thr ? 'close' : 'ok';
  const left = c.limit - spent;
  const paid = st === 'settled' ? model.txnsIn(M, t => t.cat === c.id)[0] : null;
  const dueDate = dueIn(M, c.due);
  let note;
  if (st === 'settled') note = 'Paid ' + (paid ? dayMon(paid.d) : dayMon(dueDate));
  else if (st === 'due') note = 'Due ' + dayMon(dueDate);
  else if (st === 'over') note = money(left) + ' over';
  else if (st === 'close') note = money(left) + ' left · ' + Math.round(p * 100) + '%';
  else note = spent === 0 ? 'Nothing spent yet' : money(left) + ' left';
  return {
    id: c.id, name: c.name, color: c.colorVar, icon: c.icon, fixed: !!c.fixed, thr: c.thr, limit: c.limit, due: c.due,
    spent, p, st, left, note, paid, dueDate, isCur,
    noteColor: st === 'over' ? 'var(--over)' : 'var(--ink2)', noteW: st === 'over' || st === 'close' ? 600 : 400,
    glyph: glyph(st === 'ok' ? null : st), iconEl: icon(c.icon, c.colorVar, 24),
    amt: fmt(spent), limitTxt: st === 'settled' ? 'Fixed cost' : 'of ' + money(c.limit),
    bar: {
      w: (Math.min(p, 1) * 100) + '%', ow: (Math.min(Math.max(p - 1, 0), 1) * 100) + '%', over: p > 1.00001,
      tick: `calc(${c.thr}% - 1px)`, showTick: !c.fixed && c.thr < 100, due: st === 'due',
    },
    open,
  };
}

// The due date of a fixed cost inside a period: the first date in it with that day of the month.
export function dueIn(p, day) {
  for (let d = p.start; d <= p.end; d = addDays(d, 1)) if (d.getDate() === day) return d;
  return p.start;
}

export function monthData(model, pi, focus, openCat) {
  const M = model.periods[pi], cur = pi === model.CUR, past = pi < model.CUR, fut = pi > model.CUR;
  const next = model.periods[pi + 1] || null;
  const ring = model.cats.map(c => row(model, c, fut ? 0 : model.spentFor(pi, c), pi, () => openCat(c.id)));
  const rank = { over: 0, close: 1, ok: 2, due: 3, settled: 4 };
  const rows = [...ring].sort((a, b) => rank[a.st] - rank[b.st] || b.p - a.p);
  const tl = ring.reduce((a, r) => a + r.limit, 0), ts = ring.reduce((a, r) => a + r.spent, 0), left = tl - ts;
  const unpaid = ring.filter(r => r.st === 'due').reduce((a, r) => a + r.limit - r.spent, 0);
  const daysLeft = cur ? M.dim - model.todayN + 1 : fut ? M.dim : 0;
  const safe = cur ? Math.max(0, left - unpaid) / daysLeft : 0;
  const overs = ring.filter(r => r.st === 'over'), closes = ring.filter(r => r.st === 'close');
  const totalOver = overs.reduce((a, r) => a - r.left, 0);
  const flex = ring.filter(r => !r.fixed);
  const untilStart = model.cur.dim - model.todayN + 1;

  let summary;
  if (!ring.length) summary = 'Add a category in Budgets to start tracking this month.';
  else if (fut) summary = `Nothing spent in ${M.n} yet. Budgets reset on ${dayMonth(M.start)}, in ${untilStart} ${untilStart === 1 ? 'day' : 'days'}.`;
  else if (past) {
    summary = `${M.n} closed at ${money(ts)} of ${money(tl)}. ` + (left >= 0 ? `${money(left)} stayed unspent.` : `${money(left)} over in total.`);
    if (overs.length) summary += ` ${list(overs.map(r => r.name))} went over.`;
  } else if (flex.length && overs.length === flex.length) {
    summary = `Every budget is over, by ${money(totalOver)} in total. Nothing is safe to spend until ${next ? next.n : 'next month'}.`;
  } else if (model.todayN === 1) {
    const settled = ring.filter(r => r.st === 'settled').map(r => r.name);
    summary = `First day of ${M.n}. ` + (settled.length ? `${list(settled)} ${settled.length > 1 ? 'are' : 'is'} paid. ${money(left - unpaid)} is left for the other categories.` : `${money(left - unpaid)} is there to spend.`);
  } else {
    const parts = [];
    if (overs.length === 1) parts.push(`${overs[0].name} is ${money(-overs[0].left)} over.`);
    else if (overs.length) parts.push(`${list(overs.map(r => r.name))} are over, by ${money(totalOver)} combined.`);
    if (closes.length === 1) parts.push(`${money(closes[0].left)} left for ${closes[0].name.toLowerCase()}, with ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} to go.`);
    else if (closes.length) parts.push(`${list(closes.map(r => r.name))} are close to their limits.`);
    if (!parts.length) parts.push('Everything is on track.');
    summary = parts.join(' ');
  }

  let center;
  const f = focus && ring.find(r => r.id === focus);
  if (f) center = { label: f.name, glyph: f.st === 'ok' ? null : glyph(f.st), big: fmt(f.spent), sub: 'of ' + money(f.limit), sub2: f.note, sub2C: f.st === 'over' ? 'var(--over)' : 'var(--ink)' };
  else if (fut) center = { label: 'To spend', big: fmt(tl), sub: 'in ' + M.n, sub2: `Starts in ${untilStart} ${untilStart === 1 ? 'day' : 'days'}`, sub2C: 'var(--ink)' };
  else if (past) center = { label: left >= 0 ? 'Unspent' : 'Over', big: fmt(left), sub: M.n + ' closed', sub2: '', sub2C: 'var(--ink)' };
  else center = { label: 'Safe to spend', big: fmt(safe), sub: 'a day', sub2: totalOver > 0 && safe === 0 ? money(totalOver) + ' over' : daysLeft + (daysLeft === 1 ? ' day left' : ' days left'), sub2C: safe === 0 ? 'var(--over)' : 'var(--ink)' };

  return {
    M, cur, past, fut, ring, rows, tl, ts, left, safe, daysLeft, summary, center, totalOver, next,
    heroLabel: fut ? `${M.n} ${M.end.getFullYear()}` : 'Spent in ' + M.n,
    heroSub: fut ? 'Budget ' + money(tl) : `of ${money(tl)} budgeted · ${left >= 0 ? money(left) + ' left' : money(left) + ' over'}`,
  };
}
