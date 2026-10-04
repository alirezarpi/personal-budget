import { html, Component } from '../vendor/preact-htm.js';
import { glyph } from '../lib/icons.js';

// The app's mark: a three-quarter ring on its track, as on the home-screen icon.
const Mark = () => html`
  <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true" style="display:block">
    <rect width="56" height="56" rx="13" fill="var(--ink)" />
    <circle cx="28" cy="28" r="13" fill="none" stroke="var(--bg)" stroke-opacity="0.3" stroke-width="5" />
    <path d="M28 15A13 13 0 1 1 15 28" fill="none" stroke="var(--bg)" stroke-width="5" />
  </svg>`;

export class Login extends Component {
  state = { password: '', busy: false, error: null, configured: true };

  componentDidMount() {
    fetch('/api/session').then(r => r.json()).then(s => this.setState({ configured: s.configured })).catch(() => {});
  }

  submit = async e => {
    e.preventDefault();
    if (!this.state.password || this.state.busy) return;
    this.setState({ busy: true, error: null });
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: this.state.password }) });
      if (!r.ok) {
        let detail;
        try { detail = (await r.json()).detail; } catch { /* not JSON */ }
        throw new Error(typeof detail === 'string' ? detail : `Couldn’t sign in (${r.status}).`);
      }
      this.setState({ password: '' });
      this.props.onSignedIn();
    } catch (err) {
      this.setState({ error: err.message === 'Failed to fetch' ? 'Monat can’t reach its server.' : err.message });
    }
    this.setState({ busy: false });
  };

  render(_, s) {
    return html`
    <main class="scroller" style="padding-bottom:var(--safe-bottom)">
      <form class="pad" onSubmit=${this.submit} style="min-height:100%;display:flex;flex-direction:column;justify-content:center;box-sizing:border-box;padding-top:48px;padding-bottom:48px;max-width:420px;margin:0 auto">
        <${Mark} />
        <h1 class="large-title" style="margin-top:20px">Monat</h1>
        <p class="callout" style="margin-top:2px">Sign in to see your budget.</p>

        ${s.configured ? html`
          <input type="text" name="username" value="monat" autocomplete="username" hidden readonly />
          <label class="label" for="password" style="display:block;margin-top:36px">Password</label>
          <input id="password" type="password" autocomplete="current-password" autofocus required value=${s.password}
            onInput=${e => this.setState({ password: e.target.value, error: null })}
            style="display:block;width:100%;box-sizing:border-box;height:48px;border:0;border-bottom:0.5px solid var(--line);background:transparent;font:inherit;font-size:17px;color:var(--ink);outline:none;border-radius:0;letter-spacing:0" />
          <div aria-live="polite" style="min-height:40px">
            ${s.error && html`<div style="display:flex;align-items:center;gap:6px;margin-top:10px;font-size:15px;font-weight:600;color:var(--over)">${glyph('over')}<span>${s.error}</span></div>`}
          </div>
          <button class="primary" type="submit" disabled=${!s.password || s.busy} style="margin-top:8px">
            ${s.busy ? html`<div class="spinner" style="border-color:color-mix(in srgb, var(--bg) 30%, transparent);border-top-color:var(--bg)"></div>` : 'Sign in'}
          </button>
          <p class="foot" style="margin-top:14px">You stay signed in on this device for 90 days.</p>`
        : html`
          <div style="margin-top:32px;padding:12px 0;border-top:0.5px solid var(--line);border-bottom:0.5px solid var(--line);display:grid;grid-template-columns:20px 1fr;column-gap:10px">
            <div style="padding-top:3px">${glyph('sync')}</div>
            <div><div style="font-size:15px;font-weight:600">No password set yet</div>
              <p class="foot" style="margin-top:2px">Add <span class="mono">MONAT_PASSWORD</span> to the server’s <span class="mono">.env</span>, at least 12 characters, then restart Monat.</p></div>
          </div>`}
      </form>
    </main>`;
  }
}
