const test = require('node:test'), assert = require('node:assert');
const { loadGame } = require('./harness');
const { makeLink } = require('./net');

function chatLink(opts = {}) {
  const link = makeLink(Object.assign({ seed: 5, latency: [40, 220] }, opts));
  link.host.run('GUEST.chatAck = 0; GUEST.sayId = 0;');
  const drop = { chat: 0, say: 0, sack: 0, cack: 0 };
  const toG = link.host.ctx.__sendToGuest, toH = link.guest.ctx.__sendToHost;
  link.host.ctx.__sendToGuest = m => { if (drop[m.t] > 0) { drop[m.t]--; return; } toG(m); };
  link.guest.ctx.__sendToHost = m => { if (drop[m.t] > 0) { drop[m.t]--; return; } toH(m); };
  link.drop = drop;
  return link;
}
const log = g => JSON.parse(g.run('JSON.stringify(CHAT.log.map(l => l.sys ? "* " + l.m : l.n + ": " + l.m))'));

test('guest and host lines reach both sides once, in order', () => {
  const link = chatLink();
  link.guest.run("chatSend('hi from guest')");
  link.step(600);
  link.host.run("chatSend('one'); chatSend('two'); chatSend('three')");
  link.guest.run("chatSend('four')");
  link.step(1500);
  assert.deepStrictEqual(log(link.host), ['G: hi from guest', 'H: one', 'H: two', 'H: three', 'G: four']);
  assert.deepStrictEqual(log(link.guest), log(link.host));
});

test('lost chat messages and acks are resent without duplicates', () => {
  const link = chatLink();
  Object.assign(link.drop, { chat: 3, say: 2, sack: 1, cack: 2 });
  link.guest.run("chatSend('a'); chatSend('b')");
  link.host.run("chatSend('c')");
  link.step(5000, l => l.guest.run('chatTick(performance.now())'));
  const h = log(link.host);
  assert.deepStrictEqual(h.slice().sort(), ['G: a', 'G: b', 'H: c'].sort());
  assert.ok(h.indexOf('G: a') < h.indexOf('G: b'), 'guest lines keep their order');
  assert.deepStrictEqual(log(link.guest), h);
  assert.strictEqual(link.guest.run('CHAT.out.length'), 0, 'outbox drained');
});

test('messages are trimmed, capped and empty ones ignored', () => {
  const { run } = loadGame();
  run("mode = 'host'; myName = 'H'; conns = []; chatSend('   '); chatSend('  x   y  '); chatSend('z'.repeat(300));");
  assert.deepStrictEqual(JSON.parse(run('JSON.stringify(CHAT.log.map(l => l.m.length))')), [3, 120]);
  assert.strictEqual(run('CHAT.log[0].m'), 'x y');
});

test('host announces joins and leaves', () => {
  const { run } = loadGame();
  run(`mode = 'host'; myName = 'H'; conns = []; lobbyBots = [];
    var E = { open: true, slot: -1, name: 'Guest', inQ: 0, chatAck: 0, sayId: 0, conn: { open: true, send() {} } }; conns.push(E);
    hostOnData(E, { t: 'hello', name: 'Ana' }); hostOnData(E, { t: 'hello', name: 'Ana' }); dropConn(E);`);
  assert.deepStrictEqual(JSON.parse(run('JSON.stringify(CHAT.log.map(l => l.m))')), ['Ana joined', 'Ana left']);
});

test('T opens chat online and stops your player; chat is off offline', () => {
  const { run, ctx } = loadGame();
  const key = code => { for (const f of ctx.__listeners.keydown) f({ code, target: { tagName: 'BODY' }, preventDefault() {}, repeat: false }); };
  run("mode = 'host'; myName = 'H'; conns = []; lobbyBots = [{ level: 'easy' }]; SET = cleanSet({}); startMatch(); keys.add('KeyD');");
  assert.strictEqual(run("document.body.classList.contains('chatOn')"), true);
  key('KeyT');
  assert.strictEqual(run('keys.size'), 0, 'held keys released');
  run("resetAll(); mode = 'local'; localHumans = 1; lobbyBots = [{ level: 'easy' }]; startMatch();");
  assert.strictEqual(run("document.body.classList.contains('chatOn')"), false);
  assert.strictEqual(run('CHAT.log.length'), 0, 'log cleared on leaving the room');
});
