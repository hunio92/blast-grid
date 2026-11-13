const test = require('node:test'), assert = require('node:assert');
const { makeLink } = require('./net');

test("guest sees the host's world after start", () => {
  const link = makeLink();
  link.step(500);
  assert.strictEqual(link.guest.run('mySlot'), 1);
  assert.strictEqual(link.guest.run('started'), true);
  assert.ok(['count', 'play'].includes(link.guest.run('view.ph')));
  assert.ok(link.guestPos(1));
});

// Open the guest's bottom row (y = H-2), remove teleport holes and wait for the round to start.
function ready(opts) {
  const link = makeLink(opts);
  link.step(50);
  link.host.run(`for (let x = 1; x < W - 1; x++) { const i = idx(x, H - 2); S.grid[i] = '.'; S.hidden.delete(i); S.pu.delete(i); }
    S.portals = []; S.portalAt = new Map(); roundTime = 9999; S.time = 9999;`);
  link.step(3300);
  assert.strictEqual(link.host.run('S.phase'), 'play');
  link.step(300); // let the guest catch up
  return link;
}

test('own player moves before the host hears about it', () => {
  const link = ready();
  const x0 = link.hostPos(1)[0];
  link.press('KeyA');
  link.step(50);
  assert.ok(link.guestPos(1)[0] < x0 - 0.1, 'guest ' + link.guestPos(1)[0]);
  assert.strictEqual(link.hostPos(1)[0], x0);
});

test('ends where the host is', () => {
  const link = ready();
  link.press('KeyA'); link.step(800); link.release('KeyA'); link.step(1000);
  const g = link.guestPos(1), h = link.hostPos(1);
  assert.ok(Math.abs(g[0] - h[0]) < 0.05 && Math.abs(g[1] - h[1]) < 0.05, `guest ${g} host ${h}`);
});

test('no rubber-banding under jitter', () => {
  const link = ready({ latency: [60, 140], seed: 3 });
  const xs = [];
  link.press('KeyA');
  link.step(1000, l => xs.push(l.guestPos(1)[0]));
  for (let k = 1; k < xs.length; k++) assert.ok(xs[k] <= xs[k - 1] + 1e-9, `pulled back at frame ${k}: ${xs[k - 1]} → ${xs[k]}`);
  const half = xs.length >> 1, moved = xs[half] - xs[xs.length - 1], want = 3.2 * (xs.length - 1 - half) / 60;
  assert.ok(Math.abs(moved - want) / want < 0.1, `moved ${moved} want ${want}`);
});

test('unseen bomb correction', () => {
  const link = ready();
  const [x0, y0] = link.hostPos(1);
  link.press('KeyA');
  link.step(60); // the guest is already walking; the host hasn't got the key press yet
  link.host.run(`S.bombs.push({ x: ${x0 - 1}, y: ${y0}, fuse: 30, owner: 0, range: 1, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 });`);
  const late = [];
  link.step(1500, l => late.push(l.guestPos(1)[0]));
  assert.strictEqual(link.hostPos(1)[0], x0, 'host player is blocked');
  const g = link.guestPos(1)[0];
  assert.ok(Math.abs(g - x0) < 0.05, `guest ${g} host ${x0}`);
  assert.ok(late.slice(-30).every(x => x > x0 - 0.1), 'guest stays blocked while still holding the key');
});

test('big jumps snap', () => {
  const link = ready();
  link.host.run('S.players[1].x = 3;');
  link.step(100 + 100 + 50);
  const g = link.guestPos(1);
  assert.ok(Math.abs(g[0] - 3) < 0.05, 'guest ' + g);
});

test('no prediction when not playing', () => {
  const link = makeLink();
  link.step(500); // countdown
  const x0 = link.hostPos(1)[0];
  link.press('KeyA'); link.step(300);
  assert.strictEqual(link.guestPos(1)[0], x0, 'countdown: no movement');
  link.release('KeyA');
  link.step(3000);
  link.host.run('kill(S.players[1], 0)');
  link.step(300);
  link.press('KeyA'); link.step(300);
  assert.strictEqual(link.guestPos(1)[0], link.guest.run('view.p[mySlot][0]'), 'dead: drawn where the host says');
});

