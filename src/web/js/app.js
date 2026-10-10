// PIP-PILOT 3000 — main controller: navigation, header/footer, overlays,
// notifications, settings and the boot sequence.
import { $, $$, h, fmt, local, escapeHtml } from './util.js';
import { Net } from './net.js';
import { sound } from './sound.js';
import { Mascot } from './mascot.js';
import { icon } from './icons.js';
import { StatusPage, SpecialPage, PerksPage } from './pages/stat.js';
import { SystemsPage, FuelPage, EnginesPage } from './pages/inv.js';
import { QuestPage, LandingPage, LogbookPage, ChecklistPage } from './pages/data.js';
import { MapPage } from './pages/map.js';
import { RadioPage } from './pages/radio.js';

const THEMES = {
  green: { name: 'ROBCO GREEN', rgb: '26,255,128' },
  amber: { name: 'AMBER', rgb: '255,182,66' },
  blue: { name: 'COBALT', rgb: '46,207,255' },
  white: { name: 'PHOSPHOR WHITE', rgb: '214,240,255' },
  red: { name: 'NIGHT RED', rgb: '255,82,64' },
};

class App {
  constructor() {
    this.S = { tel: null, state: null, settings: null, source: null };
    this.net = new Net();
    this.prefs = {
      theme: 'green', sound: true, volume: 0.5, crt: 2, frame: !!window.pipHost || window.innerWidth > 1100, boot: true,
      ...local.get('prefs', {}),
    };
    this.rgb = THEMES[this.prefs.theme]?.rgb || THEMES.green.rgb;
    const map = new MapPage(this);
    this.tabs = [
      { id: 'stat', label: 'STAT', subs: [['status', 'STATUS', new StatusPage(this)], ['special', 'S.P.E.C.I.A.L.', new SpecialPage(this)], ['perks', 'PERKS', new PerksPage(this)]] },
      { id: 'inv', label: 'INV', subs: [['systems', 'SYSTEMS', new SystemsPage(this)], ['fuel', 'FUEL', new FuelPage(this)], ['engines', 'ENGINES', new EnginesPage(this)]] },
      { id: 'data', label: 'DATA', subs: [['quests', 'QUESTS', new QuestPage(this)], ['landing', 'LANDING', new LandingPage(this)], ['log', 'LOGBOOK', new LogbookPage(this)], ['check', 'CHECKLISTS', new ChecklistPage(this)]] },
      { id: 'map', label: 'MAP', subs: [['local', 'LOCAL MAP', map, 'local'], ['world', 'WORLD MAP', map, 'world']] },
      { id: 'radio', label: 'RADIO', subs: [['radio', 'RADIO', new RadioPage(this)]] },
    ];
    this.tabIndex = 0;
    this.subIndex = this.tabs.map(() => 0);
    this.current = null;
  }

