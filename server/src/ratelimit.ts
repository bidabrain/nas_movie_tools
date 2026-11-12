import type { FastifyRequest } from 'fastify';

/**
 * Client address for rate limiting. Behind Cloudflare the real visitor is in
 * CF-Connecting-IP (Cloudflare overwrites it, so it cannot be spoofed through
 * the tunnel). X-Forwarded-For is NOT used: any client can put anything there.
 */
export function clientKey(req: FastifyRequest): string {
  // Behind another reverse proxy, set CLIENT_IP_HEADER (e.g. x-real-ip) to a
  // header that proxy always overwrites.
  const header = (process.env.CLIENT_IP_HEADER ?? 'cf-connecting-ip').toLowerCase();
  const cf = req.headers[header];
  if (typeof cf === 'string' && cf) return cf.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

interface Bucket {
  failures: number;
  windowStart: number;
  lockedUntil: number;
}

export interface LimiterOptions {
  /** Failures allowed per client within `windowMs` before locking it. */
  perClient: number;
  /** Failures allowed across ALL clients within `windowMs` (defeats IP rotation). */
  global: number;
  windowMs: number;
  lockMs: number;
  /** Hard cap on tracked clients to bound memory. */
  maxClients?: number;
}

export class FailureLimiter {
  private clients = new Map<string, Bucket>();
  private globalFailures: number[] = [];
  private sweepTimer: NodeJS.Timeout;

  constructor(private o: LimiterOptions) {
    this.sweepTimer = setInterval(() => this.sweep(), 60_000);
    this.sweepTimer.unref();
  }

  /** Milliseconds until `key` may try again, or 0 when allowed. */
  blockedFor(key: string, now = Date.now()): number {
    const b = this.clients.get(key);
    const clientWait = b && b.lockedUntil > now ? b.lockedUntil - now : 0;
    this.trimGlobal(now);
    const globalWait =
      this.globalFailures.length >= this.o.global ? this.globalFailures[0] + this.o.windowMs - now : 0;
    return Math.max(clientWait, globalWait, 0);
  }

  fail(key: string, now = Date.now()) {
    this.globalFailures.push(now);
    let b = this.clients.get(key);
    if (!b || now - b.windowStart > this.o.windowMs) {
      b = { failures: 0, windowStart: now, lockedUntil: 0 };
      this.clients.delete(key);
      this.clients.set(key, b);
    }
    b.failures++;
    if (b.failures >= this.o.perClient) b.lockedUntil = now + this.o.lockMs;
    const max = this.o.maxClients ?? 10_000;
    while (this.clients.size > max) {
      // Map keeps insertion order: drop the oldest entry
      this.clients.delete(this.clients.keys().next().value!);
    }
  }

  succeed(key: string) {
    this.clients.delete(key);
  }

  size() {
    return this.clients.size;
  }

  sweep(now = Date.now()) {
    for (const [k, b] of this.clients) {
      if (b.lockedUntil <= now && now - b.windowStart > this.o.windowMs) this.clients.delete(k);
    }
    this.trimGlobal(now);
  }

  private trimGlobal(now: number) {
    const cutoff = now - this.o.windowMs;
    let i = 0;
    while (i < this.globalFailures.length && this.globalFailures[i] < cutoff) i++;
    if (i) this.globalFailures.splice(0, i);
  }
}
