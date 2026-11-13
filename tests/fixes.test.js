const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const { loadGame, startLocal } = require('./harness');

// clear row y=1 between x=1..W-2 of crates/power-ups so bombs can slide
const CLEAR_ROW = `for (let x = 1; x < W - 1; x++) { S.grid[idx(x, 1)] = '.'; S.pu.delete(idx(x, 1)); }
  S.portals = []; S.portalAt = new Map(); S.phase = 'play';
  S.players[1].x = W - 2; S.players[1].y = H - 2;`;

test('no freeze leftovers', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'blast-grid.html'), 'utf8');
  for (const s of ['FREEZE_TIME', 'frozen', "'freeze'", "type === 'z'"]) assert.ok(!src.includes(s), s);
});

test('snapshot player tuple has 22 fields', () => {
  const { run } = loadGame(); startLocal(run);
  assert.strictEqual(run('snapshot().p[0].length'), 22);
});

test('kicked bomb slides over a hidden mine', () => {
  const { run } = loadGame(); startLocal(run);
  run(CLEAR_ROW + `
    S.bombs.push({ x: 6, y: 1, fuse: 9999, owner: 1, range: 3, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0, mine: true, armT: 0 });
    S.players[0].x = 1; S.players[0].kick = true;
    S.bombs.push({ x: 2, y: 1, fuse: 5, owner: 0, range: 1, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 });
    tryKick(S.players[0], 2, 1, 1, 0);
    for (let i = 0; i < 90; i++) tick(1/60);`);
  const bomb = run('S.bombs.find(b => !b.mine)');
  assert.ok(bomb.x > 6, 'bomb stopped at x=' + bomb.x);
  assert.ok(run('S.bombs.some(b => b.mine)'), 'mine still there');
});

test('a blast sets off another bomb on the same tile', () => {
  const { run } = loadGame(); startLocal(run);
  run(CLEAR_ROW + `
    S.bombs.push({ x: 4, y: 1, fuse: 9999, owner: 1, range: 3, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0, mine: true, armT: 0 });
    const b = { x: 4, y: 1, fuse: 5, owner: 0, range: 1, pass: new Set(), dead: false, vx: 0, vy: 0, prog: 0 };
    S.bombs.push(b); explode(b);`);
  assert.strictEqual(run('S.bombs.filter(b => !b.dead).length'), 0);
});

test('mute is saved', () => {
  const { run, ctx } = loadGame(); startLocal(run);
  const ev = { code: 'KeyM', repeat: false, target: { tagName: 'BODY' }, preventDefault() {}, stopImmediatePropagation() {} };
  for (const fn of ctx.__listeners.keydown) fn(ev);
  assert.strictEqual(ctx.__store.get('bg-mute'), '1');
  assert.strictEqual(loadGame({ store: { 'bg-mute': '1' } }).run('muted'), true); // a fresh page load reads it back
});

test('recordMatch parses bg-seen at most once per match id', () => {
  const { run, ctx } = loadGame(); startLocal(run);
  let reads = 0; const get = ctx.localStorage.getItem;
  ctx.localStorage.getItem = k => { if (k === 'bg-seen') reads++; return get(k); };
  run(`var __v = { mid: 'abc', sc: [[1,0,0,0,0],[0,1,0,0,0]], names: ['A','B'], wins: [3,0] };
       for (let i = 0; i < 10; i++) recordMatch(__v);`);
  assert.ok(reads <= 1, 'reads = ' + reads);
});

test('TAB scoreboard closes when the window loses focus', () => {
  const { run, ctx } = loadGame(); startLocal(run);
  run('boardHeld = true');
  for (const fn of ctx.__listeners.blur) fn({});
  assert.strictEqual(run('boardHeld'), false);
});