  // ---- setup --------------------------------------------------------------
  init() {
    this.applyPrefs();
    this._buildChrome();
    this._bindKeys();
    this._bindNet();
    window.addEventListener('resize', () => this._fit());
    this._fit();
    this.net.connect();
    // Browsers only allow audio after a gesture.
    const unlock = () => { sound.ensure(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    const lastTab = local.get('nav', null);
    if (lastTab) { this.tabIndex = lastTab.tab || 0; this.subIndex = lastTab.subs || this.subIndex; }
    if (this.prefs.boot && !sessionStorage.getItem('pip.booted')) this._boot();
    else this._enterUi();
  }

  applyPrefs() {
    const root = document.documentElement;
    this.rgb = THEMES[this.prefs.theme]?.rgb || THEMES.green.rgb;
    root.style.setProperty('--rgb', this.rgb);
    root.dataset.crt = this.prefs.crt;
    document.body.classList.toggle('framed', !!this.prefs.frame);
    document.body.classList.toggle('is-app', !!window.pipHost);
    sound.enabled = this.prefs.sound;
    sound.setVolume(this.prefs.volume);
    local.set('prefs', this.prefs);
    for (const t of this.tabs) for (const [, , page] of t.subs) if (page.map) page.map.setColors(this.rgb);
    requestAnimationFrame(() => this._fit());
  }

  _buildChrome() {
    // header tabs
    const tabsEl = $('#tabs');
    this.tabEls = this.tabs.map((t, i) => {
      const el = h('div', { class: 'tab', onclick: () => this.goTab(i) }, t.label);
      tabsEl.append(el);
      return el;
    });
    this.subsEl = $('#subs');
    this.pagesEl = $('#pages');
    // device side labels
    const side = $('#side-tabs');
    this.sideEls = this.tabs.map((t, i) => {
      const el = h('div', { class: 'side-tab', onclick: () => this.goTab(i) }, t.label);
      side.append(el);
      return el;
    });
    $('#knob').addEventListener('click', () => this.goTab((this.tabIndex + 1) % this.tabs.length));
    $('#knob').addEventListener('wheel', (e) => { e.preventDefault(); this.goTab((this.tabIndex + (e.deltaY > 0 ? 1 : this.tabs.length - 1)) % this.tabs.length); }, { passive: false });
    $('#power').addEventListener('click', () => this._powerCycle());
    $('#settings-btn').addEventListener('click', () => this.openSettings());
    $('#hdr-settings').addEventListener('click', () => this.openSettings());
    for (const b of $$('[data-win]')) b.addEventListener('click', () => window.pipHost && window.pipHost.window(b.dataset.win));
    $('#frame-toggle').addEventListener('click', () => { this.prefs.frame = !this.prefs.frame; this.applyPrefs(); });
    $('#nosignal-demo').addEventListener('click', () => { sound.select(); this.net.send('demo'); });
    $('#nosignal-settings').addEventListener('click', () => this.openSettings());
    $('#nosignal-dismiss').addEventListener('click', () => { sound.back(); this.noSignalDismissed = true; this._updateNoSignal(); });
  }

  _fit() {
    // Scale typography with the screen size so every layout is proportional.
    const scr = $('#screen');
    const hgt = scr.clientHeight, w = scr.clientWidth;
    const fs = Math.max(10, Math.min(hgt / 34, w / 52));
    scr.style.fontSize = `${fs}px`;
    if (this.current) this._placeTabGap();
  }

  // ---- navigation ---------------------------------------------------------
  goTab(i, { silent = false } = {}) {
    if (i === this.tabIndex && this.current) return;
    this.tabIndex = i;
    if (!silent) sound.tab();
    this._render(true);
  }

  goSub(j) {
    const subs = this.tabs[this.tabIndex].subs;
    j = Math.max(0, Math.min(subs.length - 1, j));
    if (j === this.subIndex[this.tabIndex]) return;
    this.subIndex[this.tabIndex] = j;
    sound.sub();
    this._render(false);
  }

  _render(tabChanged) {
    const tab = this.tabs[this.tabIndex];
    const j = this.subIndex[this.tabIndex] = Math.min(this.subIndex[this.tabIndex], tab.subs.length - 1);
    this.tabEls.forEach((el, i) => el.classList.toggle('active', i === this.tabIndex));
    this.sideEls.forEach((el, i) => el.classList.toggle('active', i === this.tabIndex));
    $('#knob-cap').style.transform = `rotate(${-60 + this.tabIndex * 30}deg)`;
    this._placeTabGap();

    // sub navigation carousel
    this.subsEl.replaceChildren(...tab.subs.map(([, label], k) => h('div', { class: `sub ${k === j ? 'active' : ''}`, onclick: () => this.goSub(k) }, label)));
    this.subsEl.classList.toggle('single', tab.subs.length < 2);
    requestAnimationFrame(() => {
      const active = this.subsEl.children[j];
      if (active) this.subsEl.style.setProperty('--sub-shift', `${-active.offsetLeft + this.subsEl.clientWidth * 0.06}px`);
    });

    const [, , page, arg] = tab.subs[j];
    if (this.current && this.current.page !== page) {
      this.current.page.hide();
      this.current.page.el.classList.remove('visible');
    }
    page.ensureBuilt();
    if (!page.el.parentNode) this.pagesEl.append(page.el);
    page.el.classList.add('visible');
    this.current = { page, arg };
    page.show(arg);
    if (this.S.tel) page.tel(this.S.tel);
    if (this.S.state && page.state) page.state(this.S.state);
    // transition animation
    this.pagesEl.classList.remove('tab-in', 'sub-in');
    void this.pagesEl.offsetWidth;
    this.pagesEl.classList.add(tabChanged ? 'tab-in' : 'sub-in');
    local.set('nav', { tab: this.tabIndex, subs: this.subIndex });
  }

  _placeTabGap() {
    const active = this.tabEls[this.tabIndex];
    if (!active) return;
    const hdr = $('#tabs');
    const l = active.offsetLeft - 6, r = active.offsetLeft + active.offsetWidth + 6;
    hdr.style.setProperty('--gap-l', `${l}px`);
    hdr.style.setProperty('--gap-r', `${r}px`);
  }

  // ---- input --------------------------------------------------------------
  _bindKeys() {
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (this.booting) { this._skipBoot(); return; }
      if (this.modal) {
        if (e.key === 'Escape') this.closeModal();
        else if (this.modal.key) this.modal.key(e);
        return;
      }
      if (this.banner && (e.key === 'Escape' || e.key === 'Enter')) { this._closeBanner(); return; }
      if (this.current && this.current.page.key(e)) { e.preventDefault(); return; }
      const k = e.key;
      if (k >= '1' && k <= '5') this.goTab(Number(k) - 1);
      else if (k === 'q' || k === 'Q') this.goTab((this.tabIndex + this.tabs.length - 1) % this.tabs.length);
      else if (k === 'e' || k === 'E' || k === 'Tab') { e.preventDefault(); this.goTab((this.tabIndex + 1) % this.tabs.length); }
      else if (k === 'a' || k === 'A' || k === 'ArrowLeft') this.goSub(this.subIndex[this.tabIndex] - 1);
      else if (k === 'd' || k === 'D' || k === 'ArrowRight') this.goSub(this.subIndex[this.tabIndex] + 1);
      else if (k === 'Escape' || k === 'F10') this.openSettings();
      else if (k === 'm' || k === 'M') { this.prefs.sound = !this.prefs.sound; this.applyPrefs(); this.toast(this.prefs.sound ? 'SOUND ON' : 'SOUND OFF'); }
      else if (k === 'F11' && window.pipHost) { e.preventDefault(); window.pipHost.window('fullscreen'); }
      else if (k === 'p' || k === 'P') { this.prefs.frame = !this.prefs.frame; this.applyPrefs(); }
      else return;
      e.preventDefault();
    });
  }

