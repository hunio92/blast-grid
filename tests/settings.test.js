const test = require('node:test'), assert = require('node:assert');
const { loadGame, startLocal } = require('./harness');

// share of crate tiles among the tiles that were allowed to get a crate
const CRATE_SHARE = `(() => {
  const banned = new Set(), cross = [[0,0],[1,0],[-1,0],[0,1],[0,-1]];
  for (const [sx, sy] of spawnPoints()) for (const [dx, dy] of cross) banned.add(idx(sx + dx, sy + dy));
  for (const pair of S.portals) for (const i of pair) for (const [dx, dy] of cross) banned.add(i + dx + dy * W);
  let n = 0, c = 0;
  S.grid.forEach((g, i) => { if (g !== '#' && !banned.has(i)) { n++; if (g === '+') c++; } });
  return c / n;
})()`;

test('crate density follows the setting', () => {
  for (const [crates, want] of [['few', 0.55], ['normal', 0.75], ['many', 0.9]]) {
    const { run } = loadGame();
    startLocal(run, { set: { crates } });
    let sum = 0;
    for (let k = 0; k < 5; k++) { run('newRound()'); sum += run(CRATE_SHARE); }
    assert.ok(Math.abs(sum / 5 - want) < 0.08, `${crates}: ${sum / 5}`);
  }
});

test('no power-ups enabled', () => {
  const { run } = loadGame();
  startLocal(run, { set: { off: run('PU_ALL').slice() } });
  for (let k = 0; k < 5; k++) { run('newRound()'); assert.strictEqual(run('S.hidden.size'), 0); }
  run(`S.phase = 'play';
       for (let i = 0; i < 600; i++) { if (i % 60 === 0) { inputs[0] = { bombSeq: i }; } tick(1/60); }`);
});

test('disabled power-ups never drop', () => {
  const { run } = loadGame();
  startLocal(run, { set: { off: run("PU_ALL.filter(t => t !== 'k')") } });
  for (let k = 0; k < 20; k++) {
    run('newRound()');
    assert.ok(run("[...S.hidden.values()].every(t => t === 'k')"));
  }
});

test('round time and wins target', () => {
  let g = loadGame(); startLocal(g.run, { set: { size: 'S', time: 'auto' } });
  assert.strictEqual(g.run('S.time'), 150);
  assert.strictEqual(g.run('W'), 15);
  g = loadGame(); startLocal(g.run, { set: { time: '240' } });
  assert.strictEqual(g.run('S.time'), 240);
  g = loadGame(); startLocal(g.run, { set: { wins: 5 } });
  assert.strictEqual(g.run('M.target'), 5);
  assert.strictEqual(g.run('snapshot().wt'), 5);
});

test('settings persist and bad saved values fall back to defaults', () => {
  const g = loadGame({ store: { 'bg-set': '{"wins":99,"crates":"lots","time":"150","off":["k","zz"]}' } });
  assert.strictEqual(g.run('SET.wins'), 3);
  assert.strictEqual(g.run('SET.crates'), 'normal');
  assert.strictEqual(g.run('SET.time'), '150');
  assert.deepStrictEqual(g.run('JSON.stringify(SET.off)'), '["k"]');
  g.run("SET.wins = 4; saveSet()");
  assert.strictEqual(JSON.parse(g.ctx.__store.get('bg-set')).wins, 4);
});

test('one human offline: both key columns move P1', () => {
  const { run } = loadGame();
  startLocal(run, { humans: 1, bots: ['normal'] });
  run("keys.add('ArrowLeft')");
  assert.strictEqual(run('dirState(0).left'), true);
  run("keys.clear(); keys.add('KeyA')");
  assert.strictEqual(run('dirState(0).left'), true);
});

test('two humans offline: key columns split between P1 and P2', () => {
  const { run } = loadGame();
  startLocal(run, { humans: 2 });
  run("keys.add('ArrowLeft')");
  assert.strictEqual(run('dirState(0).left'), false);
  assert.strictEqual(run('dirState(1).left'), true);
});

test('offline lobby buttons set up the match', () => {
  const { run } = loadGame();
  run("$('#btnBots').onclick()");
  assert.strictEqual(run('mode'), 'local');
  assert.strictEqual(run('lobbyList().length'), 2);
  assert.strictEqual(run("lobbyList()[1].kind"), 'bot');
  run("$('#btnStart').onclick()");
  assert.strictEqual(run('M.players.length'), 2);
  assert.strictEqual(run('M.players[1].bot'), 'normal');
  run("toMenu(''); $('#btnLocal').onclick()");
  assert.deepStrictEqual(JSON.parse(run('JSON.stringify(lobbyList().map(p => p.kind))')), ['local', 'local']);
});
