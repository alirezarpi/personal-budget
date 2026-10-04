import { h } from '../vendor/preact-htm.js';
import { money } from './format.js';

function pt(c, r, a) { const t = (a - 90) * Math.PI / 180; return [c + r * Math.cos(t), c + r * Math.sin(t)]; }
function arc(c, r, a0, a1) {
  const [x0, y0] = pt(c, r, a0), [x1, y1] = pt(c, r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${(a1 - a0) > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// The month ring: one slot per category, sized by its limit. Fill is what's spent, a notch marks the
// alert threshold, and overspend leaves the track as a thin second lap outside it.
export function monthRing(rows, focus, size = 272, onTap) {
  const c = size / 2, sw = size * 0.081, r = c - size * 0.11;
  const tl = rows.reduce((a, b) => a + b.limit, 0) || 1, gap = rows.length > 1 ? 1.8 : 0;
  let a = 0;
  const kids = rows.map(rw => {
    const slot = 360 * rw.limit / tl, s = a + gap / 2, e = a + slot - gap / 2; a += slot;
    const g = [];
    g.push(h('path', { key: 't', d: arc(c, r, s, Math.min(e, s + 359.9)), style: { stroke: 'var(--fill)', strokeWidth: sw, fill: 'none' } }));
    const p = Math.min(rw.p, 1);
    if (p > 0.002) g.push(h('path', { key: 'f', d: arc(c, r, s, s + Math.min(e - s, 359.9) * p), style: { stroke: rw.color, strokeWidth: sw, fill: 'none' } }));
    if (!rw.fixed && rw.thr < 100) {
      const ta = s + (e - s) * rw.thr / 100;
      const [x0, y0] = pt(c, r - sw / 2 - 1, ta), [x1, y1] = pt(c, r + sw / 2 + 1, ta);
      g.push(h('line', { key: 'k', x1: x0, y1: y0, x2: x1, y2: y1, style: { stroke: 'var(--bg)', strokeWidth: 2 } }));
    }
    if (rw.p > 1.00001) {
      const ex = Math.min(rw.p - 1, 1);
      g.push(h('path', { key: 'o', d: arc(c, r + sw / 2 + size * 0.034, s, s + Math.max(Math.min(e - s, 359.9) * ex, 1)), style: { stroke: 'var(--over)', strokeWidth: size * 0.03, strokeLinecap: 'round', fill: 'none' } }));
    }
    if (onTap) {
      // Hit area 20 pt wider than the stroke so thin slots stay tappable.
      g.push(h('path', { key: 'h', d: arc(c, r, s, Math.min(e, s + 359.9)), onClick: ev => { ev.stopPropagation(); onTap(rw.id); }, style: { stroke: 'transparent', strokeWidth: sw + 20, fill: 'none', cursor: 'pointer', pointerEvents: 'stroke' } }));
    }
    return h('g', { key: rw.id, style: { opacity: focus && focus !== rw.id ? 0.2 : 1, transition: 'opacity .25s' } }, g);
  });
  return h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': 'Spending by category', style: { display: 'block', overflow: 'visible' } }, kids);
}

export function categoryRing(rw, size = 156) {
  const c = size / 2, sw = size * 0.09, r = c - sw / 2 - size * 0.03, p = rw.p, k = [];
  k.push(h('circle', { key: 't', cx: c, cy: c, r, style: { fill: 'none', stroke: 'var(--fill)', strokeWidth: sw } }));
  if (p >= 0.999 || rw.st === 'settled') k.push(h('circle', { key: 'f', cx: c, cy: c, r, style: { fill: 'none', stroke: rw.color, strokeWidth: sw } }));
  else if (p > 0.002) k.push(h('path', { key: 'f', d: arc(c, r, 0, 360 * p), style: { fill: 'none', stroke: rw.color, strokeWidth: sw, strokeLinecap: 'round' } }));
  if (!rw.fixed && rw.thr < 100 && p < 1) {
    const ta = 3.6 * rw.thr;
    const [x0, y0] = pt(c, r - sw / 2 - 1, ta), [x1, y1] = pt(c, r + sw / 2 + 1, ta);
    k.push(h('line', { key: 'k', x1: x0, y1: y0, x2: x1, y2: y1, style: { stroke: 'var(--bg)', strokeWidth: 2 } }));
  }
  if (p > 1.00001) {
    const ex = Math.min(p - 1, 0.97) * 360, d = arc(c, r, 0, Math.max(ex, 2));
    k.push(h('path', { key: 's', d, style: { fill: 'none', stroke: 'var(--bg)', strokeWidth: sw + 4, strokeLinecap: 'round' } }));
    k.push(h('path', { key: 'o', d, style: { fill: 'none', stroke: 'var(--over)', strokeWidth: sw, strokeLinecap: 'round' } }));
    const [ex1, ey1] = pt(c, r, Math.max(ex, 2));
    k.push(h('circle', { key: 'e', cx: ex1, cy: ey1, r: sw * 0.18, style: { fill: 'var(--bg)' } }));
  }
  return h('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true', style: { display: 'block', overflow: 'visible' } }, k);
}

// Cumulative spend through the period against an even pace to the limit, with a dotted projection.
export function paceChart(rw, txs, dim, today, labels, uid) {
  const W = 353, H = 150, top = 20, bot = 22, ih = H - top - bot;
  const proj = today > 0 ? rw.spent / today * dim : 0;
  const ymax = Math.max(rw.limit, proj, rw.spent) * 1.08 || 1;
  const X = d => dim > 1 ? (d - 1) / (dim - 1) * W : 0, Y = v => top + ih - v / ymax * ih;
  let cum = 0, d1 = `M0 ${Y(0)}`;
  for (let d = 1; d <= today; d++) {
    const day = txs.filter(t => t.di === d).reduce((a, t) => a + t.amt, 0);
    d1 += ` L${X(d).toFixed(1)} ${Y(cum).toFixed(1)}`; cum += day; d1 += ` L${X(d).toFixed(1)} ${Y(cum).toFixed(1)}`;
  }
  const id = uid + rw.id, yl = Y(rw.limit);
  return h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `Spending pace for ${rw.name}`, style: { overflow: 'visible' } }, [
    h('defs', { key: 'd' }, h('clipPath', { id: id + 'c' }, h('rect', { x: -4, y: -10, width: W + 8, height: yl + 10 }))),
    h('line', { key: 'b', x1: 0, x2: W, y1: Y(0), y2: Y(0), style: { stroke: 'var(--line)', strokeWidth: 1 } }),
    h('line', { key: 'l', x1: 0, x2: W, y1: yl, y2: yl, style: { stroke: 'var(--ink3)', strokeWidth: 0.75 } }),
    h('text', { key: 'lt', x: W, y: yl - 6, 'text-anchor': 'end', style: { fontSize: 11, fill: 'var(--ink2)', fontWeight: 600 } }, 'Limit ' + money(rw.limit)),
    h('path', { key: 'i', d: `M0 ${Y(0)} L${W} ${yl}`, style: { stroke: 'var(--ink2)', strokeWidth: 1, strokeDasharray: '3 3', fill: 'none' } }),
    today < dim && h('path', { key: 'p', d: `M${X(today)} ${Y(rw.spent)} L${W} ${Y(proj)}`, style: { stroke: rw.color, strokeWidth: 1.5, strokeDasharray: '1 4', strokeLinecap: 'round', fill: 'none' } }),
    h('path', { key: 'a', d: d1, style: { stroke: rw.color, strokeWidth: 2, fill: 'none', strokeLinejoin: 'round' } }),
    h('path', { key: 'ao', d: d1, 'clip-path': `url(#${id}c)`, style: { stroke: 'var(--over)', strokeWidth: 2, fill: 'none', strokeLinejoin: 'round' } }),
    h('circle', { key: 'dot', cx: X(today), cy: Y(rw.spent), r: 4, style: { fill: rw.p > 1 ? 'var(--over)' : rw.color, stroke: 'var(--bg)', strokeWidth: 2 } }),
    h('text', { key: 'x1', x: 0, y: H - 4, style: { fontSize: 11, fill: 'var(--ink2)' } }, labels.start),
    h('text', { key: 'x2', x: X(today), y: H - 4, 'text-anchor': today < 4 ? 'start' : today > dim - 3 ? 'end' : 'middle', style: { fontSize: 11, fill: 'var(--ink)', fontWeight: 600 } }, 'Today'),
    today < dim - 4 && h('text', { key: 'x3', x: W, y: H - 4, 'text-anchor': 'end', style: { fontSize: 11, fill: 'var(--ink2)' } }, labels.end),
  ]);
}

