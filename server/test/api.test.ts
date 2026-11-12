import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { isolateDataDir } from './helpers.js';

isolateDataDir();
const { buildApp } = await import('../src/app.js');
const auth = await import('../src/auth.js');
type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

before(async () => {
  app = await buildApp();
});

const post = (url: string, payload: unknown, headers: Record<string, string> = {}) =>
  app.inject({ method: 'POST', url, payload: payload as object, headers });

test('setup requires the one-time code from the logs', async () => {
  const code = auth.ensureSetupCode()!;
  assert.match(code, /^[A-Z2-9]{8}$/);
  let r = await post('/api/auth/setup', { username: 'admin', password: 'secret123' });
  assert.equal(r.statusCode, 403);
  r = await post('/api/auth/setup', { username: 'admin', password: 'secret123', code: 'WRONGWRO' });
  assert.equal(r.statusCode, 403);
  r = await post('/api/auth/setup', { username: 'admin', password: 'secret123', code: code.toLowerCase() });
  assert.equal(r.statusCode, 200);
  assert.ok(r.headers['set-cookie']);
  r = await post('/api/auth/setup', { username: 'evil', password: 'secret123', code });
  assert.equal(r.statusCode, 409, 'cannot be repeated once an admin exists');
});

test('security headers are sent', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(r.headers['x-frame-options'], 'DENY');
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.match(String(r.headers['content-security-policy']), /frame-ancestors 'none'/);
});

test('api requires a session', async () => {
  const r = await app.inject({ method: 'GET', url: '/api/settings' });
  assert.equal(r.statusCode, 401);
});

test('spoofed X-Forwarded-For does not bypass the login limiter', async () => {
  // 1 failure was already spent by "WRONGWRO" above on the same socket address
  let last = 0;
  for (let i = 0; i < 8; i++) {
    const r = await post('/api/auth/login', { username: 'admin', password: 'nope' }, { 'x-forwarded-for': `10.0.0.${i}` });
    last = r.statusCode;
  }
  assert.equal(last, 429);
  // a different Cloudflare visitor is still allowed (until the global cap)
  const other = await post('/api/auth/login', { username: 'admin', password: 'secret123' }, { 'cf-connecting-ip': '203.0.113.9' });
  assert.equal(other.statusCode, 200);
});

test('unknown user and wrong password look the same', async () => {
  const a = await post('/api/auth/login', { username: 'ghost', password: 'x' }, { 'cf-connecting-ip': '198.51.100.1' });
  const b = await post('/api/auth/login', { username: 'admin', password: 'x' }, { 'cf-connecting-ip': '198.51.100.2' });
  assert.equal(a.statusCode, 401);
  assert.equal(b.statusCode, 401);
  assert.deepEqual(a.json(), b.json());
});
