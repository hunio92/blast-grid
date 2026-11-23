// The host replays a guest's key changes with the guest's own timing (see replayEntry), so network jitter can't change
// how far the guest walked or where its bomb lands.
const test = require('node:test'), assert = require('node:assert');
const { makeLink } = require('./net');

const tickGuest = l => l.guest.run('simStep()'); // the guest's 60 Hz timer: resends its keys every 100 ms

function ready(opts) {
  const link = makeLink(Object.assign({ hostMs: 16 }, opts));
  link.step(50);
  link.host.run(`for (let x = 1; x < W - 1; x++) { const i = idx(x, H - 2); S.grid[i] = '.'; S.hidden.delete(i); S.pu.delete(i); }
    S.portals = []; S.portalAt = new Map(); roundTime = 9999; S.time = 9999;`);
  link.step(3600, tickGuest);
  return link;
}

test('stopping under network jitter does not slide you back or forward', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const link = ready({ seed, latency: [30, 150] });
    link.press('KeyA'); link.step(300 + seed * 53, tickGuest); link.release('KeyA');
    link.step(50, tickGuest); // the screen finishes the last 1/60 s of the walk you really made
    const xs = [];
    link.step(1500, l => { tickGuest(l); xs.push(l.guestPos(1)[0]); });
    const lo = Math.min(...xs), hi = Math.max(...xs);
    assert.ok(hi - lo < 0.03, `seed ${seed}: shown x moved ${(hi - lo).toFixed(3)} tiles after stopping`);
    assert.ok(Math.abs(xs[xs.length - 1] - link.hostPos(1)[0]) < 0.07, `seed ${seed}: guest and host agree`);
  }
});

test('a bomb lands on the tile you were on when you pressed', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const link = ready({ seed, latency: [30, 150] });
    link.press('KeyA'); link.step(200 + seed * 61, tickGuest);
    const at = link.guest.run('Math.round(PRED.x)');
    link.guest.run("localIn[0].bombSeq++; sendGuestInput();");
    link.step(16, tickGuest);
    assert.ok(link.guest.run(`__dv.b.some(b => b[5] === 1 && Math.round(b[0]) === ${at})`), `seed ${seed}: shown at once`);
    link.step(700, tickGuest);
    const hostAt = link.host.run('JSON.stringify(S.bombs.filter(b => b.owner === 1).map(b => b.x))');
    assert.deepStrictEqual(JSON.parse(hostAt), [at], `seed ${seed}: host bomb tile`);
  }
});

// Pressing just as you cross the middle between two tiles: the guest shows the bomb at its last frame's position, the
// host would place it at the end of its game step — a frame or two apart, which can round to different tiles.
test('a bomb pressed while crossing between two tiles lands where the guest showed it', () => {
  for (const frameMs of [1000 / 60, 1000 / 144]) for (let seed = 1; seed <= 8; seed++) {
    const link = ready({ seed, latency: [70, 110], frameMs });
    const key = seed % 2 ? 'KeyD' : 'KeyA', dir = seed % 2 ? 1 : -1;
    link.host.run('S.players[1].x = Math.round(W / 2)'); link.step(300, tickGuest);
    link.press(key);
    // walk until the next frame would carry us past the middle of the tile
    for (let n = 0; n < 200; n++) {
      link.step(frameMs, tickGuest);
      const f = link.guest.run('PRED.x') * dir + 100, frac = f - Math.floor(f);
      if (frac > 0.42 && frac < 0.5) break;
    }
    const shown = link.guest.run('Math.round(PRED.x)');
    link.guest.run('localIn[0].bombSeq++; sendGuestInput();');
    link.step(frameMs, tickGuest);
    assert.ok(link.guest.run(`__dv.b.some(b => b[5] === 1 && Math.round(b[0]) === ${shown})`), `seed ${seed}: shown at once`);
    link.step(500, tickGuest);
    const hostAt = JSON.parse(link.host.run('JSON.stringify(S.bombs.filter(b => b.owner === 1).map(b => b.x))'));
    assert.deepStrictEqual(hostAt, [shown], `${Math.round(1000 / frameMs)} Hz seed ${seed}: host bomb tile`);
  }
});

test('a lost key-up message does not leave you walking', () => {
  const link = ready({ seed: 3, latency: [40, 60] });
  const toH = link.guest.ctx.__sendToHost;
  link.press('KeyA'); link.step(400, tickGuest);
  let dropped = 0;
  link.guest.ctx.__sendToHost = m => { if (m.t === 'in' && !dropped) { dropped++; return; } toH(m); };
  link.release('KeyA');
  link.step(1200, tickGuest);
  assert.strictEqual(dropped, 1);
  assert.ok(Math.abs(link.guestPos(1)[0] - link.hostPos(1)[0]) < 0.07, `guest ${link.guestPos(1)} host ${link.hostPos(1)}`);
});

test('a predicted bomb the host refuses goes away', () => {
  const link = ready({ seed: 2, latency: [50, 50] });
  link.host.run('S.players[1].curse = "nobomb"; S.players[1].curseT = 99;'); // host says no; guest learns it late
  link.guest.run("localIn[0].bombSeq++; sendGuestInput();");
  link.step(1500, tickGuest);
  assert.strictEqual(link.guest.run('__dv.b.filter(b => b[5] === 1).length'), 0);
  assert.strictEqual(link.host.run('S.bombs.length'), 0);
});