export function monthBars(series, limit, color) {
  const W = 353, H = 128, top = 20, bot = 22, ih = H - top - bot, n = series.length;
  const max = Math.max(limit * 1.2, ...series.map(s => s.v)) * 1.04 || 1;
  const Y = v => top + ih - v / max * ih, colW = W / 6, bw = 26, k = [];
  k.push(h('line', { key: 'lim', x1: 0, x2: W, y1: Y(limit), y2: Y(limit), style: { stroke: 'var(--ink2)', strokeWidth: 0.75, strokeDasharray: '3 3' } }));
  series.forEach((s, i) => {
    const x = (6 - n + i) * colW + colW / 2 - bw / 2, base = Math.min(s.v, limit);
    k.push(h('rect', { key: 'b' + i, x, y: Y(base), width: bw, height: Math.max(Y(0) - Y(base), 0.5), rx: 2, style: { fill: color, opacity: s.cur ? 1 : 0.45 } }));
    if (s.v > limit) k.push(h('rect', { key: 'o' + i, x, y: Y(s.v), width: bw, height: Y(limit) - Y(s.v), rx: 2, style: { fill: 'var(--over)' } }));
    k.push(h('text', { key: 'v' + i, x: x + bw / 2, y: Y(s.v) - 6, 'text-anchor': 'middle', style: { fontSize: 11, fill: s.v > limit ? 'var(--over)' : 'var(--ink2)', fontWeight: s.v > limit ? 600 : 400 } }, money(Math.round(s.v))));
    k.push(h('text', { key: 'm' + i, x: x + bw / 2, y: H - 4, 'text-anchor': 'middle', style: { fontSize: 11, fill: s.cur ? 'var(--ink)' : 'var(--ink2)', fontWeight: s.cur ? 600 : 400 } }, s.label));
  });
  k.push(h('line', { key: 'base', x1: 0, x2: W, y1: Y(0), y2: Y(0), style: { stroke: 'var(--line)', strokeWidth: 1 } }));
  return h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Spending in recent months', style: { overflow: 'visible' } }, k);
}
