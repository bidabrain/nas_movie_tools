import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

/** Fresh data dir per test process; must run before importing src modules. */
export function isolateDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmt-test-'));
  process.env.DATA_DIR = dir;
  process.env.DB_PATH = path.join(dir, 'test.db');
  return dir;
}

/** Minimal TMDB stand-in with two movies and one show. */
export async function startMockTmdb(): Promise<{ base: string; close: () => void }> {
  const json = (res: http.ServerResponse, obj: unknown) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const movies: Record<number, object> = {
    1: { id: 1, title: '错误电影', original_title: 'Wrong Movie', release_date: '2001-01-01', genres: [{ id: 18, name: '剧情' }], original_language: 'en', production_countries: [{ iso_3166_1: 'US' }] },
    2: { id: 2, title: '正确电影', original_title: 'Right Movie', release_date: '2020-05-05', genres: [{ id: 18, name: '剧情' }], original_language: 'zh', production_countries: [{ iso_3166_1: 'CN' }] },
  };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url!, 'http://x');
    const p = u.pathname;
    if (p === '/3/search/movie') {
      // everything resolves to the WRONG movie, to exercise manual re-identify
      const q = u.searchParams.get('query') ?? '';
      const y = u.searchParams.get('primary_release_year') ?? '2020';
      return json(res, { results: [{ id: 1, title: '错误电影', original_title: q, release_date: `${y}-01-01`, popularity: 10 }] });
    }
    if (p === '/3/search/tv') return json(res, { results: [] });
    const m = p.match(/^\/3\/movie\/(\d+)$/);
    if (m && movies[Number(m[1])]) return json(res, movies[Number(m[1])]);
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}/3`, close: () => server.close() };
}

export function tree(root: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      out.push(path.relative(root, full).replace(/\\/g, '/') + (e.isDirectory() ? '/' : ''));
      if (e.isDirectory()) walk(full);
    }
  };
  if (fs.existsSync(root)) walk(root);
  return out.sort();
}
