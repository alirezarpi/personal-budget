import { h } from '../vendor/preact-htm.js';

// 24×24 stroke icons, drawn for this app.
const ICONS = {
  rent: ['M4 11.2 12 4.5l8 6.7V20H4z', 'M10 20v-5.5h4V20'],
  groc: ['M3.5 9h17l-1.7 10.1a1.2 1.2 0 0 1-1.2 1H6.4a1.2 1.2 0 0 1-1.2-1z', 'M8.5 9 12 4l3.5 5'],
  car: ['M3.5 16.5v-4.3l1.9-4.4A1.4 1.4 0 0 1 6.7 7h10.6a1.4 1.4 0 0 1 1.3.8l1.9 4.4v4.3z', 'M3.5 12.2h17', 'M7 16.5v2.5', 'M17 16.5v2.5'],
  eat: ['M6.5 3v18', 'M4 3v5a2.5 2.5 0 0 0 5 0V3', 'M17 21V3c-2.2 1.2-3.5 3.8-3.5 7v3.5H17'],
  subs: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4v4.5H15'],
  health: ['M12 5v14', 'M5 12h14'],
  book: ['M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z', 'M5 20.5A2.5 2.5 0 0 1 7.5 18H19v3H7.5'],
  misc: ['M5.5 12h.01', 'M12 12h.01', 'M18.5 12h.01'],
  tabHome: ['M20.5 12A8.5 8.5 0 1 1 12 3.5', 'M14.8 4A8.5 8.5 0 0 1 20 9.2'],
  tabTx: ['M4 6.5h16', 'M4 12h16', 'M4 17.5h10'],
  tabBud: ['M5.5 20V11', 'M12 20V4.5', 'M18.5 20v-6.5'],
  tabSet: ['M4 7h9', 'M17 7h3', 'M15 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M4 17h3', 'M11 17h9', 'M9 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  bell: ['M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  chevL: ['M14.5 5.5 8 12l6.5 6.5'],
  chevR: ['M9.5 5.5 16 12l-6.5 6.5'],
  search: ['M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13z', 'M15.5 15.5 20 20'],
  plus: ['M12 5v14', 'M5 12h14'],
  sync: ['M19.5 12a7.5 7.5 0 1 1-2.2-5.3', 'M19.5 4v4.5H15'],
};

export const CATEGORY_ICONS = ['rent', 'groc', 'car', 'eat', 'subs', 'health', 'book', 'misc'];
export const CATEGORY_COLORS = ['rent', 'groc', 'car', 'eat', 'subs', 'health', 'misc', 'x'];
export const colorVar = key => `var(--c-${key})`;

export function icon(name, color, size = 22, sw) {
  const ps = ICONS[name] || ICONS.misc;
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true',
    style: { display: 'block', flex: 'none', stroke: color || 'currentColor', strokeWidth: name === 'misc' ? 3.2 : (sw || 1.6), strokeLinecap: 'round', strokeLinejoin: 'round' },
  }, ps.map((d, i) => h('path', { key: i, d })));
}

// 12 pt status marks: state is never carried by color alone.
export function glyph(st) {
  const S = kids => h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': 'true', style: { display: 'block', flex: 'none' } }, kids);
  switch (st) {
    case 'close': return S([h('circle', { key: 1, cx: 6, cy: 6, r: 4.8, style: { fill: 'none', stroke: 'var(--close)', strokeWidth: 1.4 } }), h('path', { key: 2, d: 'M6 1.2A4.8 4.8 0 0 1 6 10.8Z', style: { fill: 'var(--close)' } })]);
    case 'over': return S([h('path', { key: 1, d: 'M6 1.3 11.2 10.6H.8Z', style: { fill: 'var(--over)' } })]);
    case 'settled': return S([h('circle', { key: 1, cx: 6, cy: 6, r: 5.6, style: { fill: 'var(--ink2)' } }), h('path', { key: 2, d: 'M3.5 6.2 5.2 7.9 8.5 4.4', style: { fill: 'none', stroke: 'var(--bg)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } })]);
    case 'due':
    case 'inbox': return S([h('circle', { key: 1, cx: 6, cy: 6, r: 4.8, style: { fill: 'none', stroke: 'var(--ink2)', strokeWidth: 1.3, strokeDasharray: '2 1.6' } })]);
    case 'ok': return S([h('circle', { key: 1, cx: 6, cy: 6, r: 2, style: { fill: 'var(--ink3)' } })]);
    case 'reached': return S([h('circle', { key: 1, cx: 6, cy: 6, r: 4.8, style: { fill: 'var(--close)' } })]);
    case 'large': return S([h('path', { key: 1, d: 'M6 1.5v8M2.8 6.5 6 9.7l3.2-3.2', style: { fill: 'none', stroke: 'var(--ink2)', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } })]);
    case 'daily': return S([h('circle', { key: 1, cx: 6, cy: 6, r: 4.6, style: { fill: 'none', stroke: 'var(--ink2)', strokeWidth: 1.5 } }), h('path', { key: 2, d: 'M6 1.4A4.6 4.6 0 0 1 10.6 6', style: { fill: 'none', stroke: 'var(--ink)', strokeWidth: 1.5 } })]);
    case 'sync': return S([h('path', { key: 1, d: 'M6 1.3 11.2 10.6H.8Z', style: { fill: 'none', stroke: 'var(--over)', strokeWidth: 1.3, strokeLinejoin: 'round' } }), h('path', { key: 2, d: 'M6 4.6v2.8M6 9h.01', style: { stroke: 'var(--over)', strokeWidth: 1.3, strokeLinecap: 'round' } })]);
    default: return null;
  }
}
