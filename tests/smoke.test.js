const test = require('node:test'), assert = require('node:assert');
const { loadGame, startLocal } = require('./harness');

test('local match runs 20s of ticks without throwing', () => {
  const { run } = loadGame();
  startLocal(run);
  run('S.phase = "play"; for (let i = 0; i < 1200; i++) tick(1/60);');
  assert.ok(['play', 'grace', 'round', 'match', 'count'].includes(run('S.phase')));
});

test('a bomb placed by P1 explodes after FUSE', () => {
  const { run } = loadGame();
  startLocal(run);
  run('S.phase = "play"; placeBomb(S.players[0]);');
  assert.strictEqual(run('S.bombs.length'), 1);
  run('for (let i = 0; i < Math.ceil(FUSE * 60) + 2; i++) tick(1/60);');
  assert.strictEqual(run('S.bombs.length'), 0);
  assert.ok(run('S.flames.size') > 0);
});
