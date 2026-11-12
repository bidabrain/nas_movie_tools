import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { log } from './logger.js';
import { registerRoutes } from './routes.js';

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Vue binds inline style attributes (:style)
  "style-src 'self' 'unsafe-inline'",
  // posters come from TMDB or a configured image mirror
  "img-src 'self' data: https: http:",
  "connect-src 'self'",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export async function buildApp(publicDir?: string): Promise<FastifyInstance> {
  // trustProxy only affects req.protocol/hostname (X-Forwarded-Proto for the
  // Secure cookie flag); rate limiting never trusts X-Forwarded-For.
  const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Content-Security-Policy', CSP);
    if (req.protocol === 'https') reply.header('Strict-Transport-Security', 'max-age=15552000');
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });

  await app.register(cookie);
  await registerRoutes(app);

  if (publicDir && fs.existsSync(path.join(publicDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: publicDir, wildcard: false });
    // SPA fallback
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  } else if (publicDir) {
    log.warn(`未找到前端文件 ${publicDir}，仅提供 API（开发模式请运行 npm run dev:web）`);
  }
  return app;
}