  // ---- network ------------------------------------------------------------
  _bindNet() {
    const n = this.net;
    n.on('hello', (d) => {
      this.S.settings = d.settings;
      this.S.source = d.source;
      this.S.state = d.state;
      this._onState();
      this._updateSource();
      this._forPages((p) => p.settings && p.settings());
      const mp = this.tabs[3].subs[0][2];
      if (mp.map && d.state.flight) mp.map.setTrail(d.state.flight.track || []);
    });
    n.on('tel', (t) => {
      this.S.tel = t;
      if (this.current && !this.booting) this.current.page.tel(t);
      this._footer(t);
    });
    n.on('state', (s) => { this.S.state = s; this._onState(); });
    n.on('source', (src) => {
      const was = this.S.source?.source;
      this.S.source = src;
      if (!src.source) this.S.tel = null;
      this._updateSource();
      if (src.source && src.source !== was && !this.booting) {
        this.toast(`SIGNAL ACQUIRED: ${src.label}`);
        sound.select();
      }
    });
    n.on('settings', (s) => { this.S.settings = s; this._forPages((p) => p.settings && p.settings()); if (this.modal?.refresh) this.modal.refresh(); });
    n.on('event', (e) => this._onEvent(e));
    n.on('close', () => this.toast('LINK TO COMPANION SERVER LOST — RETRYING'));
  }

  _forPages(fn) {
    const seen = new Set();
    for (const t of this.tabs) for (const [, , p] of t.subs) if (!seen.has(p) && p.built) { seen.add(p); fn(p); }
  }

  _onState() {
    const s = this.S.state;
    if (!s) return;
    if (this.current && this.current.page.state) this.current.page.state(s);
    const p = s.profile;
    $('#ft-level').textContent = `LEVEL ${p.level}`;
    const span = p.nextLevelXp - p.levelXp;
    $('#ft-xp').style.width = `${Math.max(0, Math.min(1, (p.xp - p.levelXp) / span)) * 100}%`;
  }

