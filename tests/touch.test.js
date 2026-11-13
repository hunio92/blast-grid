const test = require('node:test'), assert = require('node:assert');
const { loadGame, startLocal } = require('./harness');

const dirs = run => JSON.parse(run('JSON.stringify((({ up, down, left, right }) => ({ up, down, left, right }))(dirState(0)))'));

test('stick right beyond dead zone → right only, horizontal priority', () => {
  const { run } = loadGame(); startLocal(run, { humans: 1, bots: ['easy'] });
  run('setTouchStick(0.8, 0.2)');
  assert.deepStrictEqual(dirs(run), { up: false, down: false, left: false, right: true });
  assert.strictEqual(run('localIn[0].pri'), 'h');
});

test('stick inside dead zone → no direction', () => {
  const { run } = loadGame(); startLocal(run, { humans: 1, bots: ['easy'] });
  run('setTouchStick(0.2, 0.1)');
  assert.deepStrictEqual(dirs(run), { up: false, down: false, left: false, right: false });
});

test('diagonal stick picks the dominant axis', () => {
  const { run } = loadGame(); startLocal(run, { humans: 1, bots: ['easy'] });
  run('setTouchStick(0.4, -0.9)');
  assert.deepStrictEqual(dirs(run), { up: true, down: false, left: false, right: false });
  assert.strictEqual(run('localIn[0].pri'), 'v');
});

test('each button tap presses once', () => {
  const { run } = loadGame(); startLocal(run, { humans: 1, bots: ['easy'] });
  const b0 = run('localIn[0].bombSeq'), t0 = run('localIn[0].teleSeq'), d0 = run('localIn[0].detSeq');
  run("touchPress('bomb'); touchPress('bomb'); touchPress('tele'); touchPress('det')");
  assert.strictEqual(run('localIn[0].bombSeq'), b0 + 2);
  assert.strictEqual(run('localIn[0].teleSeq'), t0 + 1);
  assert.strictEqual(run('localIn[0].detSeq'), d0 + 1);
});

test('a touch bomb tap drops a bomb in the game', () => {
  const { run } = loadGame(); startLocal(run, { humans: 1, bots: ['easy'] });
  run("S.phase = 'play'; touchPress('bomb'); readLocalInputs(); tick(1/60);");
  assert.ok(run('S.bombs.some(b => b.owner === 0)'));
});

test('touch drives player 1 in a same-keyboard match', () => {
  const { run } = loadGame(); startLocal(run, { humans: 2 });
  run('setTouchStick(-1, 0)');
  assert.strictEqual(run('dirState(0).left'), true);
  assert.strictEqual(run('dirState(1).left'), false);
});

test('a guest sends touch input to the host', () => {
  const { run } = loadGame();
  run("mode = 'guest'; var SENT = []; hostConn = { open: true, send: m => SENT.push(m) };");
  run("touchPress('bomb'); setTouchStick(0, 1);");
  const sent = JSON.parse(run('JSON.stringify(SENT)'));
  assert.ok(sent.some(m => m.t === 'in' && m.k.bombSeq === 1));
  assert.ok(sent.some(m => m.t === 'in' && m.k.down === true));
});

test('touch direction clears when the window loses focus', () => {
  const { run, ctx } = loadGame(); startLocal(run, { humans: 1, bots: ['easy'] });
  run('setTouchStick(1, 0)');
  for (const fn of ctx.__listeners.blur) fn({});
  assert.strictEqual(run('dirState(0).right'), false);
});
