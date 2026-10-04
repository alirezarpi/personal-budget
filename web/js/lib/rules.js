// Filing rules, matched exactly as the server does it (app/categorize.py), so the editor can show what
// a rule would catch before it's saved.

import { money } from './format.js';

const FOLD = { 'Ä': 'AE', 'Ö': 'OE', 'Ü': 'UE' };
export const norm = s => (s || '').toUpperCase().replace(/[ÄÖÜ]/g, c => FOLD[c]).replace(/[^A-Z0-9]+/g, ' ').trim();

export const FIELDS = [{ value: 'any', label: 'Anywhere' }, { value: 'payee', label: 'Payee' }, { value: 'purpose', label: 'Purpose' }];
export const fieldLabel = f => ({ any: 'Payee or purpose', payee: 'Payee', purpose: 'Purpose' })[f];

const cache = new WeakMap();
function texts(t) {
  let x = cache.get(t);
  if (!x) {
    const payee = norm(t.raw), purpose = norm(t.purpose);
    x = { payee: ` ${payee} `, purpose: ` ${purpose} `, any: ` ${payee} ${purpose} ` };
    cache.set(t, x);
  }
  return x;
}

// A phrase has to start a word: 'REWE' matches 'REWE CITY' but not 'BREWERY'.
export function matches(r, t) {
  const p = norm(r.pattern);
  if (!p || t.amount >= 0) return false;
  const amt = -t.amount;
  if (r.min != null && amt < r.min - 0.004) return false;
  if (r.max != null && amt > r.max + 0.004) return false;
  return texts(t)[r.field].includes(' ' + p);
}

export function amountText(r) {
  if (r.min != null && r.max != null) return `${money(r.min)}–${money(r.max)}`;
  if (r.min != null) return `${money(r.min)} or more`;
  if (r.max != null) return `up to ${money(r.max)}`;
  return '';
}

// "Payee · €20 or more"
export const ruleWhere = r => [fieldLabel(r.field), amountText(r)].filter(Boolean).join(' · ');

// What a rule catches among the payments Monat has: count, total and the most frequent merchants.
export function preview(r, txns) {
  const hits = txns.filter(t => matches(r, t));
  const by = {};
  for (const t of hits) by[t.merchant] = (by[t.merchant] || 0) + 1;
  const top = Object.keys(by).sort((a, b) => by[b] - by[a]);
  return { n: hits.length, total: hits.reduce((a, t) => a - t.amount, 0), top };
}

// "4,5" → 4.5; empty → null.
export function parseAmount(s) {
  const v = parseFloat(String(s ?? '').replace(',', '.'));
  return String(s ?? '').trim() === '' || !isFinite(v) ? null : Math.max(0, v);
}
