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
