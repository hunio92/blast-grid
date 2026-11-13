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

test('render and HUD run on every phase without throwing', () => {
  const { run } = loadGame();
  startLocal(run);
  run(`S.phase = 'play'; S.players[0].invis = 30; S.players[0].softT = 2; S.players[0].glove = true; S.players[0].mines = 2;
       for (let i = 0; i < 300; i++) { tick(1/60); render(snapshot(), 1/60); }
       for (const ph of ['count', 'round', 'match']) { S.phase = ph; boardHeld = true; render(snapshot(), 1/60); }`);
  assert.ok(run("__els.get('hud').innerHTML").includes('👁️'));
});
