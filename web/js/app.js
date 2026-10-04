import { html, render, Component } from './vendor/preact-htm.js';
import { buildModel, monthData } from './lib/budget.js';
import { icon } from './lib/icons.js';
import { Home } from './screens/home.js';
import { Category } from './screens/category.js';
import { Transactions } from './screens/transactions.js';
import { Inbox, shortName } from './screens/inbox.js';
import { Txn } from './screens/txn.js';
import { Budgets, Edit, blankDraft, draftFor } from './screens/budgets.js';
import { parseAmount } from './lib/rules.js';
import { Settings, Notifications } from './screens/settings.js';
import { Login } from './screens/login.js';

const TABS = [['home', 'Overview', 'tabHome'], ['tx', 'Transactions', 'tabTx'], ['budgets', 'Budgets', 'tabBud'], ['settings', 'Settings', 'tabSet']];
const CACHE_KEY = 'monat:state';

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (!r.ok) {
    let msg;
    try { msg = (await r.json()).detail; } catch { /* not JSON */ }
    throw Object.assign(new Error(typeof msg === 'string' ? msg : `Something went wrong (${r.status}).`), { auth: r.status === 401 });
  }
  return r.json();
}

const remember = data => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch { /* storage unavailable */ } };
const recall = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; } };
const forget = () => { try { localStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable */ } };

class App extends Component {
  state = {
    data: null, bootError: null,
    tab: 'home', stack: [], month: null, focus: null,
    q: '', filter: 'all', swipe: null, expanded: {}, remember: {}, notes: {},
    toast: null, pull: 0, pulling: false, dx: 0, dragging: false, syncing: false,
    draft: null, picker: false, saving: false, confirmDelete: false,
  };
  gest = {};       // in-flight gesture state, kept off React state so re-renders don't reset it
  scrolls = [];    // scroll offsets of the screens under the current one
  noteTimers = {};

