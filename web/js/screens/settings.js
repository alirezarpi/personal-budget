import { html } from '../vendor/preact-htm.js';
import { icon, glyph } from '../lib/icons.js';
import { money, ord, parseDateTime, dayDiff, WEEKDAYS, dayMonth, relDayTime, iso } from '../lib/format.js';
import { Back, Toggle, Seg } from '../ui.js';

const PREFS = push => [
  ['approach', 'Approaching a limit', 'At each category’s alert threshold'],
  ['reached', 'Limit reached', 'When a category hits 100%'],
  ['over', 'Over a limit', 'Each time spending goes past it'],
  ['large', 'Large payments', `Single payments over ${money(push.large)}`],
  ['daily', 'Daily summary', `Every morning at ${String(push.daily_hour).padStart(2, '0')}:00`],
  ['sync', 'Sync problems', 'When ING needs a TAN or sync fails'],
];

// This device's notifications: how to get them, whether they're on, and a test.
function PushDevice({ app }) {
  const st = app.state.push, n = app.data.push.devices;
  const note = text => html`<p class="callout" style="color:var(--ink);line-height:1.4;padding:12px 0;border-bottom:0.5px solid var(--line);text-wrap:pretty">${text}</p>`;
  if (st === null) return html`<div class="kv"><span>This device</span><span>Checking…</span></div>`;
  if (st === 'install') return note('To get notifications on iPhone, add Monat to your Home Screen (Share → Add to Home Screen), open it from there and turn them on here. Needs iOS 16.4 or later.');
  if (st === 'unsupported') return note('This browser can’t receive notifications. On iPhone, open Monat from its Home Screen icon; it needs iOS 16.4 or later.');
  if (st === 'denied') return note('Notifications are blocked for Monat. Allow them in the iPhone’s Settings → Notifications → Monat, then come back here.');
  if (st === 'on') return html`
    <div class="kv"><span>This device</span><span>On${n > 1 ? ` · ${n} devices in all` : ''}</span></div>
    <button class="kv" onClick=${app.testPush}><span>Send a test notification</span><span></span></button>
    <button class="kv" onClick=${app.disablePush}><span style="color:var(--over)">Turn off on this device</span><span></span></button>`;
  return html`
    <button class="primary" onClick=${app.enablePush} disabled=${st === 'busy'}>${st === 'busy' ? 'Waiting for permission…' : 'Turn on notifications'}</button>
    <p class="foot" style="margin-top:8px">Alerts arrive after each sync with ING, so up to ${app.data.sync_minutes >= 60 ? app.data.sync_minutes / 60 + ' hours' : app.data.sync_minutes + ' minutes'} after a payment is booked.${n ? ` ${n} other ${n === 1 ? 'device gets' : 'devices get'} them already.` : ''}</p>`;
}

// every(120, 'Every') → "Every 2 hours" · every(60, 'One manual sync') → "One manual sync every hour"
const every = (min, lead) => {
  const span = min === 60 ? 'hour' : min % 60 ? `${min} minutes` : `${min / 60} hours`;
  return lead === 'Every' ? `Every ${span}` : `${lead} every ${span}`;
};