  _updateSource() {
    const src = this.S.source;
    const el = $('#src');
    if (src && src.source) {
      el.innerHTML = `<span class="dot on"></span>${escapeHtml(src.label)}`;
      el.classList.remove('nosig');
    } else {
      el.innerHTML = '<span class="dot"></span>NO SIGNAL';
      el.classList.add('nosig');
      $('#ft-fuel').textContent = 'FUEL ---';
      $('#ft-ap').textContent = 'AP ---';
    }
    this._updateNoSignal();
  }

  _updateNoSignal() {
    const src = this.S.source;
    const show = !this.booting && !(src && src.source) && !this.noSignalDismissed;
    $('#nosignal').classList.toggle('show', show);
    if (src) {
      const st = this.S.settings || {};
      const lines = (src.listening || []).map((n) => ({
        xplane: `X-PLANE 12 ........ UDP ${escapeHtml(st.xplaneHost || '127.0.0.1')}:${escapeHtml(String(st.xplanePort || 49000))}`,
        msfs: 'MSFS 2024 ......... SIMCONNECT',
        demo: 'DEMO SIM .......... STARTING',
      }[n] || n));
      $('#nosignal-list').innerHTML = lines.map((l) => `<div>${l} <span class="blink">LISTENING</span></div>`).join('');
    }
  }

  _footer(t) {
    const pct = t.fuelCapLb > 0 ? Math.round((t.fuelLb / t.fuelCapLb) * 100) : 0;
    $('#ft-fuel').textContent = `FUEL ${fmt.int(t.fuelLb)}/${fmt.int(t.fuelCapLb)}`;
    $('#ft-fuel').parentElement.classList.toggle('warn', pct < 15 && pct > 0);
    const ap = t.ap || {};
    $('#ft-ap').textContent = ap.master ? `AP ${fmt.int(ap.altSel)}FT ${fmt.hdg(ap.hdgSel)}` : 'AP OFF';
    $('#ft-ap').parentElement.classList.toggle('on', !!ap.master);
    // device gauges
    const vs = Math.max(-3000, Math.min(3000, t.vs || 0));
    $('#vs-needle').style.transform = `rotate(${vs / 3000 * 70}deg)`;
    const g = Math.max(0, Math.min(3, t.gForce || 1));
    $('#g-needle').style.transform = `rotate(${-70 + (g / 3) * 140}deg)`;
  }

  // ---- events / notifications ---------------------------------------------
  _onEvent(e) {
    if (this.booting) return;
    switch (e.kind) {
      case 'xp':
        this.toast(`+${e.amount} XP  ${e.reason}`, 'xp');
        break;
      case 'perk':
        this._perkBanner(e.perk);
        break;
      case 'levelup':
        setTimeout(() => this._levelBanner(e.level), 400);
        break;
      case 'landing': {
        const l = e.landing;
        const good = l.fpm < 240;
        sound.landing(good);
        this.toast(`TOUCHDOWN ${l.fpm} FPM — ${l.label}`, 'big');
        if (good) this.tabs[0].subs[0][2].built && this.tabs[0].subs[0][2].celebrate();
        break;
      }
      case 'flightEnd':
        this.toast(`FLIGHT LOGGED: ${e.flight.departure?.ident || '????'} ▸ ${e.flight.arrival?.ident || '????'}`);
        break;
      case 'takeoff':
        this.toast('QUEST UPDATED: TAKE OFF ✓');
        break;
      default:
        break;
    }
  }

  toast(text, cls = '') {
    const el = h('div', { class: `toast ${cls}` }, text);
    $('#toasts').append(el);
    setTimeout(() => el.classList.add('out'), cls === 'big' ? 5000 : 3200);
    setTimeout(() => el.remove(), cls === 'big' ? 5600 : 3800);
    if (cls === 'xp') sound.xp();
  }

  /** Big centre-screen announcements are queued so none get lost. */
  _banner(build, cls, ms = 7000) {
    this.bannerQueue = this.bannerQueue || [];
    this.bannerQueue.push({ build, cls, ms });
    if (!this.banner) this._nextBanner();
  }