test('bombs dropped while walking never blink out and back', () => {
  const link = ready({ seed: 1, latency: [30, 150] });
  link.host.run('S.players[1].maxBombs = 5; S.players[1].hp = 99; S.players[1].inv = 99;');
  link.press('KeyA');
  const first = new Map(), gone = new Set(); let t = 0, blinks = 0;
  link.step(2000, l => {
    tickGuest(l); t += 1000 / 60;
    if (Math.floor(t / 300) !== Math.floor((t - 1000 / 60) / 300)) l.guest.run('localIn[0].bombSeq++; sendGuestInput();');
    const shown = new Set(JSON.parse(l.guest.run("JSON.stringify(__dv.b.filter(b => b[5] === 1).map(b => Math.round(b[0]) + ',' + Math.round(b[1])))")));
    for (const k of shown) { if (!first.has(k)) first.set(k, t); if (gone.has(k)) { blinks++; gone.delete(k); } }
    for (const [k, t0] of first) if (!shown.has(k) && t - t0 < 2000) gone.add(k); // before its fuse is up
  });
  assert.ok(first.size >= 4, 'placed ' + first.size);
  assert.strictEqual(blinks, 0);
});

test("someone else's bomb doesn't show before their character gets there", () => {
  for (let seed = 1; seed <= 6; seed++) {
    const link = ready({ seed, latency: [30, 150] });
    // the host (slot 0) walks right along the top row, dropping a bomb now and then
    link.host.run(`for (let x = 1; x < W - 1; x++) { const i = idx(x, 1); S.grid[i] = '.'; S.hidden.delete(i); S.pu.delete(i); }
      S.players[0].maxBombs = 5; S.players[0].hp = 99; S.players[0].inv = 99; keys.add(KEYMAP.a.right[0]);`);
    let t = 0, worst = 0;
    link.step(2000, l => {
      tickGuest(l); t += 1000 / 60;
      if (Math.floor(t / 350) !== Math.floor((t - 1000 / 60) / 350)) l.host.run('localIn[0].bombSeq++;');
      const r = JSON.parse(l.guest.run('JSON.stringify(__dv ? [__dv.p[0][0], __dv.b.filter(b => b[5] === 0).map(b => b[0])] : null)'));
      if (!r) return;
      for (const bx of r[1]) worst = Math.max(worst, bx - r[0]); // bomb ahead of where its owner is drawn
    });
    link.host.run('keys.clear()');
    assert.ok(worst < 0.62, `seed ${seed}: a bomb showed ${worst.toFixed(2)} tiles ahead of its owner`);
  }
});

// time (ms on the shared clock) at which the bomb on tile x of `slot` goes off: on the host's board / on the guest's screen
function bombTimes(link, x) {
  let hostT = null, guestT = null, hadHost = false; const fuses = [];
  link.step(3500, l => {
    tickGuest(l);
    const onHost = l.host.run(`S.bombs.some(b => b.owner === 1 && b.x === ${x})`);
    if (onHost) hadHost = true; else if (hadHost && hostT === null) hostT = l.now();
    const g = JSON.parse(l.guest.run(`JSON.stringify((__dv.b.find(b => b[5] === 1 && Math.round(b[0]) === ${x}) || [])[2] ?? null)`));
    if (g !== null) fuses.push(g);
    if (guestT === null && l.guest.run(`(view.f || []).some(f => f[0] % W === ${x})`)) guestT = l.now();
  });
  return { hostT, guestT, fuses };
}

test('a guest bomb goes off fuse-time after the key press on both screens', () => {
  for (const [seed, lo, hi] of [[1, 50, 50], [2, 30, 90], [3, 20, 40]]) {
    const link = ready({ seed, latency: [lo, hi] });
    link.host.run(`GUEST.ping = ${lo + hi}`); // the round trip the host measures (its ping timer doesn't run here)
    link.press('KeyA'); link.step(250, tickGuest); link.release('KeyA'); link.step(100, tickGuest);
    const x = link.guest.run('Math.round(PRED.x)');
    link.guest.run('localIn[0].bombSeq++; sendGuestInput();');
    const P = link.now();
    link.press('KeyD'); link.step(300, tickGuest); link.release('KeyD'); // get out of the way
    const { hostT, guestT } = bombTimes(link, x);
    assert.ok(hostT !== null && guestT !== null, `seed ${seed}: exploded`);
    const want = P + 2400;
    assert.ok(Math.abs(hostT - want) < 45, `seed ${seed}: host off by ${(hostT - want).toFixed(0)} ms`);
    assert.ok(guestT - want < hi + 45 && guestT >= want - 20, `seed ${seed}: guest screen off by ${(guestT - want).toFixed(0)} ms`);
  }
});

test('bomb fuses count down smoothly on the guest screen', () => {
  const link = ready({ seed: 4, latency: [30, 150] });
  link.host.run('placeOne(S.players[0], 1, H - 2)'); // the host's bomb, seen by the guest
  const fuses = [];
  link.step(2000, l => {
    tickGuest(l);
    const f = l.guest.run('(__dv.b.find(b => b[5] === 0) || [])[2]');
    if (typeof f === 'number') fuses.push(f);
  });
  assert.ok(fuses.length > 60, 'shown ' + fuses.length);
  let ups = 0, stalls = 0;
  for (let k = 1; k < fuses.length; k++) { if (fuses[k] > fuses[k - 1] + 1e-9) ups++; if (fuses[k] === fuses[k - 1] && fuses[k] > 0) stalls++; }
  assert.strictEqual(ups, 0, 'fuse went back up');
  assert.ok(stalls < fuses.length * 0.1, `fuse stood still on ${stalls} of ${fuses.length} frames`);
});
