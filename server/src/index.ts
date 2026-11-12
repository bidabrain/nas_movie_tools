import { env } from './env.js';
import { buildApp } from './app.js';
import * as auth from './auth.js';
import { log } from './logger.js';
import { version } from './version.js';
import { startWatchers } from './watcher.js';

if (!auth.hasAdmin() && env.adminUser && env.adminPassword) {
  auth.setAdmin(env.adminUser, env.adminPassword);
  log.info(`已根据环境变量创建管理员 ${env.adminUser}`);
}

const app = await buildApp(env.publicDir);
await app.listen({ port: env.port, host: env.host });
log.info(`NAS Movie Tools v${version} 已启动：http://${env.host === '0.0.0.0' ? 'localhost' : env.host}:${env.port}  数据目录 ${env.dataDir}`);

const code = auth.ensureSetupCode();
if (code) {
  log.warn('========================================================');
  log.warn(`尚未创建管理员。初始化验证码：${code}`);
  log.warn('在网页中创建管理员时需要填写此验证码（每次重启会重新生成）');
  log.warn('========================================================');
}

await startWatchers();

const shutdown = async () => {
  log.info('正在关闭…');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
