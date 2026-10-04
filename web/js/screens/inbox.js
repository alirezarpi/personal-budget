import { html } from '../vendor/preact-htm.js';
import { icon } from '../lib/icons.js';
import { WEEKDAYS, dayMon } from '../lib/format.js';
import { Back, Toggle, Figure, dragX } from '../ui.js';

const shortName = m => m.replace(/^.*\*/, '');

export function Inbox({ app }) {
  const { model, state: s } = app;
  const items = model.uncat;

  return html`
  <div>
    <${Back} label=${app.backLabel} onClick=${app.pop} />
    <div class="pad">
      <h1 class="large-title" style="margin-top:4px">Uncategorized</h1>
      <p class="callout" style="margin-top:4px;line-height:1.4;text-wrap:pretty">Swipe right to accept the suggestion, or tap a category. Monat adds a rule, so the merchant files itself next time.</p>
    </div>
    <div style="margin-top:18px;border-top:0.5px solid var(--line)">
      ${items.map(t => {
        const sugg = (t.suggest.length ? t.suggest : [model.cats[0]?.id]).map(id => model.cats.find(c => c.id === id)).filter(Boolean);
        const top = sugg[0];
        if (!top) return null;
        const ex = s.expanded[t.id];
        const dx = s.swipe && s.swipe.id === t.id ? s.swipe.dx : 0;
        const chipCats = ex ? model.cats : sugg;
        const rem = s.remember[t.id] !== false && !!t.learn;
        const drag = dragX(app.gest, 'inbox', {
          onMove: d => app.set({ swipe: { id: t.id, dx: Math.max(0, Math.min(d, 220)) } }),
          onEnd: () => { if ((app.state.swipe?.dx || 0) > 100) app.assign(t.id, top.id); else app.set({ swipe: null }); },
        });
        return html`
        <div key=${t.id} style="position:relative;overflow:hidden;border-bottom:0.5px solid var(--line)">
          <div aria-hidden="true" style="position:absolute;inset:0;background:var(--fill);display:flex;align-items:center;gap:10px;padding-left:20px;font-size:15px;font-weight:600">
            ${icon(top.icon, top.colorVar, 22)}<span>${dx > 100 ? `Release to file under ${top.name}` : top.name}</span>
          </div>
          <div ...${drag} style=${{ position: 'relative', background: 'var(--bg)', padding: '14px 20px 8px', transform: `translateX(${dx}px)`, transition: app.gest.inbox ? 'none' : 'transform .3s cubic-bezier(.2,.8,.2,1)', touchAction: 'pan-y' }}>
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px">
              <div style="font-size:17px;font-weight:600">${t.merchant}</div>
              <div style="font-size:17px;font-weight:600"><${Figure} v=${t.amt} size=${17} cents=${13} /></div>
            </div>
            <div class="label" style="margin-top:2px">${WEEKDAYS[t.d.getDay()]}, ${dayMon(t.d)}${t.time ? ' · ' + t.time : ''}${t.method ? ' · ' + t.method : ''}</div>
            <div class="mono" style="font-size:11px;color:var(--ink2);margin-top:6px;line-height:1.45;overflow-wrap:anywhere">${t.purpose}</div>
            <div style="display:flex;flex-wrap:wrap;column-gap:6px;margin-top:4px">
              ${chipCats.map((c, i) => {
                const lead = i === 0 && !ex;
                return html`<button key=${c.id} class="chip" onClick=${() => app.assign(t.id, c.id)}>
                  <span style=${{ padding: '0 12px 0 8px', boxShadow: `inset 0 0 0 ${lead ? '1.5px' : '0.5px'} ${lead ? c.colorVar : 'var(--line)'}` }}>${icon(c.icon, c.colorVar, 18)}${c.name}</span>
                </button>`;
              })}
              ${!ex && html`<button class="chip" onClick=${() => app.set({ expanded: { ...s.expanded, [t.id]: true } })}><span>Other…</span></button>`}
            </div>
            ${t.learn && html`
            <div style="display:flex;align-items:center;justify-content:space-between;min-height:44px;border-top:0.5px solid var(--line);margin-top:4px">
              <div class="label">Always file ${shortName(t.merchant)} this way</div>
              <${Toggle} on=${rem} label=${`Always file ${shortName(t.merchant)} this way`} onClick=${() => app.set({ remember: { ...s.remember, [t.id]: !rem } })} />
            </div>`}
          </div>
        </div>`;
      })}
    </div>
    ${!items.length && html`
      <div style="padding:64px 20px 0">
        <div class="dashed" style="width:44px;height:44px"></div>
        <div style="font-size:20px;font-weight:600;margin-top:16px">Nothing to sort.</div>
        <p class="callout" style="margin-top:4px;line-height:1.4">New payments arrive with the next sync.</p>
      </div>`}
  </div>`;
}

export { shortName };
