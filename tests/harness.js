// Loads the inline <script> of blast-grid.html into a Node vm context with just enough DOM stubs to run the
// simulation headlessly. Top-level let/const of the game script are shared with code passed to run().
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

const HTML = path.join(__dirname, '..', 'blast-grid.html');

function gameScript() {
  const html = fs.readFileSync(HTML, 'utf8');
  const m = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (!m.length) throw new Error('inline <script> not found');
  return m.map(x => x[1]).join('\n');
}

function ctx2d() {
  const target = { measureText: () => ({ width: 0 }), createRadialGradient: () => ({ addColorStop() {} }), createLinearGradient: () => ({ addColorStop() {} }) };
  return new Proxy(target, {
    get: (t, k) => (k in t ? t[k] : () => {}),
    set: (t, k, v) => { t[k] = v; return true; },
  });
}

function element(tag = 'div') {
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(), value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, id: '',
    style: { setProperty() {} }, dataset: {}, children: [], width: 0, height: 0,
    classList: {
      add: (...c) => c.forEach(x => classes.add(x)), remove: (...c) => c.forEach(x => classes.delete(x)),
      toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; if (v) classes.add(c); else classes.delete(c); return v; },
      contains: c => classes.has(c),
    },
    appendChild(c) { this.children.push(c); return c; },
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }),
    getContext: () => ctx2d(), querySelector: () => element(), querySelectorAll: () => [],
    click() { if (typeof this.onclick === 'function') this.onclick({}); },
  };
  return el;
}

function loadGame(opts = {}) {
  const els = new Map();
  const byId = id => { if (!els.has(id)) { const e = element(); e.id = id; els.set(id, e); } return els.get(id); };
  const store = new Map(Object.entries(opts.store || {}));
  const listeners = {};
  const sandbox = {
    console,
    Math, JSON, Date, Map, Set, Array, Object, String, Number, Boolean, Promise, Error, Proxy, Float32Array, Int32Array, Uint8Array, Infinity, NaN,
    performance: { now: () => sandbox.__now },
    __now: 0,
    __listeners: listeners,
    __els: els,
    document: {
      querySelector: s => (s.startsWith('#') ? byId(s.slice(1)) : element()),
      getElementById: byId,
      querySelectorAll: () => [],
      createElement: t => element(t),
      documentElement: { style: { setProperty() {} } },
      body: element('body'),
      addEventListener() {},
    },
    localStorage: {
      getItem: k => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k),
    },
    __store: store,
    addEventListener: (type, fn) => { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener() {},
    requestAnimationFrame: () => 0,
    setInterval: () => 0, clearInterval() {}, setTimeout: () => 0, clearTimeout() {},
    confirm: () => true, alert() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    navigator: {},
    URL: { createObjectURL: () => '' },
    Blob: function Blob() {},
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(gameScript(), ctx, { filename: 'blast-grid.html' });
  const run = code => vm.runInContext(code, ctx);
  return { run, ctx };
}

// Set up an offline match without going through the DOM. opts: { humans = 2, bots = [], set } (extended by later tasks).
function startLocal(run, opts = {}) {
  run(`
    mode = 'local'; mySlot = 0; inputs = [];
    M = { players: [newPl('Player 1'), newPl('Player 2')], target: WIN_TARGET, id: matchId() };
    applyMapSize(); newRound(); started = true;
  `);
}

module.exports = { loadGame, startLocal };
