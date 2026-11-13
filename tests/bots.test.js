const test = require('node:test'), assert = require('node:assert');
const { loadGame, startLocal } = require('./harness');

const OPEN_MAP = `S.grid = S.grid.map(c => c === '+' ? '.' : c); S.hidden.clear(); S.pu.clear();
  S.portals = []; S.portalAt = new Map(); S.phase = 'play';`;
const NO_SD = `roundTime = 99999; S.time = 99999;`;
const ticks = secs => `for (let i = 0; i < ${Math.round(secs * 60)}; i++) tick(1/60);`;
const bomb = (x, y, fuse, range, owner = 0) =>
  `S.bombs.push({ x: ${x}, y: ${y}, fuse: ${fuse}, owner: ${owner}, range: ${range}, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 });`;

test('dangerMap marks a bomb cross with its fuse and leaves other tiles safe', () => {
  const { run } = loadGame({ seed: 1 });
  startLocal(run, { humans: 1, bots: ['normal'] });
  run(OPEN_MAP + bomb(3, 3, 2, 2) + 'var D = dangerMap(1, true);');
  for (const [x, y] of [[3, 3], [5, 3], [1, 3], [3, 1], [3, 5]]) assert.ok(Math.abs(run(`D[idx(${x}, ${y})]`) - 2) < 1e-6, `${x},${y}`);
  assert.strictEqual(run('D[idx(6, 3)]'), Infinity);
  assert.strictEqual(run('D[idx(3, 6)]'), Infinity);
});

test('chain reaction shortens the second bomb time only when chain = true', () => {
  const { run } = loadGame({ seed: 1 });
  startLocal(run, { humans: 1, bots: ['normal'] });
  run(OPEN_MAP + bomb(3, 3, 1, 2) + bomb(5, 3, 2.5, 2));
  assert.ok(Math.abs(run('dangerMap(1, true)[idx(7, 3)]') - 1) < 1e-6);
  assert.ok(Math.abs(run('dangerMap(1, false)[idx(7, 3)]') - 2.5) < 1e-6);
});

test('hidden enemy mines are not in the bot danger map', () => {
  const { run } = loadGame({ seed: 1 });
  startLocal(run, { humans: 1, bots: ['hard'] });
  run(OPEN_MAP + `S.bombs.push({ x: 5, y: 5, fuse: 9999, owner: 0, range: 3, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0, mine: true, armT: 0 });`);
  assert.strictEqual(run('dangerMap(1, true)[idx(5, 5)]'), Infinity);
  assert.strictEqual(run('dangerMap(1, true)[idx(5, 6)]'), Infinity);
});

test('bot walks out of its own bomb blast', () => {
  for (const level of ['easy', 'normal', 'hard']) {
    const { run } = loadGame({ seed: 7 });
    startLocal(run, { humans: 1, bots: [level] });
    run(OPEN_MAP + NO_SD + 'placeBomb(S.players[1]);' + ticks(4));
    assert.ok(run('S.players[1].alive'), level);
  }
});

for (const [level, maxDeaths] of [['normal', 1], ['hard', 0]]) {
  test(`${level} bot rarely dies alone with crates (3 × 60s)`, () => {
    let deaths = 0, crates = 0;
    for (const seed of [11, 22, 33]) {
      const { run } = loadGame({ seed });
      startLocal(run, { humans: 1, bots: [level] });
      run(NO_SD + 'S.phase = "play";' + ticks(60));
      deaths += run('M.players[1].selfK'); crates += run('M.players[1].crates');
    }
    assert.ok(deaths <= maxDeaths, `${level} self-kills: ${deaths}`);
    assert.ok(crates > 15, `${level} crates: ${crates}`);
  });
}

test('easy bot plays 60s without errors and breaks crates', () => {
  const { run } = loadGame({ seed: 5 });
  startLocal(run, { humans: 1, bots: ['easy'] });
  run(NO_SD + 'S.phase = "play";' + ticks(60));
  assert.ok(run('M.players[1].crates') >= 1);
});

test('hard bot breaks crates and picks up items', () => {
  const { run } = loadGame({ seed: 3 });
  startLocal(run, { humans: 1, bots: ['hard'] });
  run(NO_SD + 'S.phase = "play";' + ticks(60));
  assert.ok(run('M.players[1].crates') > 5, 'crates ' + run('M.players[1].crates'));
  assert.ok(run('M.players[1].items') >= 1, 'items ' + run('M.players[1].items'));
});

