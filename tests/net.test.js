const test = require('node:test'), assert = require('node:assert');
const { makeLink } = require('./net');

test("guest sees the host's world after start", () => {
  const link = makeLink();
  link.step(500);
  assert.strictEqual(link.guest.run('mySlot'), 1);
  assert.strictEqual(link.guest.run('started'), true);
  assert.ok(['count', 'play'].includes(link.guest.run('view.ph')));
  assert.ok(link.guestPos(1));
});
