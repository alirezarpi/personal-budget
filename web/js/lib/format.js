// Money, words and dates. Amounts are shown in euros with English separators, as in the design.

export function fmt(v) {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const i = s.lastIndexOf('.');
  return { e: '€' + s.slice(0, i), c: s.slice(i), full: '€' + s };
}

export function money(v) {
  v = Math.abs(v);
  return Math.abs(v - Math.round(v)) < 0.005
    ? '€' + Math.round(v).toLocaleString('en-US')
    : '€' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

export function ord(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const short = name => name.slice(0, 3);

// Dates travel as 'YYYY-MM-DD' and 'YYYY-MM-DDTHH:MM' strings in local time; never through UTC.
export function parseDate(s) {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function parseDateTime(s) {
  const d = parseDate(s);
  if (s.length > 10) d.setHours(Number(s.slice(11, 13)), Number(s.slice(14, 16)));
  return d;
}
export const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const dayDiff = (a, b) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);

export const dayMon = d => `${d.getDate()} ${short(MONTHS[d.getMonth()])}`;                 // 21 Oct
export const dayMonth = d => `${d.getDate()} ${MONTHS[d.getMonth()]}`;                      // 21 October
export const wdShort = d => short(WEEKDAYS[d.getDay()]);                                     // Wed
export const wdDayMonth = d => `${WEEKDAYS[d.getDay()]}, ${dayMonth(d)}`;                    // Wednesday, 21 October

// "Today, 06:12" · "Yesterday, 06:12" · "Tomorrow, 06:00" · "Mon 19 Oct, 06:12"
export function relDayTime(s, now) {
  if (!s) return 'Never';
  const d = parseDateTime(s), diff = dayDiff(now, d), t = s.slice(11, 16);
  const day = diff === 0 ? 'Today' : diff === -1 ? 'Yesterday' : diff === 1 ? 'Tomorrow' : `${wdShort(d)} ${dayMon(d)}`;
  return t ? `${day}, ${t}` : day;
}

// For mid-sentence use: "synced with ING today, 06:12" but "on Mon 19 Oct, 06:12".
export const relLower = s => /^(Today|Yesterday|Tomorrow)/.test(s) ? s.replace(/^\w+/, w => w.toLowerCase()) : 'on ' + s;
