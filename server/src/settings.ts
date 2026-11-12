import { randomUUID } from 'node:crypto';
import { kvGet, kvSet } from './db.js';

export type TransferMode = 'hardlink' | 'copy' | 'move' | 'symlink';
export type MediaKind = 'movie' | 'tv';

export interface CategoryRule {
  name: string;
  /** Comma separated TMDB genre ids, e.g. "16,99" */
  genreIds?: string;
  /** Comma separated ISO-639-1 codes, e.g. "zh,cn" */
  originalLanguage?: string;
  /** Comma separated ISO-3166-1 codes, e.g. "CN,TW,HK" */
  originCountry?: string;
}

export interface WatchFolder {
  id: string;
  name: string;
  /** Folder that receives new downloads. */
  source: string;
  /** Library root that organized files go to. */
  target: string;
  enabled: boolean;
  /** Use polling instead of native fs events (needed for SMB/NFS mounts). */
  usePolling: boolean;
  /** Force the media kind, or let the parser decide. */
  mediaType: 'auto' | MediaKind;
  /** Override the global transfer mode for this folder. */
  mode?: TransferMode | '';
}

export interface Settings {
  tmdb: {
    apiKey: string;
    language: string;
    proxy: string;
    imageBase: string;
  };
  jellyfin: {
    url: string;
    apiKey: string;
    refreshAfterOrganize: boolean;
    /** Translate paths seen by this app into paths seen by Jellyfin. */
    pathMappings: { from: string; to: string }[];
  };
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
  categories: {
    movie: CategoryRule[];
    tv: CategoryRule[];
  };
  notify: {
    onSuccess: boolean;
    onFailure: boolean;
    telegram: { enabled: boolean; botToken: string; chatId: string; apiBase: string };
    gotify: { enabled: boolean; url: string; token: string; priority: number };
  };
  watchFolders: WatchFolder[];
}

export const defaultSettings = (): Settings => ({
  tmdb: {
    apiKey: '',
    language: 'zh-CN',
    proxy: '',
    imageBase: 'https://image.tmdb.org/t/p',
  },
  jellyfin: { url: '', apiKey: '', refreshAfterOrganize: true, pathMappings: [] },
  organize: {
    mode: 'hardlink',
    movieDir: '电影',
    tvDir: '剧集',
    useCategories: true,
    movieTemplate: '{title} ({year}) [tmdbid-{tmdbid}]/{title} ({year})',
    tvTemplate: '{title} ({year}) [tmdbid-{tmdbid}]/Season {season}/{title} - S{season:02}E{episode:02}',
    writeNfo: true,
    downloadArtwork: true,
    minFileSizeMB: 50,
    stableSeconds: 10,
    overwrite: 'larger',
    scanIntervalMinutes: 30,
  },
  categories: {
    movie: [
      { name: '动画电影', genreIds: '16' },
      { name: '华语电影', originalLanguage: 'zh,cn,bo,za' },
      { name: '外语电影' },
    ],
    tv: [
      { name: '动漫', genreIds: '16' },
      { name: '纪录片', genreIds: '99' },
      { name: '儿童', genreIds: '10762' },
      { name: '综艺', genreIds: '10764,10767' },
      { name: '国产剧', originCountry: 'CN,TW,HK' },
      { name: '欧美剧', originCountry: 'US,FR,GB,DE,ES,IT,NL,PT,RU,UK,CA,AU' },
      { name: '日韩剧', originCountry: 'JP,KP,KR,TH,IN,SG' },
      { name: '未分类' },
    ],
  },
  notify: {
    onSuccess: true,
    onFailure: true,
    telegram: { enabled: false, botToken: '', chatId: '', apiBase: 'https://api.telegram.org' },
    gotify: { enabled: false, url: '', token: '', priority: 5 },
  },
  watchFolders: [],
});

type Listener = (s: Settings) => void;
const listeners: Listener[] = [];
let cache: Settings | undefined;

function merge<T>(base: T, patch: unknown): T {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) {
    return (patch === undefined ? base : patch) as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    for (const [k, v] of Object.entries(patch)) {
      out[k] = k in out ? merge(out[k], v) : v;
    }
  }
  return out as T;
}

export function getSettings(): Settings {
  if (!cache) cache = merge(defaultSettings(), kvGet<Partial<Settings>>('settings') ?? {});
  return cache;
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = merge(getSettings(), patch);
  next.watchFolders = next.watchFolders.map((f) => ({ ...f, id: f.id || randomUUID() }));
  kvSet('settings', next);
  cache = next;
  for (const l of listeners) {
    try {
      l(next);
    } catch {
      /* listeners log their own errors */
    }
  }
  return next;
}

export function onSettingsChange(l: Listener) {
  listeners.push(l);
}

const SECRET_PATHS: [keyof Settings, string, string][] = [
  ['tmdb', 'apiKey', ''],
  ['jellyfin', 'apiKey', ''],
];
export const MASK = '••••••••';

/** Settings safe to send to the browser: secrets are masked. */
export function publicSettings(): Settings {
  const s = structuredClone(getSettings());
  for (const [group, key] of SECRET_PATHS) {
    const g = s[group] as unknown as Record<string, string>;
    if (g[key]) g[key] = MASK;
  }
  if (s.notify.telegram.botToken) s.notify.telegram.botToken = MASK;
  if (s.notify.gotify.token) s.notify.gotify.token = MASK;
  return s;
}

/** Drop masked placeholders so saving the form does not wipe stored secrets. */
export function stripMasked(patch: Record<string, unknown>): Record<string, unknown> {
  for (const [k, v] of Object.entries(patch)) {
    if (v === MASK) delete patch[k];
    else if (v && typeof v === 'object' && !Array.isArray(v)) stripMasked(v as Record<string, unknown>);
  }
  return patch;
}
