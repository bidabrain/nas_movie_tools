import { getJson, request } from '../http.js';
import { log } from '../logger.js';
import { getSettings } from '../settings.js';

export interface JellyfinLibrary {
  id: string;
  name: string;
  type: string;
  paths: string[];
}

function conf(override?: { url?: string; apiKey?: string }) {
  const s = getSettings().jellyfin;
  const url = (override?.url ?? s.url).trim().replace(/\/+$/, '');
  const apiKey = (override?.apiKey ?? s.apiKey).trim();
  if (!url || !apiKey) throw new Error('未配置 Jellyfin 地址或 API Key');
  return { url, headers: { Authorization: `MediaBrowser Token="${apiKey}"`, Accept: 'application/json' } };
}

export function jellyfinConfigured() {
  const s = getSettings().jellyfin;
  return !!(s.url && s.apiKey);
}

export async function systemInfo(override?: { url?: string; apiKey?: string }) {
  const { url, headers } = conf(override);
  return getJson<{ ServerName: string; Version: string; OperatingSystem?: string; Id: string }>(`${url}/System/Info`, {
    headers,
    timeoutMs: 8000,
  });
}

export async function libraries(): Promise<JellyfinLibrary[]> {
  const { url, headers } = conf();
  const data = await getJson<{ Name: string; ItemId: string; CollectionType?: string; Locations: string[] }[]>(
    `${url}/Library/VirtualFolders`,
    { headers },
  );
  return data.map((v) => ({ id: v.ItemId, name: v.Name, type: v.CollectionType ?? 'mixed', paths: v.Locations ?? [] }));
}

export async function counts() {
  const { url, headers } = conf();
  return getJson<{ MovieCount: number; SeriesCount: number; EpisodeCount: number }>(`${url}/Items/Counts`, { headers });
}

export async function refreshLibrary(id?: string) {
  const { url, headers } = conf();
  const target = id
    ? `${url}/Items/${encodeURIComponent(id)}/Refresh?Recursive=true&MetadataRefreshMode=Default&ImageRefreshMode=Default`
    : `${url}/Library/Refresh`;
  await request(target, { method: 'POST', headers });
}

/** Tell Jellyfin that files were added so it scans only those paths. */
export type UpdateType = 'Created' | 'Modified' | 'Deleted';

export async function notifyPaths(updates: { path: string; type: UpdateType }[]) {
  if (!updates.length) return;
  const { url, headers } = conf();
  await request(`${url}/Library/Media/Updated`, {
    method: 'POST',
    headers,
    json: { Updates: updates.map((u) => ({ Path: u.path, UpdateType: u.type })) },
  });
}

// Debounced path notifications: many episodes arriving together cause one call.
const pending = new Map<string, UpdateType>();
let timer: NodeJS.Timeout | undefined;

export function mapPath(local: string): string {
  const norm = local.replace(/\\/g, '/');
  for (const m of getSettings().jellyfin.pathMappings ?? []) {
    const from = m.from.replace(/\\/g, '/').replace(/\/+$/, '');
    if (from && (norm === from || norm.startsWith(`${from}/`))) {
      return m.to.replace(/\/+$/, '') + norm.slice(from.length);
    }
  }
  return local;
}

export function queueRefresh(dir: string, type: UpdateType = 'Created') {
  if (!getSettings().jellyfin.refreshAfterOrganize || !jellyfinConfigured()) return;
  pending.set(mapPath(dir), type);
  clearTimeout(timer);
  timer = setTimeout(async () => {
    const updates = [...pending].map(([path, type]) => ({ path, type }));
    pending.clear();
    try {
      await notifyPaths(updates);
      log.info(`已通知 Jellyfin 扫描 ${updates.length} 个目录`);
    } catch (e) {
      log.warn('通知 Jellyfin 扫描失败，改为刷新整个媒体库', e);
      try {
        await refreshLibrary();
      } catch (e2) {
        log.error('刷新 Jellyfin 媒体库失败', e2);
      }
    }
  }, 15000);
  timer.unref();
}
