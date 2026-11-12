import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { kvGet, kvSet } from './db.js';

interface Admin {
  username: string;
  salt: string;
  hash: string;
}

const COOKIE = 'nmt_session';
const TTL_MS = 30 * 24 * 3600 * 1000;

function secret(): Buffer {
  let s = kvGet<string>('session_secret');
  if (!s) {
    s = randomBytes(32).toString('hex');
    kvSet('session_secret', s);
  }
  return Buffer.from(s, 'hex');
}

function hashPassword(password: string, salt: string) {
  return scryptSync(password, salt, 64).toString('hex');
}

export function hasAdmin() {
  return !!kvGet<Admin>('admin');
}

export function getAdminName() {
  return kvGet<Admin>('admin')?.username;
}

export function setAdmin(username: string, password: string) {
  if (!username.trim() || password.length < 6) throw new Error('用户名不能为空，密码至少 6 位');
  const salt = randomBytes(16).toString('hex');
  kvSet('admin', { username: username.trim(), salt, hash: hashPassword(password, salt) } satisfies Admin);
}

export function verify(username: string, password: string) {
  const a = kvGet<Admin>('admin');
  if (!a || a.username !== username) return false;
  const h = Buffer.from(hashPassword(password, a.salt), 'hex');
  const expected = Buffer.from(a.hash, 'hex');
  return h.length === expected.length && timingSafeEqual(h, expected);
}

export function issueToken(username: string) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + TTL_MS })).toString('base64url');
  const sig = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function readToken(token: string | undefined): string | undefined {
  if (!token) return undefined;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return undefined;
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { u: string; exp: number };
    if (exp < Date.now() || u !== getAdminName()) return undefined;
    return u;
  } catch {
    return undefined;
  }
}

/** Rotating the secret invalidates every issued session (used on password change). */
export function rotateSecret() {
  kvSet('session_secret', randomBytes(32).toString('hex'));
}

export const SESSION_COOKIE = COOKIE;
export const SESSION_TTL_S = TTL_MS / 1000;