  _nextBanner() {
    const next = this.bannerQueue.shift();
    if (!next) return;
    const el = h('div', { class: `banner ${next.cls}`, onclick: () => this._closeBanner() }, next.build());
    $('#overlays').append(el);
    this.banner = el;
    this.bannerTimer = setTimeout(() => this._closeBanner(), next.ms);
  }

  _closeBanner() {
    if (!this.banner) return;
    clearTimeout(this.bannerTimer);
    const el = this.banner;
    this.banner = null;
    el.classList.add('out');
    setTimeout(() => { el.remove(); this._nextBanner(); }, 400);
  }

  _perkBanner(p) {
    this._banner(() => { sound.perk(); return h('div', { class: 'banner-inner' },
      new Mascot('thumbs').el,
      h('div', { class: 'banner-text' },
        h('div', { class: 'banner-kicker' }, 'PERK UNLOCKED'),
        h('div', { class: 'banner-icon', html: icon(p.icon) }),
        h('div', { class: 'banner-title' }, p.name.toUpperCase()),
        h('div', { class: 'banner-desc' }, p.desc),
        h('div', { class: 'banner-xp' }, `+${p.xp} XP`))); }, 'perk');
  }

  _levelBanner(level) {
    this._banner(() => { sound.levelup(); return h('div', { class: 'banner-inner' }, new Mascot('cheer').el,
      h('div', { class: 'banner-text' },
        h('div', { class: 'banner-kicker' }, 'CONGRATULATIONS'),
        h('div', { class: 'banner-title huge' }, 'LEVEL UP!'),
        h('div', { class: 'banner-desc' }, `You have reached level ${level}. The skies salute you, ${this.S.state?.profile.callsign || 'pilot'}.`))); }, 'levelup', 6000);
  }

  // ---- modal: settings ----------------------------------------------------
  openModal(modal) {
    this.closeModal(true);
    this.modal = modal;
    $('#overlays').append(modal.el);
    sound.select();
  }

  closeModal(silent) {
    if (!this.modal) return;
    this.modal.el.remove();
    this.modal = null;
    if (!silent) sound.back();
  }

