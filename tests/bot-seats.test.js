const test = require('node:test'), assert = require('node:assert');
const { loadGame } = require('./harness');

// host match: H + optional guests + bots; returns run
function hostMatch(guests, bots, seed = 3) {
  const { run } = loadGame({ seed });
  run(`mode = 'host'; myName = 'H'; SET = cleanSet({}); conns = [];
    ${guests.map(n => `conns.push({ open: true, slot: -1, name: '${n}', inQ: 0, conn: { open: true, send() {} } });`).join('')}
    lobbyBots = ${JSON.stringify(bots.map(level => ({ level })))};
    startMatch(); S.phase = 'play';`);
  return run;
}
const entry = name => `({ open: true, slot: -1, name: '${name}', inQ: 0, conn: { open: true, send() {} } })`;
const names = run => JSON.parse(run('JSON.stringify(M.players.map(p => p.name))'));

test('match start seats only the bots that fit and hands the rest to guests', () => {
  const run = hostMatch(['G'], ['easy', 'normal', 'hard']);
  assert.deepStrictEqual(names(run), ['H', 'G', 'BOT 1', 'BOT 2']);
  assert.strictEqual(run('M.players[1].bumped.name'), 'BOT 3');
  assert.strictEqual(run('M.players[1].bumped.bot'), 'hard');
  run("M.players[0].wins = 3; S.phase = 'match'; startMatch();");
  assert.strictEqual(run('M.players.length'), 4, 'rematch stays at 4');
});

test('hot join into a full bot match takes the last bot seat', () => {
  const run = hostMatch([], ['easy', 'normal', 'hard']);
  run(`var E = ${entry('G')}; conns.push(E);`);
  assert.strictEqual(run('hotJoin(E)'), true);
  assert.strictEqual(run('E.slot'), 3);
  assert.deepStrictEqual(names(run), ['H', 'BOT 1', 'BOT 2', 'G']);
  assert.strictEqual(run('M.players[3].bumped.name'), 'BOT 3');
  assert.strictEqual(run('M.players[3].bot'), undefined);
  assert.strictEqual(run('S.players[3].alive'), false, 'bot character removed');
  assert.strictEqual(run('S.players[3].deathT'), 9, 'no death animation');
  assert.strictEqual(run('M.players[3].wins'), 0);
});

test('leaver gives the bot back and it plays on', () => {
  const run = hostMatch([], ['easy', 'normal', 'hard']);
  run(`var E = ${entry('G')}; conns.push(E); hotJoin(E); M.players[3].bumped.wins = 1; newRound(); S.phase = 'play';`);
  assert.strictEqual(run('S.players[3].alive'), true);
  run('M.players[3].wins = 2; dropConn(E)');
  assert.strictEqual(run('M.players[3].name'), 'BOT 3');
  assert.strictEqual(run('M.players[3].bot'), 'hard');
  assert.strictEqual(run('M.players[3].wins'), 1, 'bot keeps its own score');
  assert.strictEqual(run('S.players[3].alive'), true, 'takes over the character');
  assert.strictEqual(run('M.away.G.seat'), 3);
  const before = run('S.bombs.filter(b => b.owner === 3).length');
  run('simStep()');
  assert.strictEqual(run('S.bombs.filter(b => b.owner === 3).length'), before, 'no bomb fired by the takeover');
  assert.doesNotThrow(() => run('for (let i = 0; i < 120; i++) tick(1/60);'));
  assert.ok(run('S.bots[3]'), 'bot brain running');
});

test('rejoin under the same name takes the seat back with stats', () => {
  const run = hostMatch([], ['easy', 'normal', 'hard']);
  run(`var E = ${entry('G')}; conns.push(E); hotJoin(E); M.players[3].wins = 2; dropConn(E);
    var F = ${entry('G')}; conns.push(F);`);
  assert.strictEqual(run('hotJoin(F)'), true);
  assert.strictEqual(run('F.slot'), 3);
  assert.strictEqual(run('M.players[3].name'), 'G');
  assert.strictEqual(run('M.players[3].wins'), 2);
  assert.strictEqual(run('M.players[3].bumped.name'), 'BOT 3');
});

test('a free left seat is used before any bot is bumped', () => {
  const run = hostMatch(['A'], ['easy', 'normal']);
  run("dropConn(conns[0]); var E = " + entry('G') + "; conns.push(E);");
  assert.strictEqual(run('hotJoin(E)'), true);
  assert.strictEqual(run('E.slot'), 1);
  assert.deepStrictEqual(names(run), ['H', 'G', 'BOT 1', 'BOT 2']);
});

test('leaver without a bumped bot leaves an empty seat', () => {
  const run = hostMatch(['A'], []);
  run('dropConn(conns[0])');
  assert.strictEqual(run('M.players[1].connected'), false);
  assert.strictEqual(run('M.players[1].bot'), undefined);
  assert.strictEqual(run('S.players[1].alive'), false);
});

test('four humans is still full', () => {
  const run = hostMatch(['A', 'B', 'C'], ['easy']);
  run(`var E = ${entry('G')}; conns.push(E);`);
  assert.strictEqual(run('hotJoin(E)'), false);
});
