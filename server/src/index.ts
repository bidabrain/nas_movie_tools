import fs from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { env } from './env.js';
import * as auth from './auth.js';
import { log } from './logger.js';
import { registerRoutes } from './routes.js';
import { version } from './version.js';
import { startWatchers } from './watcher.js';

const app = Fastify({ logger: false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });

await app.register(cookie);
await registerRoutes(app);

if (fs.existsSync(path.join(env.publicDir, 'index.html'))) {
  await app.register(fastifyStatic, { root: env.publicDir, wildcard: false });
  // SPA fallback
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
    return reply.sendFile('index.html');
  });
} else {
  log.warn(`未找到前端文件 ${env.publicDir}，仅提供 API（开发模式请运行 npm run dev:web）`);
}

if (!auth.hasAdmin() && env.adminUser && env.adminPassword) {
  auth.setAdmin(env.adminUser, env.adminPassword);
  log.info(`已根据环境变量创建管理员 ${env.adminUser}`);
}

await app.listen({ port: env.port, host: env.host });
log.info(`NAS Movie Tools v${version} 已启动：http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${env.port}  数据目录 ${env.dataDir}`);

await startWatchers();

const shutdown = async () => {
  log.info('正在关闭…');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
