import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FailureLimiter } from '../src/ratelimit.js';

const opts = { perClient: 3, global: 5, windowMs: 1000, lockMs: 2000 };

test('locks a client after repeated failures', () => {
  const l = new FailureLimiter(opts);
  const t = 1_000_000;
  for (let i = 0; i < 3; i++) l.fail('a', t);
  assert.ok(l.blockedFor('a', t) > 0);
  assert.equal(l.blockedFor('b', t), 0);
  assert.equal(l.blockedFor('a', t + 2001), 0);
});

test('global cap stops rotating client addresses', () => {
  const l = new FailureLimiter(opts);
  const t = 2_000_000;
  for (let i = 0; i < 5; i++) l.fail(`ip${i}`, t);
  assert.ok(l.blockedFor('fresh-ip', t) > 0, 'a never-seen client is blocked by the global cap');
  assert.equal(l.blockedFor('fresh-ip', t + 1001), 0, 'cap clears after the window');
});

test('memory stays bounded', () => {
  const l = new FailureLimiter({ ...opts, global: 1e9, maxClients: 100 });
  for (let i = 0; i < 10_000; i++) l.fail(`ip${i}`, 3_000_000);
  assert.equal(l.size(), 100);
  l.sweep(3_000_000 + 5000);
  assert.equal(l.size(), 0, 'expired entries are swept');
});
