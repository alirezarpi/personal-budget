import { html } from './vendor/preact-htm.js';
import { icon, glyph } from './lib/icons.js';
import { fmt, wdShort, dayMon } from './lib/format.js';

export const chevL = () => icon('chevL', 'currentColor', 22, 2);
export const chevR = () => icon('chevR', 'currentColor', 16, 2);

export const Back = ({ label, onClick, right }) => html`
  <div class="nav">
    <button class="back" onClick=${onClick}>${chevL()}<span>${label}</span></button>
    ${right}
  </div>`;

export const Toggle = ({ on, onClick, label }) => html`
  <button class="toggle" role="switch" aria-checked=${on ? 'true' : 'false'} aria-label=${label} onClick=${onClick}><span class="knob"></span></button>`;

export const Seg = ({ options, value, onPick, cols }) => html`
  <div class="seg" style=${{ gridTemplateColumns: `repeat(${cols || options.length}, 1fr)` }}>
    ${options.map(o => html`<button key=${o.value} aria-pressed=${o.value === value ? 'true' : 'false'} onClick=${() => onPick(o.value)}><span>${o.label}</span></button>`)}
  </div>`;

// Euros big, cents at about half size in a lighter ink.
export const Figure = ({ v, size, cents, weight = 600, track, sign = '' }) => {
  const f = typeof v === 'number' ? fmt(v) : v;
  return html`<span style=${{ display: 'inline-flex', alignItems: 'baseline' }}>
    <span style=${{ fontSize: size + 'px', fontWeight: weight, letterSpacing: track + 'px' }}>${sign}${f.e}</span>
    <span class="cents" style=${{ fontSize: cents + 'px' }}>${f.c}</span>
  </span>`;
};

export const Amount = ({ v, sign = '' }) => {
  const f = fmt(v);
  return html`<div class="amt"><span class="e">${sign}${f.e}</span><span class="c">${f.c}</span></div>`;
};

export const CategoryRow = ({ r }) => html`
  <button class="cat-row" onClick=${r.open}>
    <div class="grid-row">
      <div>${r.iconEl}</div>
      <div style="min-width:0">
        <div class="name">${r.name}</div>
        <div class="note" style=${{ color: r.noteColor, fontWeight: r.noteW }}>${r.glyph}<span>${r.note}</span></div>
      </div>
      <div class="fig">
        <div><span class="e">${r.amt.e}</span><span class="c">${r.amt.c}</span></div>
        <div class="label">${r.limitTxt}</div>
      </div>
    </div>
    <div class="bar" aria-hidden="true">
      <i class=${'track' + (r.bar.due ? ' due' : '')}></i>
      <i class="fill" style=${{ width: r.bar.w, background: r.color }}></i>
      ${r.bar.showTick && html`<i class="tick" style=${{ left: r.bar.tick }}></i>`}
      ${r.bar.over && html`<i class="lap" style=${{ width: r.bar.ow }}></i>`}
    </div>
  </button>`;

export function txView(t, cats) {
  const c = cats.find(x => x.id === t.cat);
  const inc = t.kind === 'income';
  return {
    id: t.id, merchant: t.merchant,
    sub: inc ? 'Income' : c ? c.name : t.amount > 0 ? 'Refund · needs a category' : 'Needs a category',
    subC: c || inc ? 'var(--ink2)' : 'var(--ink)',
    iconEl: inc ? icon('plus', 'var(--ink2)', 22) : c ? icon(c.icon, c.colorVar, 22) : glyph('inbox'),
    sign: t.amount > 0 ? '+' : '',
    date: `${wdShort(t.d)} ${dayMon(t.d)}${t.time ? ' · ' + t.time : ''}`,
    amt: t.amt,
  };
}

export const TxRow = ({ t, cats, onOpen, plain }) => {
  const v = txView(t, cats);
  return plain
    ? html`<button class="tx-row plain" onClick=${() => onOpen(t.id)}>
        <div style="min-width:0"><div class="m">${v.merchant}</div><div class="sub">${v.date}</div></div>
        <${Amount} v=${v.amt} sign=${v.sign} />
      </button>`
    : html`<button class="tx-row" onClick=${() => onOpen(t.id)}>
        <div>${v.iconEl}</div>
        <div style="min-width:0"><div class="m">${v.merchant}</div><div class="sub" style=${{ color: v.subC }}>${v.sub}</div></div>
        <${Amount} v=${v.amt} sign=${v.sign} />
      </button>`;
};

export const InboxLink = ({ count, title, sub, onClick, style }) => html`
  <button class="inbox-link" onClick=${onClick} style=${style}>
    <div class="dashed" style="width:28px;height:28px">${count}</div>
    <div style="flex:1">${sub ? html`<div style="font-size:15px;font-weight:600">${title}</div><div class="label">${sub}</div>` : html`<div style="font-size:15px">${title}</div>`}</div>
    <div class="ink3">${chevR()}</div>
  </button>`;

// Horizontal drag on touch and mouse. Vertical movement is left to the browser so lists still scroll.
// Gesture state lives in `store[key]` so it survives the re-renders the drag itself causes.
export function dragX(store, key, { onMove, onEnd }) {
  const start = (x, y) => { store[key] = { x, y, mode: null }; };
  const move = (x, y, e) => {
    const g = store[key];
    if (!g) return;
    const dx = x - g.x, dy = y - g.y;
    if (!g.mode) { if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) g.mode = 'x'; else if (Math.abs(dy) > 8) g.mode = 'n'; }
    if (g.mode === 'x') { e.cancelable && e.preventDefault(); onMove(dx); }
  };
  const end = () => { const g = store[key]; store[key] = null; if (g && g.mode === 'x') onEnd(); };
  return {
    onTouchStart: e => start(e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: e => move(e.touches[0].clientX, e.touches[0].clientY, e),
    onTouchEnd: end, onTouchCancel: end,
    onPointerDown: e => { if (e.pointerType === 'mouse') start(e.clientX, e.clientY); },
    onPointerMove: e => { if (e.pointerType === 'mouse') move(e.clientX, e.clientY, e); },
    onPointerUp: e => { if (e.pointerType === 'mouse') end(); },
    onPointerLeave: e => { if (e.pointerType === 'mouse') end(); },
  };
}
