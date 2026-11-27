const test = require('node:test'), assert = require('node:assert');
const { loadGame, startLocal } = require('./harness');

// row y=1 cleared; player 0 at (1,1), player 1 far away
const SETUP = `for (let x = 1; x < W - 1; x++) { S.grid[idx(x, 1)] = '.'; S.pu.delete(idx(x, 1)); }
  S.portals = []; S.portalAt = new Map(); S.phase = 'play';
  S.players[0].x = 1; S.players[0].y = 1; S.players[1].x = W - 2; S.players[1].y = H - 2;`;
const MINE = (x, owner) => `S.bombs.push({ x: ${x}, y: 1, fuse: 9999, owner: ${owner}, range: 3, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0, mine: true, armT: 0 });`;

test('stepping on an enemy mine: the snapshot says whose mine killed you and marks the tile', () => {
  const { run } = loadGame(); startLocal(run);
  run(SETUP + MINE(4, 1) + `S.players[0].x = 4; for (let i = 0; i < 3; i++) tick(1/60);`);
  assert.strictEqual(run('S.players[0].alive'), false);
  const s = run('snapshot()');
  assert.strictEqual(s.mb[0], 1, 'mb names the mine owner');
  assert.strictEqual(s.mb[1], -1);
  assert.ok(s.mk.some(([x, y, , o]) => x === 4 && y === 1 && o === 1), 'mine tile marked: ' + JSON.stringify(s.mk));
});

test('a mine set off by a blast still counts as a mine death', () => {
  const { run } = loadGame(); startLocal(run);
  // own bomb at (2,1) range 1 reaches the enemy mine at (3,1); the mine's blast (range 3) reaches the player at (5,1)
  run(SETUP + MINE(3, 1) + `S.players[0].x = 5;
    const b = { x: 2, y: 1, fuse: 0.01, owner: 0, range: 1, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 };
    S.bombs.push(b); for (let i = 0; i < 3; i++) tick(1/60);`);
  assert.strictEqual(run('S.players[0].alive'), false);
  assert.strictEqual(run('snapshot().mb[0]'), 1);
});

test('a chain that runs through a hidden mine counts as that mine (own bomb -> enemy mine -> own bomb -> you)', () => {
  const { run } = loadGame(); startLocal(run);
  // player 0's bomb at (2,1) range 1 sets off player 1's mine at (3,1); the mine (range 3) sets off player 0's second
  // bomb at (5,1), still on a long fuse; that bomb (range 2) reaches the player standing at (7,1)
  run(SETUP + MINE(3, 1) + `S.players[0].x = 7;
    S.bombs.push({ x: 5, y: 1, fuse: 5, owner: 0, range: 2, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 });
    S.bombs.push({ x: 2, y: 1, fuse: 0.01, owner: 0, range: 1, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 });
    for (let i = 0; i < 3; i++) tick(1/60);`);
  assert.strictEqual(run('S.players[0].alive'), false);
  assert.strictEqual(run('snapshot().mb[0]'), 1, "shown as player 1's mine");
  assert.strictEqual(run('M.players[0].selfK'), 1, 'still scored as a self-kill (the last bomb was our own)');
});

test('a normal bomb death is not a mine death', () => {
  const { run } = loadGame(); startLocal(run);
  run(SETUP + `const b = { x: 2, y: 1, fuse: 0.01, owner: 1, range: 2, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 };
    S.bombs.push(b); for (let i = 0; i < 3; i++) tick(1/60);`);
  assert.strictEqual(run('S.players[0].alive'), false);
  const s = run('snapshot()');
  assert.strictEqual(s.mb[0], -1);
  assert.strictEqual(s.mk.length, 0);
});

test('the mine mark fades after a while', () => {
  const { run } = loadGame(); startLocal(run);
  // a bomb far from both players sets the mine off: nobody dies, the round goes on
  run(SETUP + MINE(8, 1) + `const b = { x: 7, y: 1, fuse: 0.01, owner: 0, range: 1, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 };
    S.bombs.push(b); for (let i = 0; i < 3; i++) tick(1/60);`);
  assert.strictEqual(run('snapshot().mk.length'), 1);
  run('for (let i = 0; i < 150; i++) tick(1/60);');
  assert.strictEqual(run('S.phase'), 'play');
  assert.strictEqual(run('snapshot().mk.length'), 0);
});

test('the mine-death cause resets next round', () => {
  const { run } = loadGame(); startLocal(run);
  run(SETUP + MINE(4, 1) + `S.players[0].x = 4; for (let i = 0; i < 3; i++) tick(1/60);`);
  assert.strictEqual(run('snapshot().mb[0]'), 1);
  run('newRound()');
  assert.ok(run('snapshot().mb').every(v => v === -1));
  assert.strictEqual(run('snapshot().mk.length'), 0);
});

test('host posts a chat notice for a mine death', () => {
  const { run } = loadGame(); startLocal(run);
  run(`mode = 'host';` + SETUP + MINE(4, 1) + `S.players[0].x = 4; for (let i = 0; i < 3; i++) tick(1/60);`);
  const lines = run('CHAT.log.filter(l => l.sys).map(l => l.m)');
  const n0 = run('M.players[0].name'), n1 = run('M.players[1].name');
  assert.ok(lines.some(m => m.includes(n0) && m.includes(n1 + "'s mine")), JSON.stringify(lines));
});

test('a guest killed by a mine gets the cause and the mark over the network', () => {
  const { makeLink } = require('./net');
  const link = makeLink({ seed: 3, latency: [60, 90], bots: ['easy'] });
  link.step(4000); // past the countdown
  link.host.run(`for (let x = 1; x < W - 1; x++) { S.grid[idx(x, 1)] = '.'; S.pu.delete(idx(x, 1)); }
    S.portals = []; S.portalAt = new Map();
    S.bombs.push({ x: 4, y: 1, fuse: 9999, owner: 0, range: 3, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0, mine: true, armT: 0 });
    S.players[GUEST.slot].x = 4; S.players[GUEST.slot].y = 1;`);
  link.step(300);
  const slot = link.guest.run('mySlot');
  assert.strictEqual(link.guest.run('view.mb[mySlot]'), 0, 'guest knows the host\'s mine got it');
  assert.ok(link.guest.run('view.mk.length') >= 1);
  assert.strictEqual(link.guest.run('view.p[mySlot][2]'), 0, 'guest slot ' + slot + ' dead');
});