export function Settings({ app }) {
  const { model, state: s, data } = app;
  const { sync, account, prefs } = data.settings;
  const err = sync.status === 'error';
  const status = sync.paused ? 'Paused' : err ? 'Needs attention' : s.syncing ? 'Syncing' : sync.last ? 'Connected' : 'Not connected';
  const start = model.startDay;
  const cur = model.cur;
  const exports = [
    { label: `${cur.n} ${cur.end.getFullYear()}`, fmt: 'CSV', href: `/api/export.csv?start=${iso(cur.start)}&end=${iso(cur.end)}` },
    { label: 'All transactions', fmt: 'CSV', href: '/api/export.csv' },
    { label: `${model.today.getFullYear()} so far`, fmt: 'CSV', href: `/api/export.csv?start=${model.today.getFullYear()}-01-01` },
  ];

  return html`
  <div class="pad">
    <h1 class="large-title" style="margin-top:8px">Settings</h1>
    <div class="caps" style="margin-top:26px">Bank</div>
    <div style="display:flex;align-items:center;gap:12px;min-height:60px;border-bottom:0.5px solid var(--line)">
      <div style="width:28px;height:28px;border-radius:6px;background:var(--ink);color:var(--bg);font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;letter-spacing:0.2px">ING</div>
      <div style="flex:1"><div style="font-size:17px">${account ? account.name : 'No account yet'}</div><div class="label" style="margin-top:1px;letter-spacing:0.3px">${account ? account.iban : 'Appears after the first sync'}</div></div>
      <div style=${{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: 600, color: err ? 'var(--over)' : 'var(--ink2)' }}>${err && glyph('sync')}${status}</div>
    </div>
    <div class="kv"><span>Last sync</span><span>${relDayTime(sync.last, model.now)}</span></div>
    ${sync.next && !sync.paused && html`<div class="kv"><span>Next sync</span><span>${relDayTime(sync.next, model.now)}</span></div>`}
    <div class="kv"><span>Schedule</span><span>${every(data.sync_minutes, 'Every')}</span></div>
    ${err && html`<p class="callout" style="color:var(--ink);line-height:1.4;margin-top:12px;text-wrap:pretty">${sync.message || 'ING needs a TAN to keep sharing your transactions. Confirm in ING Banking, then try again here.'}</p>`}
    <button class="primary" onClick=${app.sync} disabled=${s.syncing || !!app.cooldown}>
      ${s.syncing ? html`<div class="spinner" style="border-color:color-mix(in srgb, var(--bg) 30%, transparent);border-top-color:var(--bg)"></div>` : !app.cooldown && icon('sync', 'var(--bg)', 18, 2)}
      ${s.syncing ? 'Syncing…' : app.cooldown ? `Sync again at ${app.cooldown}` : err ? 'Try again' : 'Sync now'}
    </button>
    <p class="foot" style="margin-top:8px">${every(data.cooldown_minutes, 'One manual sync')}, so ING doesn’t see a stream of logins. It also moves the next scheduled sync.</p>

    <div class="caps">Notifications</div>
    <${PushDevice} app=${app} />
    ${PREFS(data.push).map(([k, label, sub]) => html`
      <div key=${k} class="switch-row">
        <div><div class="t">${label}</div><div class="s">${sub}</div></div>
        <${Toggle} on=${prefs[k]} label=${label} onClick=${() => app.patchSettings({ prefs: { [k]: !prefs[k] } })} />
      </div>`)}

    <div class="caps">Month</div>
    <div style="padding:12px 0;border-bottom:0.5px solid var(--line)">
      <div style="font-size:17px">Month starts on</div>
      <${Seg} options=${[1, 15, 25].map(v => ({ value: v, label: ord(v) }))} value=${start} onPick=${v => app.patchSettings({ month_start: v })} />
      <p class="foot" style="margin-top:4px">${start === 1 ? 'Months run from the 1st to the last day.' : `Payday months: “October” runs from ${start} September to ${start - 1} October.`}</p>
    </div>

    <div class="caps">Export</div>
    ${exports.map(x => html`<a key=${x.label} class="kv" href=${x.href} download style="color:inherit;text-decoration:none"><span>${x.label}</span><span>${x.fmt}</span></a>`)}
    <div class="caps">Account</div>
    <button class="kv" onClick=${app.signOut}><span style="color:var(--over)">Sign out</span><span></span></button>
    <p class="foot" style="margin-top:20px">Monat · Data lives on your own server and is fetched read-only from ING.</p>
  </div>`;
}

export function Notifications({ app }) {
  const { model, data } = app;
  const groups = [];
  for (const n of data.notifications) {
    const d = parseDateTime(n.created_at), ago = dayDiff(d, model.today);
    const label = ago === 0 ? 'Today' : ago === 1 ? 'Yesterday' : `${WEEKDAYS[d.getDay()]}, ${dayMonth(d)}`;
    let g = groups[groups.length - 1];
    if (!g || g.label !== label) groups.push(g = { label, items: [] });
    g.items.push(n);
  }
  const go = target => app.openTarget(target);

  return html`
  <div>
    <${Back} label=${app.backLabel} onClick=${app.pop} />
    <div class="pad">
      <h1 class="large-title" style="margin-top:4px">Notifications</h1>
      ${groups.map(g => html`
        <div key=${g.label} style="margin-top:22px">
          <div class="group-head"><span>${g.label}</span></div>
          ${g.items.map(n => html`
            <button key=${n.id} onClick=${() => go(n.target)} disabled=${!n.target} style="display:grid;grid-template-columns:20px 1fr auto;column-gap:10px;padding:12px 0;border-bottom:0.5px solid var(--line);width:100%;cursor:${n.target ? 'pointer' : 'default'}">
              <div style="padding-top:3px">${glyph(n.kind)}</div>
              <div><div style="font-size:15px;font-weight:600">${n.title}</div><div class="callout" style="margin-top:2px;line-height:1.35;text-wrap:pretty">${n.body}</div></div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
                <span class="label">${n.created_at.slice(11, 16)}</span>
                <span style=${{ width: '8px', height: '8px', borderRadius: '4px', background: 'var(--ink)', opacity: n.read ? 0 : 1 }}></span>
              </div>
            </button>`)}
        </div>`)}
      ${!groups.length && html`
        <div style="padding-top:48px">
          <div class="dashed" style="width:44px;height:44px"></div>
          <div style="font-size:20px;font-weight:600;margin-top:16px">Nothing yet.</div>
          <p class="callout" style="margin-top:4px;line-height:1.4">Alerts about limits, large payments and sync problems collect here.</p>
        </div>`}
    </div>
  </div>`;
}