  openSettings() {
    const el = h('div', { class: 'modal settings' });
    const body = h('div', { class: 'modal-body' });
    const close = h('button', { class: 'pip-btn', onclick: () => this.closeModal() }, 'CLOSE [ESC]');
    el.append(h('div', { class: 'modal-title' }, '⚙ SYSTEM CONFIGURATION'), body, h('div', { class: 'modal-foot' }, close));
    const modal = { el };
    const row = (label, ...ctrl) => h('div', { class: 'set-row' }, h('div', { class: 'set-lbl' }, label), h('div', { class: 'set-ctl' }, ...ctrl));
    const choice = (opts, cur, fn) => opts.map(([v, l]) => h('button', { class: `pip-btn ${v === cur ? 'active' : ''}`, onclick: () => { sound.select(); fn(v); modal.refresh(); } }, l));
    modal.refresh = () => {
      const st = this.S.settings || {};
      const pr = this.prefs;
      const xpHost = h('input', { class: 'pip-input', value: st.xplaneHost || '127.0.0.1', size: 14 });
      const xpPort = h('input', { class: 'pip-input', value: st.xplanePort || 49000, size: 6 });
      const callsign = h('input', { class: 'pip-input', value: this.S.state?.profile.callsign || '', maxlength: 16, size: 16 });
      const stationsBox = h('div', { class: 'stations' });
      const stations = (st.stations || []).map((s) => ({ ...s }));
      const drawStations = () => {
        stationsBox.replaceChildren(...stations.map((s, i) => h('div', { class: 'station-row' },
          h('input', { class: 'pip-input', value: s.name, size: 18, oninput: (e) => { s.name = e.target.value; } }),
          h('input', { class: 'pip-input url', value: s.url, size: 34, oninput: (e) => { s.url = e.target.value; } }),
          h('button', { class: 'pip-btn', onclick: () => { stations.splice(i, 1); drawStations(); } }, '✕'))),
        h('div', { class: 'station-actions' },
          h('button', { class: 'pip-btn', onclick: () => { stations.push({ id: `st${Date.now().toString(36)}`, name: 'New Station', url: 'https://' }); drawStations(); } }, '+ ADD STATION'),
          h('button', { class: 'pip-btn', onclick: () => { this.net.send('settings', { stations }); this.toast('STATIONS SAVED'); } }, 'SAVE STATIONS')));
      };
      drawStations();
      body.replaceChildren(
        h('div', { class: 'set-section' }, 'DISPLAY'),
        row('COLOR', ...choice(Object.entries(THEMES).map(([k, t]) => [k, t.name]), pr.theme, (v) => { pr.theme = v; this.applyPrefs(); })),
        row('CRT EFFECTS', ...choice([[0, 'OFF'], [1, 'LOW'], [2, 'MEDIUM'], [3, 'HIGH']], Number(pr.crt), (v) => { pr.crt = v; this.applyPrefs(); })),
        row('DEVICE FRAME', ...choice([[true, 'WRIST UNIT'], [false, 'SCREEN ONLY']], !!pr.frame, (v) => { pr.frame = v; this.applyPrefs(); })),
        row('BOOT SEQUENCE', ...choice([[true, 'ON'], [false, 'SKIP']], !!pr.boot, (v) => { pr.boot = v; this.applyPrefs(); })),
        window.pipHost ? row('WINDOW', h('button', { class: 'pip-btn', onclick: () => window.pipHost.window('top') }, 'TOGGLE ALWAYS ON TOP'), h('button', { class: 'pip-btn', onclick: () => window.pipHost.window('fullscreen') }, 'FULLSCREEN [F11]')) : '',
        h('div', { class: 'set-section' }, 'AUDIO'),
        row('UI SOUNDS', ...choice([[true, 'ON'], [false, 'OFF']], !!pr.sound, (v) => { pr.sound = v; this.applyPrefs(); })),
        row('VOLUME', ...choice([[0.2, '20%'], [0.4, '40%'], [0.6, '60%'], [0.8, '80%'], [1, '100%']], pr.volume, (v) => { pr.volume = v; this.applyPrefs(); sound.select(); })),
        h('div', { class: 'set-section' }, 'SIMULATOR LINK'),
        row('SOURCE', ...choice([['auto', 'AUTO DETECT'], ['xplane', 'X-PLANE 12'], ['msfs', 'MSFS 2024'], ['demo', 'DEMO']], st.sim, (v) => this.net.send('settings', { sim: v }))),
        row('X-PLANE ADDRESS', xpHost, xpPort, h('button', { class: 'pip-btn', onclick: () => { this.net.send('settings', { xplaneHost: xpHost.value.trim(), xplanePort: Number(xpPort.value) || 49000 }); this.toast('X-PLANE ADDRESS SAVED'); } }, 'APPLY')),
        row('DEMO SPEED', ...choice([[1, '1×'], [2, '2×'], [4, '4×'], [8, '8×']], Number(st.demoSpeed), (v) => this.net.send('settings', { demoSpeed: v }))),
        h('div', { class: 'set-section' }, 'COMPANION DEVICES'),
        row('LAN ACCESS', ...choice([[false, 'THIS PC ONLY'], [true, 'ALLOW PHONES / TABLETS']], !!st.lanAccess, (v) => this.net.send('settings', { lanAccess: v })),
        ),
        st.lanAccess ? row('OPEN ON DEVICE', h('div', { class: 'lan-urls' }, ...(st.lanUrls || []).map((u) => h('div', {}, u)))) : '',
        h('div', { class: 'set-section' }, 'PILOT'),
        row('CALLSIGN', callsign, h('button', { class: 'pip-btn', onclick: () => { this.net.send('callsign', { name: callsign.value }); this.toast('CALLSIGN UPDATED'); } }, 'APPLY')),
        row('PROFILE', h('button', { class: 'pip-btn danger', onclick: (e) => {
          if (e.target.dataset.armed) { this.net.send('resetProfile'); this.toast('PROFILE WIPED'); e.target.textContent = 'RESET PROFILE & LOGBOOK'; delete e.target.dataset.armed; }
          else { e.target.dataset.armed = 1; e.target.textContent = 'CLICK AGAIN TO CONFIRM'; sound.warn(); }
        } }, 'RESET PROFILE & LOGBOOK')),
        h('div', { class: 'set-section' }, 'RADIO STATIONS'),
        stationsBox,
        h('div', { class: 'set-section' }, 'CONTROLS'),
        h('div', { class: 'help' },
          h('div', {}, h('b', {}, '1-5 / Q E'), ' switch tab'),
          h('div', {}, h('b', {}, 'A D / ◀ ▶'), ' switch sub-page'),
          h('div', {}, h('b', {}, 'W S / ▲ ▼'), ' move selection, ', h('b', {}, 'ENTER'), ' activate'),
          h('div', {}, h('b', {}, 'MAP'), ' drag to pan, wheel / + − zoom, C recenter, F search'),
          h('div', {}, h('b', {}, 'M'), ' mute · ', h('b', {}, 'P'), ' toggle frame · ', h('b', {}, 'ESC'), ' settings')),
      );
    };
    modal.refresh();
    this.openModal(modal);
  }

