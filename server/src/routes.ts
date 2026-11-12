import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as auth from './auth.js';
import { deleteHistory, getHistory, listHistory, stats } from './history.js';
import * as jellyfin from './integrations/jellyfin.js';
import { sendGotify, sendTelegram } from './integrations/notify.js';
import { log, type LogLevel } from './logger.js';
import { render } from './media/naming.js';
import * as tmdb from './media/tmdb.js';
import { parseWithFolders } from './organizer.js';
import { getSettings, publicSettings, saveSettings, stripMasked, type Settings } from './settings.js';
import { enqueue, queueState, scanAll, scanFolder, watcherStatus } from './watcher.js';
import { version } from './version.js';
import { clientKey, FailureLimiter } from './ratelimit.js';

const PUBLIC_ROUTES = new Set(['/api/auth/state', '/api/auth/login', '/api/auth/setup', '/api/health']);

function setSession(reply: FastifyReply, username: string, secure: boolean) {
  reply.setCookie(auth.SESSION_COOKIE, auth.issueToken(username), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure,
    maxAge: auth.SESSION_TTL_S,
  });
}

const isHttps = (req: FastifyRequest) => req.protocol === 'https';

export async function registerRoutes(app: FastifyInstance) {
  // --------------------------------------------------------------- auth gate
  app.addHook('preHandler', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const route = req.url.split('?')[0];
    if (PUBLIC_ROUTES.has(route)) return;
    const user = auth.readToken(req.cookies[auth.SESSION_COOKIE]);
    if (!user) return reply.code(401).send({ error: '未登录' });
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    if (code >= 500) log.error('接口错误', err);
    reply.code(code === 500 ? 400 : code).send({ error: err.message });
  });

  app.get('/api/health', async () => ({ ok: true, version }));

  app.get('/api/auth/state', async (req) => {
    const user = auth.readToken(req.cookies[auth.SESSION_COOKIE]);
    return { setupRequired: !auth.hasAdmin(), authenticated: !!user, username: user ?? null, version };
  });

  // Login and setup share one limiter: 5 failures per client or 20 overall
  // within 15 minutes lock further attempts.
  const limiter = new FailureLimiter({ perClient: 5, global: 20, windowMs: 15 * 60000, lockMs: 15 * 60000 });
  const tooMany = (reply: FastifyReply, ms: number) =>
    reply
      .code(429)
      .header('Retry-After', Math.ceil(ms / 1000))
      .send({ error: `尝试次数过多，请 ${Math.ceil(ms / 60000)} 分钟后再试` });

  app.post<{ Body: { username: string; password: string; code?: string } }>('/api/auth/setup', async (req, reply) => {
    if (auth.hasAdmin()) return reply.code(409).send({ error: '管理员已存在' });
    const key = clientKey(req);
    const wait = limiter.blockedFor(key);
    if (wait) return tooMany(reply, wait);
    if (!auth.checkSetupCode(req.body?.code)) {
      limiter.fail(key);
      log.warn(`初始化验证码错误：${key}`);
      return reply.code(403).send({ error: '初始化验证码不正确，请在容器日志中查看' });
    }
    auth.setAdmin(req.body.username, req.body.password);
    auth.clearSetupCode();
    limiter.succeed(key);
    setSession(reply, req.body.username.trim(), isHttps(req));
    log.info(`已创建管理员 ${req.body.username.trim()}`);
    return { ok: true };
  });

  app.post<{ Body: { username: string; password: string } }>('/api/auth/login', async (req, reply) => {
    const key = clientKey(req);
    const wait = limiter.blockedFor(key);
    if (wait) return tooMany(reply, wait);
    if (!auth.verify(req.body?.username ?? '', req.body?.password ?? '')) {
      limiter.fail(key);
      log.warn(`登录失败：${key}`);
      return reply.code(401).send({ error: '用户名或密码错误' });
    }
    limiter.succeed(key);
    setSession(reply, req.body.username, isHttps(req));
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(auth.SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post<{ Body: { current: string; username?: string; password: string } }>('/api/auth/password', async (req, reply) => {
    const name = auth.getAdminName()!;
    const key = clientKey(req);
    const wait = limiter.blockedFor(key);
    if (wait) return tooMany(reply, wait);
    if (!auth.verify(name, req.body.current ?? '')) {
      limiter.fail(key);
      return reply.code(400).send({ error: '当前密码不正确' });
    }
    const nextName = req.body.username?.trim() || name;
    auth.setAdmin(nextName, req.body.password);
    auth.rotateSecret();
    setSession(reply, nextName, isHttps(req));
    return { ok: true };
  });

  // --------------------------------------------------------------- dashboard
  app.get('/api/dashboard', async () => {
    const s = getSettings();
    let jf: { ok: boolean; name?: string; version?: string; error?: string; counts?: unknown } = { ok: false };
    if (jellyfin.jellyfinConfigured()) {
      try {
        const [info, counts] = await Promise.all([jellyfin.systemInfo(), jellyfin.counts().catch(() => undefined)]);
        jf = { ok: true, name: info.ServerName, version: info.Version, counts };
      } catch (e) {
        jf = { ok: false, error: (e as Error).message };
      }
    }
    return {
      stats: stats(),
      queue: queueState(),
      folders: s.watchFolders.map((f) => ({ ...f, active: watcherStatus().find((w) => w.id === f.id)?.active ?? false })),
      jellyfin: { configured: jellyfin.jellyfinConfigured(), ...jf },
      tmdbConfigured: !!s.tmdb.apiKey,
      notify: { telegram: s.notify.telegram.enabled, gotify: s.notify.gotify.enabled },
      recent: listHistory({ page: 1, pageSize: 12, status: 'success' }).items,
    };
  });

  // ----------------------------------------------------------------- history
  app.get<{ Querystring: { page?: string; pageSize?: string; status?: string; q?: string } }>('/api/history', async (req) =>
    listHistory({
      page: Number(req.query.page) || 1,
      pageSize: Number(req.query.pageSize) || 30,
      status: req.query.status || undefined,
      q: req.query.q || undefined,
    }),
  );

  app.post<{ Params: { id: string }; Body: { kind?: 'movie' | 'tv'; tmdbId?: number; season?: number; episode?: number } }>(
    '/api/history/:id/retry',
    async (req, reply) => {
      const row = getHistory(Number(req.params.id));
      if (!row) return reply.code(404).send({ error: '记录不存在' });
      const folder = getSettings().watchFolders.find((f) => f.id === row.folder_id);
      if (!folder) return reply.code(400).send({ error: '对应的监控目录已被删除' });
      const available = async (p: string | null) => !!p && (await fs.access(p).then(() => true, () => false));
      if (!(await available(row.src_path)) && !(await available(row.dest_path))) {
        return reply.code(400).send({ error: '源文件和媒体库中的文件都已不存在' });
      }
      const b = req.body ?? {};
      enqueue({
        file: row.src_path,
        folder,
        force: true,
        override: {
          kind: b.kind,
          tmdbId: b.tmdbId ? Number(b.tmdbId) : undefined,
          season: b.season !== undefined && b.season !== null ? Number(b.season) : undefined,
          episode: b.episode !== undefined && b.episode !== null ? Number(b.episode) : undefined,
        },
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>('/api/history/:id', async (req) => {
    deleteHistory(Number(req.params.id));
    return { ok: true };
  });

  // -------------------------------------------------------------------- tmdb
  app.get<{ Querystring: { q: string; kind?: string } }>('/api/tmdb/search', async (req) => {
    const q = (req.query.q ?? '').trim();
    if (!q) return [];
    const results = req.query.kind === 'movie' || req.query.kind === 'tv' ? await tmdb.search(req.query.kind, q) : await tmdb.searchMulti(q);
    return results.slice(0, 20).map((r) => ({ ...r, poster: tmdb.imageUrl(r.posterPath, 'w185') }));
  });

  app.get<{ Querystring: { name: string } }>('/api/parse', async (req) => {
    const s = getSettings();
    const name = req.query.name ?? '';
    const parsed = parseWithFolders(path.join('/root', name), '/root');
    const vars = {
      title: parsed.title,
      original_title: parsed.enTitle,
      en_title: parsed.enTitle,
      year: parsed.year ?? '2024',
      tmdbid: 12345,
      season: parsed.season ?? 1,
      episode: parsed.episode ?? 1,
      resolution: parsed.resolution,
      part: parsed.part,
    };
    return {
      parsed,
      preview: {
        movie: render(s.organize.movieTemplate, vars) + path.extname(name),
        tv: render(s.organize.tvTemplate, vars) + path.extname(name),
      },
    };
  });

  // ---------------------------------------------------------------- settings
  app.get('/api/settings', async () => publicSettings());

  app.put<{ Body: Partial<Settings> }>('/api/settings', async (req) => {
    const patch = stripMasked(structuredClone(req.body ?? {}) as Record<string, unknown>) as Partial<Settings>;
    saveSettings(patch);
    log.info('设置已保存');
    return publicSettings();
  });

  // ------------------------------------------------------------------- scans
  app.post('/api/scan', async () => ({ queued: await scanAll() }));
  app.post<{ Params: { id: string } }>('/api/folders/:id/scan', async (req, reply) => {
    const folder = getSettings().watchFolders.find((f) => f.id === req.params.id);
    if (!folder) return reply.code(404).send({ error: '目录不存在' });
    return { queued: await scanFolder(folder) };
  });

  /** Directory browser for picking source / target folders. */
  app.get<{ Querystring: { path?: string } }>('/api/fs/browse', async (req) => {
    const p = req.query.path?.trim();
    if (!p) {
      if (process.platform === 'win32') {
        const drives: string[] = [];
        for (const l of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
          try {
            await fs.access(`${l}:\\`);
            drives.push(`${l}:\\`);
          } catch {
            /* not present */
          }
        }
        return { path: '', parent: null, dirs: drives.map((d) => ({ name: d, path: d })) };
      }
      return listDir('/');
    }
    return listDir(p);
  });

  async function listDir(p: string) {
    const abs = path.resolve(p);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== '@eaDir' && e.name !== '#recycle')
      .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const parent = path.dirname(abs);
    return { path: abs, parent: parent === abs ? (process.platform === 'win32' ? '' : null) : parent, dirs, home: os.homedir() };
  }

  // ---------------------------------------------------------------- jellyfin
  app.post<{ Body: { url?: string; apiKey?: string } }>('/api/jellyfin/test', async (req) => {
    const b = req.body ?? {};
    const key = !b.apiKey || b.apiKey.startsWith('••') ? undefined : b.apiKey;
    const info = await jellyfin.systemInfo({ url: b.url, apiKey: key });
    return { ok: true, name: info.ServerName, version: info.Version };
  });

  app.get('/api/jellyfin/libraries', async () => {
    const [libs, counts] = await Promise.all([jellyfin.libraries(), jellyfin.counts().catch(() => undefined)]);
    return { libraries: libs, counts };
  });

  app.post<{ Body: { id?: string } }>('/api/jellyfin/refresh', async (req) => {
    await jellyfin.refreshLibrary(req.body?.id);
    log.info(`已请求 Jellyfin 刷新${req.body?.id ? '媒体库' : '全部媒体库'}`);
    return { ok: true };
  });

  // ------------------------------------------------------------------ notify
  app.post<{ Body: { channel: 'telegram' | 'gotify' } }>('/api/notify/test', async (req) => {
    const n = getSettings().notify;
    const msg = { title: '🎬 NAS Movie Tools', body: '这是一条测试通知，收到说明配置正确。' };
    if (req.body.channel === 'telegram') await sendTelegram(msg, n.telegram);
    else await sendGotify(msg, n.gotify);
    return { ok: true };
  });

  // -------------------------------------------------------------------- logs
  app.get<{ Querystring: { after?: string; level?: LogLevel } }>('/api/logs', async (req) =>
    log.since(Number(req.query.after) || 0, req.query.level),
  );
}
