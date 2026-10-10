// WebSocket client with automatic reconnect.

export class Net {
  constructor() {
    this.handlers = new Map();
    this.ws = null;
    this.backoff = 500;
    this.open = false;
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(fn);
  }

  emit(type, data) {
    for (const fn of this.handlers.get(type) || []) {
      try { fn(data); } catch (e) { console.error(type, e); }
    }
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.open = true;
      this.backoff = 500;
      this.emit('open');
    };
    ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      this.emit(msg.t, msg.d);
    };
    ws.onclose = () => {
      if (this.open) this.emit('close');
      this.open = false;
      setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(5000, this.backoff * 1.6);
    };
    ws.onerror = () => ws.close();
  }

  send(t, d) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify({ t, d }));
  }
}