test('drop a bomb and walk off it', () => {
  const link = ready();
  const [x0] = link.hostPos(1);
  link.guest.run("keys.add('Space'); localIn[0].bombSeq++; sendGuestInput(); keys.delete('Space');");
  link.step(250); // the bomb shows up on the guest under its player
  assert.ok(link.guest.run('view.b.some(b => b[5] === mySlot)'), 'bomb placed');
  const xs = [];
  link.press('KeyA'); link.step(500, l => xs.push(l.guestPos(1)[0])); link.release('KeyA'); link.step(800);
  assert.ok(xs[xs.length - 1] < x0 - 1, 'walked off: ' + xs[xs.length - 1]);
  const g = link.guestPos(1), h = link.hostPos(1);
  assert.ok(Math.abs(g[0] - h[0]) < 0.05, `guest ${g} host ${h}`);
});

test('guest frames render with the predicted view', () => {
  const link = ready();
  link.press('KeyA');
  link.step(300, l => l.guest.run('render(__dv, 1 / 60)'));
  assert.ok(link.guest.run("__els.get('hud').innerHTML").includes('(you)'));
});

// ---- interpolation of other players / moving bombs ----
function openTopRow(link) {
  link.host.run(`for (let x = 1; x < W - 1; x++) { const i = idx(x, 1); S.grid[i] = '.'; S.hidden.delete(i); S.pu.delete(i); }`);
}

test('interpolation is monotonic under jitter', () => {
  const link = ready({ latency: [40, 160], seed: 5 });
  openTopRow(link);
  link.host.run("keys.add('KeyD')"); // the host walks its own player (slot 0) right along the top row
  const xs = [];
  link.step(2000, l => xs.push(l.guestPos(0)[0]));
  const maxStep = 3 * 3.2 / 60;
  for (let k = 1; k < xs.length; k++) {
    assert.ok(xs[k] >= xs[k - 1] - 1e-9, `went back at frame ${k}: ${xs[k - 1]} → ${xs[k]}`);
    assert.ok(xs[k] - xs[k - 1] <= maxStep, `jumped at frame ${k}: ${xs[k - 1]} → ${xs[k]}`);
  }
  assert.ok(xs[xs.length - 1] - xs[0] > 3, 'it did move');
});

test('interpolation delay adapts to jitter', () => {
  let link = ready({ latency: [100, 100] });
  link.step(1000);
  const steady = link.guest.run('interpDelay');
  link = ready({ latency: [40, 160], seed: 9 });
  link.step(1000);
  const jittery = link.guest.run('interpDelay');
  assert.ok(steady >= 40 && steady < 60, 'steady ' + steady);
  assert.ok(jittery > 100 && jittery <= 160, 'jittery ' + jittery);
});

test('sliding bomb moves smoothly', () => {
  const link = ready({ latency: [40, 160], seed: 11 });
  openTopRow(link);
  // a bomb is always placed standing still and only later kicked into a slide
  link.host.run(`S.bombs.push({ x: 2, y: 1, fuse: 30, owner: 0, range: 1, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 });
    S.players[0].x = 1; S.players[0].y = 3;`);
  link.step(400);
  link.host.run('S.bombs.find(b => b.y === 1).vx = 1;');
  const xs = [];
  link.step(1200, l => { const b = l.guest.run('__dv && __dv.b.find(b => b[5] === 0 && Math.round(b[1]) === 1)'); if (b) xs.push(b[0]); });
  assert.ok(xs.length > 30 && xs[xs.length - 1] - xs[0] > 4, 'bomb slid: ' + xs[0] + ' → ' + xs[xs.length - 1]);
  for (let k = 1; k < xs.length; k++) {
    assert.ok(xs[k] >= xs[k - 1] - 1e-9, `went back at ${k}`);
    assert.ok(xs[k] - xs[k - 1] <= 3 * 9 / 60, `jumped at ${k}: ${xs[k - 1]} → ${xs[k]}`);
  }
});
