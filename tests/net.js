// Connects a host game and a guest game (two vm contexts) through in-memory channels with simulated latency.
// Messages are JSON-cloned like the real 'json' PeerJS serialization, and may arrive out of order (unordered channel).
const { loadGame } = require('./harness');

function rng(seed) { let t = seed >>> 0; return () => { t = (t + 0x6D2B79F5) >>> 0; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; }; }

// hostMs: how often the host's timer fires (browsers round 1000/60 down to 16); frameMs: guest screen refresh;
// latencyFn(nowMs) → ms overrides the random latency (e.g. to inject a spike).
function makeLink({ seed = 1, latency = [100, 100], bots = [], size = 'S', hostMs = 1000 / 60, frameMs = 1000 / 60, latencyFn = null } = {}) {
  const host = loadGame({ seed }), guest = loadGame({ seed: seed + 1000 });
  const rand = rng(seed + 7), lat = () => latencyFn ? latencyFn(now) : latency[0] + rand() * (latency[1] - latency[0]);
  let now = 1000;
  const toGuest = [], toHost = [];
  const clone = m => JSON.parse(JSON.stringify(m));
  host.ctx.__sendToGuest = m => toGuest.push({ at: now + lat(), m: clone(m) });
  guest.ctx.__sendToHost = m => toHost.push({ at: now + lat(), m: clone(m) });
  const setNow = () => { host.ctx.__now = now; guest.ctx.__now = now; };
  let nextHost = now + hostMs, nextGuest = now + frameMs;
  setNow();
  guest.run(`mode = 'guest'; myName = 'G'; hostConn = { open: true, send: m => __sendToHost(m) };
    myPing = ${(latency[0] + latency[1])}; lastR = performance.now();`);
  host.run(`mode = 'host'; myName = 'H'; SET = cleanSet({ size: '${size}' }); lobbyBots = ${JSON.stringify(bots.map(level => ({ level })))};
    conns = []; var GUEST = { conn: { open: true, send: m => __sendToGuest(m) }, name: 'G', slot: -1, open: true, inQ: 0, ping: 0 };
    conns.push(GUEST); lastT = performance.now(); startMatch();`);
  const deliver = (q, fn) => {
    for (let k = 0; k < q.length;) { if (q[k].at <= now) { fn(q.splice(k, 1)[0].m); } else k++; }
  };
  const link = {
    host, guest,
    now: () => now,
    frames: [], // guest display view after every frame
    step(ms, onFrame) {
      const end = now + ms;
      for (;;) {
        const t = Math.min(nextHost, nextGuest);
        if (t > end) break;
        now = t; setNow();
        deliver(toHost, m => { host.ctx.__m = m; host.run('hostOnData(GUEST, __m)'); });
        deliver(toGuest, m => { guest.ctx.__m = m; guest.run('guestOnData(__m)'); });
        if (t === nextHost) { host.run('simStep()'); nextHost += hostMs; }
        if (t === nextGuest) {
          guest.run(`var __dv = view ? guestUpdate(performance.now(), ${frameMs / 1000}) : null;`);
          nextGuest += frameMs;
          if (onFrame) onFrame(link);
        }
      }
      now = end; setNow();
    },
    hostPos: slot => host.run(`[S.players[${slot}].x, S.players[${slot}].y]`),
    guestPos: slot => guest.run(`__dv ? [__dv.p[${slot}][0], __dv.p[${slot}][1]] : null`),
    press: code => guest.run(`keys.add('${code}'); sendGuestInput();`),
    release: code => guest.run(`keys.delete('${code}'); sendGuestInput();`),
  };
  return link;
}

module.exports = { makeLink };