  componentDidMount() {
    this.load();
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && this.state.data) this.load(true); });
    // The server syncs on its own schedule; pick up what it found while the app stays open.
    setInterval(() => { if (document.visibilityState === 'visible' && this.state.data && !this.state.syncing) this.load(true); }, 5 * 60 * 1000);
  }

  async load(quiet) {
    try {
      this.setData(await api('GET', '/api/state'));
    } catch (e) {
      if (e.auth) return this.signedOut();
      if (quiet) return;
      const cached = recall();
      if (cached) { this.setData(cached); this.toast('Offline. Showing what Monat had at the last visit.'); }
      else this.setState({ bootError: 'Monat can’t reach its server. Check that it’s running and that this device can reach it.' });
    }
  }

  setData(data) {
    this.fetchedAt = Date.now();
    this.setState({ data });
    remember(data);
    // Re-render when the sync button's cooldown runs out.
    clearTimeout(this.cooldownTimer);
    const wait = this.syncWait();
    if (wait) this.cooldownTimer = setTimeout(() => this.forceUpdate(), wait + 500);
  }

  // Milliseconds until the sync button may contact ING again (the server enforces this too).
  syncWait() {
    const secs = this.state.data?.settings.sync.manual_wait || 0;
    return Math.max(0, secs * 1000 - (Date.now() - (this.fetchedAt || 0)));
  }

  // ── Navigation ────────────────────────────────────────────────────────────
  set = o => this.setState(o);
  top() { if (this.scrollEl) this.scrollEl.scrollTop = 0; }
  go = tab => { this.scrolls = []; this.top(); this.setState({ tab, stack: [], focus: null, picker: false, confirmDelete: false }); };
  push = e => {
    this.scrolls.push(this.scrollEl ? this.scrollEl.scrollTop : 0);
    const data = this.state.data;
    const draft = e.t === 'edit' ? (e.id === 'new' ? blankDraft() : draftFor(data.categories.find(c => c.id === e.id), data)) : this.state.draft;
    this.setState(s => ({ stack: [...s.stack, e], picker: false, confirmDelete: false, draft }), () => this.top());
  };
  pop = () => {
    const y = this.scrolls.pop() || 0;
    this.setState(s => ({ stack: s.stack.slice(0, -1), picker: false, confirmDelete: false }), () => { if (this.scrollEl) this.scrollEl.scrollTop = y; });
  };
  shiftMonth = d => this.setState(s => {
    const max = this.model.periods.length - 1;
    return { month: Math.max(0, Math.min(max, (s.month ?? this.model.CUR) + d)), focus: null };
  });
  isHome() { return this.state.tab === 'home' && !this.state.stack.length; }

  toast(text, undo) {
    clearTimeout(this.toastTimer);
    this.setState({ toast: { text, undo: undo || null } });
    this.toastTimer = setTimeout(() => this.setState({ toast: null }), 4200);
  }
  fail = e => { if (e.auth) return this.signedOut(); this.toast(e.message); this.load(true); };

  // ── Session ───────────────────────────────────────────────────────────────
  // Drop everything on screen and in storage; the login page takes over.
  signedOut = () => {
    forget();
    clearTimeout(this.toastTimer);
    this.scrolls = [];
    this.modelFor = null;
    this.setState({ data: null, signedOut: true, tab: 'home', stack: [], month: null, focus: null, toast: null, notes: {}, q: '', filter: 'all' });
  };
  signIn = () => { this.setState({ signedOut: false }); this.load(); };
  signOut = async () => {
    try { await fetch('/api/logout', { method: 'POST' }); } catch { /* signed out locally either way */ }
    this.signedOut();
  };

  // ── Actions ───────────────────────────────────────────────────────────────
  // Change local data immediately, then let the server's answer replace it.
  optimistic(mutate) {
    const data = structuredClone(this.state.data);
    mutate(data);
    this.setState({ data });
  }

  assign = (id, cat) => {
    const t = this.state.data.transactions.find(x => x.id === id);
    const c = this.state.data.categories.find(x => x.id === cat);
    const rem = this.state.remember[id] !== false && !!t.learn;
    this.optimistic(d => { d.transactions.find(x => x.id === id).cat = cat; });
    this.setState({ swipe: null });
    api('PATCH', `/api/transactions/${id}`, { category: cat, set_category: true, remember: rem }).then(data => this.setData(data), this.fail);
    this.toast(`${shortName(t.merchant)} filed under ${c.name}.${rem ? ' Next time it sorts itself.' : ''}`, () => {
      this.optimistic(d => { d.transactions.find(x => x.id === id).cat = null; });
      api('PATCH', `/api/transactions/${id}`, { category: null, set_category: true, remember: rem ? false : undefined }).then(data => this.setData(data), this.fail);
    });
  };

  setCategory = (id, cat) => {
    this.optimistic(d => { d.transactions.find(x => x.id === id).cat = cat; });
    this.setState({ picker: false });
    api('PATCH', `/api/transactions/${id}`, { category: cat, set_category: true }).then(data => this.setData(data), this.fail);
  };

  learn = (id, on) => {
    this.optimistic(d => { d.transactions.find(x => x.id === id).learned = on; });
    api('PATCH', `/api/transactions/${id}`, { remember: on }).then(data => { this.setData(data); if (data.message) this.toast(data.message); }, this.fail);
  };

  editNote = (id, value) => {
    this.setState(s => ({ notes: { ...s.notes, [id]: value } }));
    clearTimeout(this.noteTimers[id]);
    this.noteTimers[id] = setTimeout(() => this.flushNote(id), 700);
  };
  flushNote = id => {
    clearTimeout(this.noteTimers[id]);
    const note = this.state.notes[id];
    if (note === undefined) return;
    api('PATCH', `/api/transactions/${id}`, { note }).then(data => this.setData(data), this.fail);
  };

  saveDraft = async () => {
    const d = this.state.draft;
    const name = d.name.trim() || 'Untitled';
    const rules = d.rules.filter(r => r.pattern.trim()).map(r => ({ id: r.id || null, field: r.field, pattern: r.pattern.trim(), min: parseAmount(r.min), max: parseAmount(r.max) }));
    const body = { name, limit: d.limit, thr: d.fixed ? 100 : d.thr, fixed: d.fixed, due: d.due, color: d.color, icon: d.icon, carry: d.carry, rules, catch_all: d.catchAll };
    this.setState({ saving: true });
    try {
      const data = d.id === 'new' ? await api('POST', '/api/categories', body) : await api('PUT', `/api/categories/${d.id}`, body);
      this.setData(data);
      this.pop();
      this.toast(data.message || `${name} saved.`);
    } catch (e) { this.toast(e.message); }
    this.setState({ saving: false });
  };

  deleteDraft = async () => {
    const d = this.state.draft;
    if (!this.state.confirmDelete) {
      this.setState({ confirmDelete: true });
      clearTimeout(this.confirmTimer);
      this.confirmTimer = setTimeout(() => this.setState({ confirmDelete: false }), 4000);
      return;
    }
    try {
      this.setData(await api('DELETE', `/api/categories/${d.id}`));
      this.scrolls = [];
      this.setState(s => ({ stack: s.stack.filter(e => e.id !== d.id), confirmDelete: false, focus: null }), () => this.top());
      this.toast(`${d.name} deleted.`);
    } catch (e) { this.toast(e.message); }
  };

  patchSettings = body => {
    this.optimistic(d => {
      if (body.month_start) d.settings.month_start = body.month_start;
      if (body.prefs) Object.assign(d.settings.prefs, body.prefs);
    });
    if (body.month_start) this.setState({ month: null, focus: null });
    api('PATCH', '/api/settings', body).then(data => this.setData(data), this.fail);
  };

  // Ask ING for new payments. Inside the cooldown this only refreshes from Monat's own server.
  sync = async () => {
    if (this.state.syncing) return;
    const cooling = this.syncWait() > 0;
    this.setState(s => ({ syncing: true, pull: s.pull ? 58 : 0 }));
    try {
      // Hold the spinner briefly so a fast answer still reads as "checked".
      const [data] = await Promise.all([api(cooling ? 'GET' : 'POST', cooling ? '/api/state' : '/api/sync'), new Promise(r => setTimeout(r, 700))]);
      this.setData(data);
      this.toast(cooling ? `Up to date. You can sync with ING again at ${this.syncAgainAt()}.` : data.message || 'Synced with ING.');
    } catch (e) { if (e.auth) return this.signedOut(); this.toast(e.message); }
    this.setState({ syncing: false, pull: 0 });
  };

  // "11:41", in the server's clock (which is what the demo pins).
  syncAgainAt() {
    const t = new Date(this.model.now.getTime() + (this.state.data.settings.sync.manual_wait || 0) * 1000);
    return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  }

  openNotifs = () => {
    this.push({ t: 'notifs' });
    if (this.state.data.notifications.some(n => !n.read)) {
      setTimeout(() => api('POST', '/api/notifications/read').then(data => this.setData(data), () => {}), 1500);
    }
  };

  // ── Overview gestures: sideways swipes between months, pull down to sync ──
  setScroll = el => {
    if (!el || el === this.scrollEl) return;
    this.scrollEl = el;
    el.addEventListener('touchstart', e => this.gStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    el.addEventListener('touchmove', e => this.gMove(e.touches[0].clientX, e.touches[0].clientY, e), { passive: false });
    el.addEventListener('touchend', () => this.gEnd());
    el.addEventListener('touchcancel', () => this.gEnd());
    el.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' && e.button === 0) this.gStart(e.clientX, e.clientY); });
    el.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') this.gMove(e.clientX, e.clientY, e); });
    el.addEventListener('pointerup', e => { if (e.pointerType === 'mouse') this.gEnd(); });
    el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') this.gEnd(); });
  };
  gStart(x, y) { this.g = this.isHome() ? { x, y, mode: null, top: this.scrollEl.scrollTop } : null; }
  gMove(x, y, e) {
    const g = this.g;
    if (!g) return;
    const dx = x - g.x, dy = y - g.y;
    const atTop = g.top <= 0 && this.scrollEl.scrollTop <= 0;
    if (!g.mode) {
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) g.mode = 'x';
      else if (dy > 8 && atTop && !this.state.syncing) g.mode = 'y';
      else if (Math.abs(dy) > 8) g.mode = 'n';
      // Claim the gesture before iOS starts its own bounce, or it can't be cancelled later.
      else if (e.cancelable && ((atTop && dy > 0 && dy >= Math.abs(dx)) || Math.abs(dx) > Math.abs(dy))) e.preventDefault();
    }
    if (g.mode === 'x') { if (e.cancelable) e.preventDefault(); this.setState({ dx, dragging: true }); }
    if (g.mode === 'y') { if (e.cancelable) e.preventDefault(); this.setState({ pull: Math.max(0, Math.min(100, dy * 0.5)), pulling: true }); }
  }
  gEnd() {
    const g = this.g;
    this.g = null;
    if (!g) return;
    if (g.mode === 'x') {
      const dx = this.state.dx;
      if (dx < -70) this.shiftMonth(1); else if (dx > 70) this.shiftMonth(-1);
      this.setState({ dx: 0, dragging: false });
    }
    if (g.mode === 'y') {
      this.setState({ pulling: false });
      if (this.state.pull >= 60) this.sync(); else this.setState({ pull: 0 });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  render(_, s) {
    if (s.signedOut) return html`<${Login} onSignedIn=${this.signIn} />`;
    if (!s.data) return html`<div class="boot" role="status">${s.bootError || ''}</div>`;
    if (this.modelFor !== s.data) { this.model = buildModel(s.data); this.modelFor = s.data; }
    const model = this.model;
    const month = Math.max(0, Math.min(model.periods.length - 1, s.month ?? model.CUR));
    const openCat = id => this.push({ t: 'cat', id });
    const md = monthData(model, month, s.focus, openCat);
    const view = s.stack.length ? s.stack[s.stack.length - 1] : { t: s.tab };
    const prev = s.stack.length > 1 ? s.stack[s.stack.length - 2] : null;
    const backLabel = prev
      ? ({ cat: model.cats.find(c => c.id === prev.id)?.name, inbox: 'Uncategorized', notifs: 'Notifications', txn: 'Back' })[prev.t] || 'Back'
      : ({ home: 'Overview', tx: 'Transactions', budgets: 'Budgets', settings: 'Settings' })[s.tab];
    const cooldown = this.syncWait() > 0 ? this.syncAgainAt() : null;   // "11:41" while the sync button rests
    const app = { state: { ...s, month }, data: s.data, model, md, backLabel, gest: this.gest, cooldown,
      set: this.set, go: this.go, push: this.push, pop: this.pop, shiftMonth: this.shiftMonth, sync: this.sync, openNotifs: this.openNotifs,
      assign: this.assign, setCategory: this.setCategory, learn: this.learn, editNote: this.editNote, flushNote: this.flushNote,
      saveDraft: this.saveDraft, deleteDraft: this.deleteDraft, patchSettings: this.patchSettings, signOut: this.signOut };

    const screen = {
      home: () => html`<${Home} app=${app} />`,
      cat: () => html`<${Category} app=${app} id=${view.id} />`,
      tx: () => html`<${Transactions} app=${app} />`,
      inbox: () => html`<${Inbox} app=${app} />`,
      txn: () => html`<${Txn} app=${app} id=${view.id} />`,
      budgets: () => html`<${Budgets} app=${app} />`,
      edit: () => html`<${Edit} app=${app} />`,
      notifs: () => html`<${Notifications} app=${app} />`,
      settings: () => html`<${Settings} app=${app} />`,
    }[view.t];

    const inboxCount = model.uncat.length, syncErr = s.data.settings.sync.status === 'error';
    return html`
      <main class="scroller" ref=${this.setScroll}>${screen()}</main>
      ${s.toast && html`
        <div class="toast" role="status">
          <span>${s.toast.text}</span>
          ${s.toast.undo && html`<button onClick=${() => { const u = s.toast.undo; this.setState({ toast: null }); u(); }}>Undo</button>`}
        </div>`}
      <nav class="tabbar">
        ${TABS.map(([id, label, ic]) => {
          const badge = id === 'tx' && inboxCount ? inboxCount : id === 'settings' && syncErr ? '!' : 0;
          return html`<button key=${id} aria-current=${s.tab === id ? 'page' : undefined} onClick=${() => this.go(id)}>
            ${icon(ic, 'currentColor', 25, 1.8)}<span class="tl">${label}</span>
            ${badge ? html`<span class="badge" aria-label=${id === 'tx' ? `${badge} uncategorized` : 'needs attention'}>${badge}</span>` : null}
          </button>`;
        })}
      </nav>`;
  }
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
