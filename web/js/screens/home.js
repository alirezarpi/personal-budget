import { html } from '../vendor/preact-htm.js';
import { icon, glyph } from '../lib/icons.js';
import { monthRing } from '../lib/charts.js';
import { relDayTime, relLower } from '../lib/format.js';
import { CategoryRow, Figure, InboxLink } from '../ui.js';

export function Home({ app }) {
  const { state: s, model, md } = app;
  const sync = app.data.settings.sync;
  const mi = s.month, prev = model.periods[mi - 1], next = model.periods[mi + 1];
  const syncing = s.syncing, pullH = syncing ? 58 : s.pull;
  const inboxCount = model.uncat.length;
  const lastSync = relDayTime(sync.last, model.now);
  const peek = s.dx < 0 ? (next ? next.n : '') : s.dx > 0 ? (prev ? prev.n : '') : '';
  const unread = app.data.notifications.some(n => !n.read);

  const next_ = sync.next ? relDayTime(sync.next, model.now) : '';   // "Today, 10:12" · "Tomorrow, 00:12" · "Thu 22 Oct, 06:00"
  const nextSync = !next_ || sync.paused ? '' : next_.startsWith('Today, ') ? ` Next sync at ${next_.slice(7)}.` : ` Next sync ${relLower(next_)}.`;
  const footer = md.fut ? 'Fixed costs are booked automatically on their due day.'
    : !sync.last ? 'Not synced with ING yet.'
    : sync.status === 'error' ? `Last synced with ING ${relLower(lastSync)}.`
    : `Synced with ING ${relLower(lastSync)}.${nextSync}`;

  const onRing = id => { if (s.focus === id) app.push({ t: 'cat', id }); else app.set({ focus: id }); };

  return html`
  <div class="pad" style="position:relative">
    <div aria-live="polite" style=${{ height: pullH + 'px', overflow: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: '2px', fontSize: '13px', color: 'var(--ink2)', transition: s.pulling ? 'none' : 'height .3s cubic-bezier(.2,.8,.2,1)' }}>
      <div style="display:flex;align-items:center;gap:8px;padding-bottom:6px">
        ${syncing ? html`<div class="spinner"></div>` : icon('sync', 'var(--ink)', 16, 2)}
        <span style="font-weight:600;color:var(--ink)">${syncing ? (app.cooldown ? 'Refreshing…' : 'Syncing with ING…') : s.pull >= 60 ? (app.cooldown ? 'Release to refresh' : 'Release to sync') : (app.cooldown ? 'Pull to refresh' : 'Pull to sync')}</span>
      </div>
      <div style="padding-bottom:10px">${syncing && !app.cooldown ? `Fetching payments since ${sync.last ? sync.last.slice(11, 16) : 'the start'}` : app.cooldown ? `Synced ${relLower(lastSync)} · next ING sync from ${app.cooldown}` : 'Last synced ' + relLower(lastSync)}</div>
    </div>

    <div style="display:flex;align-items:center;justify-content:space-between;height:44px">
      <div style="position:relative;display:flex;height:44px;align-items:center">
        <div style="position:absolute;left:0;right:0;top:6px;bottom:6px;border-radius:9px;background:var(--fill)"></div>
        <button disabled=${!prev} onClick=${() => app.shiftMonth(-1)} aria-label=${prev ? 'Previous month, ' + prev.n : ''} style="position:relative;height:44px;display:flex;align-items:center;padding-left:2px">
          <span style=${{ display: 'flex', alignItems: 'center', gap: '2px', padding: '0 12px 0 8px', fontSize: '15px', color: prev ? 'var(--ink2)' : 'transparent', minWidth: '30px' }}>${prev && icon('chevL', 'var(--ink2)', 14, 2.2)}${prev ? prev.s : ''}</span>
        </button>
        <div style="position:relative;height:44px;display:flex;align-items:center"><span class="month-cur" style="padding:5px 14px;font-size:15px;font-weight:600;background:var(--bg);border-radius:7px;box-shadow:var(--seg-shadow)">${md.M.n}</span></div>
        <button disabled=${!next} onClick=${() => app.shiftMonth(1)} aria-label=${next ? 'Next month, ' + next.n : ''} style="position:relative;height:44px;display:flex;align-items:center;padding-right:2px">
          <span style=${{ display: 'flex', alignItems: 'center', gap: '2px', padding: '0 8px 0 12px', fontSize: '15px', color: next ? 'var(--ink2)' : 'transparent', minWidth: '30px' }}>${next ? next.s : ''}${next && icon('chevR', 'var(--ink2)', 14, 2.2)}</span>
        </button>
      </div>
      <button onClick=${app.openNotifs} aria-label=${unread ? 'Notifications, unread' : 'Notifications'} style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;position:relative;margin-right:-10px">
        ${icon('bell', 'var(--ink)', 24, 1.7)}
        ${unread && html`<div style="position:absolute;top:10px;right:11px;width:8px;height:8px;border-radius:4px;background:var(--ink);box-shadow:0 0 0 2px var(--bg)"></div>`}
      </button>
    </div>

    ${sync.status === 'error' && html`
    <div style="margin-top:12px;padding:12px 0;border-top:0.5px solid var(--line);border-bottom:0.5px solid var(--line);display:grid;grid-template-columns:20px 1fr auto;column-gap:10px;align-items:start">
      <div style="padding-top:3px">${glyph('sync')}</div>
      <div><div style="font-size:15px;font-weight:600">Couldn’t sync with ING</div><div class="foot" style="margin-top:2px;line-height:1.35">${sync.message || 'ING is asking for a TAN.'} Numbers below are from ${relLower(lastSync).replace(/^on /, '')}.</div></div>
      ${app.cooldown
        ? html`<div class="foot" style="margin-top:2px;text-align:right">Retry<br />at ${app.cooldown}</div>`
        : html`<button onClick=${app.sync} style="height:44px;display:flex;align-items:center;margin-top:-10px;font-size:15px;font-weight:600">Try again</button>`}
    </div>`}

    <div class="month-body" style=${{ transform: `translateX(${s.dx}px)`, transition: s.dragging ? 'none' : 'transform .3s cubic-bezier(.2,.8,.2,1)' }}>
      <div style="margin-top:20px">
        <div style="display:flex;align-items:center;gap:8px;font-size:15px;color:var(--ink2)">
          <span>${md.heroLabel}</span>
          ${md.past && html`<span style="font-size:11px;font-weight:600;letter-spacing:0.6px;text-transform:uppercase;padding:2px 6px;border:0.5px solid var(--ink3);border-radius:4px">Closed</span>`}
        </div>
        <div style="margin-top:2px;line-height:1.05"><${Figure} v=${md.ts} size=${58} cents=${30} track=${-2.2} /></div>
        <div class="callout" style="margin-top:4px">${md.heroSub}</div>
      </div>

      ${md.ring.length > 0 && html`
      <div style="position:relative;width:272px;height:272px;margin:26px auto 0">
        ${monthRing(md.ring, s.focus, 272, onRing)}
        <button class="ring-center" onClick=${() => s.focus && app.set({ focus: null })} style="position:absolute;left:62px;top:62px;width:148px;height:148px;border-radius:74px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
          <div style="font-size:13px;color:var(--ink2);display:flex;align-items:center;gap:5px">${md.center.glyph}${md.center.label}</div>
          <div style="margin-top:2px"><${Figure} v=${md.center.big} size=${34} cents=${18} track=${-1} /></div>
          <div style="font-size:13px;color:var(--ink2);margin-top:1px">${md.center.sub}</div>
          <div style=${{ fontSize: '13px', fontWeight: 600, color: md.center.sub2C, marginTop: '6px' }}>${md.center.sub2}</div>
        </button>
      </div>`}

      <p class="body" style="margin-top:26px;max-width:340px">${md.summary}</p>

      ${md.cur && inboxCount > 0 && html`
        <${InboxLink} count=${inboxCount} title=${inboxCount === 1 ? '1 payment needs a category' : `${inboxCount} payments need a category`} onClick=${() => app.push({ t: 'inbox' })} style="margin-top:20px" />`}

      <div class="section" style="margin-top:32px">
        <h2>Categories</h2>
        <div class="aside">${md.fut ? 'Not started' : md.past ? 'Final' : 'Most urgent first'}</div>
      </div>
      ${md.rows.map(r => html`<${CategoryRow} key=${r.id} r=${r} />`)}
      <div class="foot" style="margin-top:16px">${footer}</div>
    </div>
    <div aria-hidden="true" style=${{ position: 'absolute', top: '300px', left: s.dx > 0 ? '20px' : 'auto', right: s.dx < 0 ? '20px' : 'auto', opacity: Math.min(Math.abs(s.dx) / 80, 1), fontSize: '15px', fontWeight: 600, color: 'var(--ink2)', pointerEvents: 'none' }}>${peek}</div>
  </div>`;
}