test('4 bots finish a match', () => {
  const { run } = loadGame({ seed: 9 });
  startLocal(run, { humans: 0, bots: ['hard', 'normal', 'normal', 'easy'], set: { size: 'S', wins: 2 } });
  run(`for (let i = 0; i < 15 * 60 * 60 && S.phase !== 'match'; i++) tick(1/60);`);
  assert.strictEqual(run('S.phase'), 'match');
  assert.ok(run('M.players.reduce((a, q) => a + q.kills, 0)') > 0, 'bots kill each other, not just sudden death');
});

test('trapped bot does not throw', () => {
  const { run } = loadGame({ seed: 1 });
  startLocal(run, { humans: 1, bots: ['hard'] });
  run(OPEN_MAP + NO_SD + `const b = S.players[1]; b.x = 3; b.y = 3;
    for (const [x, y] of [[2,3],[4,3],[3,2],[3,4]]) S.grid[idx(x, y)] = '+';
    placeBomb(b);` + ticks(5));
  assert.strictEqual(run('typeof inputs[1]'), 'object');
});

test('bots ignore invisible players', () => {
  const setup = invis => {
    const { run } = loadGame({ seed: 4 });
    startLocal(run, { humans: 1, bots: ['hard'] });
    run(OPEN_MAP + NO_SD + `S.players[0].x = 1; S.players[0].y = 1; S.players[0].invis = ${invis};
      S.players[1].x = 1; S.players[1].y = 5; S.players[1].maxBombs = 1;` + ticks(2));
    return run('S.players[1].bombsOut > 0 || !S.players[0].alive || S.bombs.length > 0');
  };
  assert.strictEqual(setup(0), true, 'visible player gets bombed');
  assert.strictEqual(setup(30), false, 'invisible player is ignored');
});

test('lobby: add, cycle and remove bots', () => {
  const { run } = loadGame();
  run("$('#btnBots').onclick(); $('#btnAddBot').onclick(); $('#btnAddBot').onclick(); $('#btnAddBot').onclick();");
  assert.strictEqual(run('lobbyList().length'), 4, 'capped at 4 players');
  run('cycleBot(0)');
  assert.strictEqual(run('lobbyBots[0].level'), 'hard');
  run('cycleBot(0)');
  assert.strictEqual(run('lobbyBots[0].level'), 'easy');
  run('removeBot(1)');
  assert.strictEqual(run('lobbyBots.length'), 2);
});

test('guest join evicts last bot', () => {
  const { run } = loadGame();
  run("mode = 'host'; conns = []; lobbyBots = [{ level: 'easy' }, { level: 'normal' }, { level: 'hard' }];");
  assert.strictEqual(run('makeRoomForGuest()'), true);
  assert.deepStrictEqual(JSON.parse(run('JSON.stringify(lobbyBots.map(b => b.level))')), ['easy', 'normal']);
  run("conns = [1, 2, 3].map(i => ({ open: true, name: 'G' + i, conn: { open: false } })); lobbyBots = [];");
  assert.strictEqual(run('makeRoomForGuest()'), false, 'full of humans');
});

test('rematch keeps bots', () => {
  const { run } = loadGame({ seed: 2 });
  startLocal(run, { humans: 1, bots: ['normal', 'hard'] });
  run("M.players[0].wins = 3; S.phase = 'match'; startMatch();");
  assert.strictEqual(run('M.players[1].bot'), 'normal');
  assert.strictEqual(run('M.players[2].bot'), 'hard');
  assert.strictEqual(run('M.players[0].wins'), 0);
});

test('bots and same-keyboard matches are not recorded on the all-time board', () => {
  let g = loadGame();
  startLocal(g.run, { humans: 1, bots: ['normal'] });
  g.run("M.players[0].wins = 3; S.phase = 'match'; recordMatch(snapshot());");
  assert.deepStrictEqual(Object.keys(JSON.parse(g.ctx.__store.get('bg-alltime'))), ['PLAYER']);
  g = loadGame();
  startLocal(g.run, { humans: 2 });
  g.run("M.players[0].wins = 3; S.phase = 'match'; recordMatch(snapshot());");
  assert.strictEqual(g.ctx.__store.get('bg-alltime'), undefined);
});

test('HUD shows the bot level', () => {
  const { run } = loadGame();
  startLocal(run, { humans: 1, bots: ['hard'] });
  run('render(snapshot(), 1/60)');
  assert.ok(run("__els.get('hud').innerHTML").includes('BOT 1 · HARD'));
});
