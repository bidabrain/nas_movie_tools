import { reactive } from 'vue';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const session = reactive({
  ready: false,
  setupRequired: false,
  authenticated: false,
  username: '' as string | null,
  version: '',
});

export async function api<T = unknown>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) {
      session.authenticated = false;
    }
    const msg = (data as { error?: string } | null)?.error ?? `请求失败 (${res.status})`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export async function loadSession() {
  const s = await api<{ setupRequired: boolean; authenticated: boolean; username: string | null; version: string }>('/auth/state');
  Object.assign(session, s, { ready: true });
}

// ---------------------------------------------------------------- types

export type TransferMode = 'hardlink' | 'copy' | 'move' | 'symlink';

export interface CategoryRule {
  name: string;
  genreIds?: string;
  originalLanguage?: string;
  originCountry?: string;
}

export interface WatchFolder {
  id: string;
  name: string;
  source: string;
  target: string;
  enabled: boolean;
  usePolling: boolean;
  mediaType: 'auto' | 'movie' | 'tv';
  mode?: TransferMode | '';
  onlyNew?: boolean;
  since?: string;
  active?: boolean;
}

export interface Settings {
  tmdb: { apiKey: string; language: string; proxy: string; imageBase: string };
  jellyfin: { url: string; apiKey: string; refreshAfterOrganize: boolean; pathMappings: { from: string; to: string }[] };
  organize: {
    mode: TransferMode;
    movieDir: string;
    tvDir: string;
    useCategories: boolean;
    movieTemplate: string;
    tvTemplate: string;
    writeNfo: boolean;
    downloadArtwork: boolean;
    minFileSizeMB: number;
    stableSeconds: number;
    overwrite: 'never' | 'larger' | 'always';
    scanIntervalMinutes: number;
  };
  categories: { movie: CategoryRule[]; tv: CategoryRule[] };
  notify: {
    onSuccess: boolean;
    onFailure: boolean;
    telegram: { enabled: boolean; botToken: string; chatId: string; apiBase: string };
    gotify: { enabled: boolean; url: string; token: string; priority: number };
  };
  watchFolders: WatchFolder[];
}

export interface HistoryRow {
  id: number;
  src_path: string;
  dest_path: string | null;
  folder_id: string | null;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  media_type: 'movie' | 'tv' | null;
  tmdb_id: number | null;
  title: string | null;
  year: string | null;
  season: number | null;
  episode: number | null;
  category: string | null;
  poster: string | null;
  message: string | null;
  size: number | null;
  created_at: string;
  updated_at: string;
}

export interface TmdbItem {
  id: number;
  kind: 'movie' | 'tv';
  title: string;
  originalTitle: string;
  year?: string;
  overview: string;
  poster?: string;
}

// ---------------------------------------------------------------- helpers

export function fmtSize(n?: number | null) {
  if (!n) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i >= 3 ? 2 : 0)} ${u[i]}`;
}

export function fmtTime(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return d.toLocaleDateString('zh-CN');
}

export function episodeLabel(r: Pick<HistoryRow, 'season' | 'episode'>) {
  if (r.episode == null) return '';
  return `S${String(r.season ?? 1).padStart(2, '0')}E${String(r.episode).padStart(2, '0')}`;
}

export const basename = (p?: string | null) => (p ? p.split(/[\\/]/).pop() ?? p : '');

/** Keep the poster box but hide a broken image icon. */
export const hideImg = (e: Event) => ((e.target as HTMLImageElement).style.visibility = 'hidden');