  // ---- boot sequence ------------------------------------------------------
  _boot() {
    this.booting = true;
    const boot = $('#boot');
    boot.classList.add('show');
    const term = $('#boot-term');
    term.textContent = '';
    sound.boot();
    const lines = [
      '*************** SKYTEC INDUSTRIES (TM) UNIFIED OPERATING SYSTEM ***************',
      'COPYRIGHT 2075-2077 SKYTEC INDUSTRIES · PIP-PILOT 3000 MK IV · BIOS 4.21',
      '',
      'POWER BUS ........................ STABLE',
      'MEMORY TEST 65536K ............... OK',
      'PHOSPHOR GRID .................... CALIBRATED',
      'GYRO PLATFORM .................... ALIGNED',
      'MOUNT /dev/avionics .............. OK',
      'LOAD KERNEL MODULE simlink.ko .... OK',
      '  > X-PLANE 12 RREF/UDP .......... ARMED',
      '  > MSFS 2024 SIMCONNECT ......... ARMED',
      'CARTOGRAPHIC DATABASE ............ 48,083 AIRFIELDS',
      'NATURAL EARTH VECTORS ............ LOADED',
      'PILOT PROFILE .................... FOUND',
      'PERK MATRIX ...................... ONLINE',
      'RADIO TUNER ...................... WARM',
      '',
      'INITIATING PIP-PILOT INTERFACE...',
    ];
    let i = 0;
    const step = () => {
      if (!this.booting) return;
      if (i < lines.length) {
        term.textContent += lines[i] + '\n';
        if (lines[i]) sound.type();
        i++;
        this.bootTimer = setTimeout(step, 70 + Math.random() * 70);
      } else {
        this.bootTimer = setTimeout(() => this._bootLogo(), 350);
      }
    };
    this.bootTimer = setTimeout(step, 700);
  }

  _bootLogo() {
    if (!this.booting) return;
    $('#boot-term').classList.add('gone');
    const logo = $('#boot-logo');
    const m = new Mascot('thumbs');
    logo.replaceChildren(m.el, h('div', { class: 'logo-title' }, 'PIP-PILOT 3000'), h('div', { class: 'logo-sub' }, 'PERSONAL INFORMATION PROCESSOR · FLIGHT EDITION'));
    logo.classList.add('show');
    sound.select();
    this.bootTimer = setTimeout(() => this._skipBoot(), 2200);
  }

  _skipBoot() {
    clearTimeout(this.bootTimer);
    this.booting = false;
    sessionStorage.setItem('pip.booted', '1');
    const boot = $('#boot');
    boot.classList.add('out');
    setTimeout(() => { boot.classList.remove('show', 'out'); }, 500);
    this._enterUi();
  }

  _enterUi() {
    this.booting = false;
    $('#ui').classList.add('on');
    this._render(true);
    this._updateNoSignal();
  }

  _powerCycle() {
    sound.power();
    const scr = $('#screen');
    scr.classList.add('power-off');
    setTimeout(() => {
      scr.classList.remove('power-off');
      sessionStorage.removeItem('pip.booted');
      $('#boot-term').classList.remove('gone');
      $('#boot-logo').classList.remove('show');
      this._boot();
    }, 900);
  }
}

const app = new App();
window.pip = app;
app.init();
