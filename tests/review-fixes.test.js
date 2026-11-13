const test = require('node:test'), assert = require('node:assert');
const { loadGame, startLocal } = require('./harness');

test('bots do not know where enemy mines are when choosing bomb spots', () => {
  const { run } = loadGame({ seed: 1 });
  startLocal(run, { humans: 1, bots: ['hard'] });
  run(`S.phase = 'play'; S.grid[idx(5, 5)] = '.';
    S.bombs.push({ x: 5, y: 5, fuse: 9999, owner: 0, range: 3, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0, mine: true, armT: 0 });`);
  assert.strictEqual(run('canPlaceAt(S.players[1], idx(5, 5))'), true, 'enemy mine must look like an empty tile');
  run(`S.bombs.push({ x: 7, y: 5, fuse: 9999, owner: 1, range: 3, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0, mine: true, armT: 0 });
    S.grid[idx(7, 5)] = '.';`);
  assert.strictEqual(run('canPlaceAt(S.players[1], idx(7, 5))'), false, 'own mine is known');
});

test('rematch does not crash when a guest has connected but not said hello yet', () => {
  const { run } = loadGame({ seed: 1 });
  run(`mode = 'host'; myName = 'H'; SET = cleanSet({}); conns = [];
    lobbyBots = [{ level: 'easy' }, { level: 'normal' }, { level: 'hard' }];
    startMatch();
    conns.push({ open: true, slot: -1, name: 'Guest', conn: { open: true, send() {} } });`);
  assert.doesNotThrow(() => run('startMatch()'));
  assert.ok(run('M.players.length') <= 4);
  assert.strictEqual(run('S.players.length'), run('M.players.length'));
});

test('page zoom is only locked during play', () => {
  const { run } = loadGame();
  const vp = () => run("document.querySelector('meta[name=\"viewport\"]').getAttribute('content') || ''");
  run("show('menu')");
  assert.ok(!vp().includes('user-scalable=no'), 'menu: ' + vp());
  run("show('game')");
  assert.ok(vp().includes('user-scalable=no'), 'game: ' + vp());
  run("show('lobby')");
  assert.ok(!vp().includes('user-scalable=no'), 'lobby: ' + vp());
});
