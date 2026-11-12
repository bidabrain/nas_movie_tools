import { getJson } from '../http.js';
import { getSettings } from '../settings.js';
import type { ParsedName } from './parser.js';

const API = process.env.TMDB_API_BASE ?? 'https://api.themoviedb.org/3';

export type Kind = 'movie' | 'tv';

export interface TmdbSearchItem {
  id: number;
  kind: Kind;
  title: string;
  originalTitle: string;
  year?: string;
  overview: string;
  posterPath?: string | null;
  popularity: number;
}

export interface TmdbDetails {
  id: number;
  kind: Kind;
  title: string;
  originalTitle: string;
  year?: string;
  releaseDate?: string;
  overview: string;
  tagline?: string;
  rating?: number;
  genres: { id: number; name: string }[];
  originalLanguage?: string;
  originCountry: string[];
  posterPath?: string | null;
  backdropPath?: string | null;
  imdbId?: string;
  runtime?: number;
  studios: string[];
  seasons?: { season_number: number; poster_path: string | null; name: string }[];
}

export interface TmdbEpisode {
  name: string;
  overview: string;
  airDate?: string;
  stillPath?: string | null;
  rating?: number;
}

function auth(): { query: string; headers: Record<string, string> } {
  const key = getSettings().tmdb.apiKey.trim();
  if (!key) throw new Error('未配置 TMDB API Key');
  // v4 "API Read Access Token" is a JWT; v3 key is a 32-char hex string
  if (key.startsWith('eyJ')) return { query: '', headers: { Authorization: `Bearer ${key}` } };
  return { query: `api_key=${encodeURIComponent(key)}`, headers: {} };
}

async function call<T>(pathAndQuery: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const s = getSettings().tmdb;
  const { query, headers } = auth();
  const qs = new URLSearchParams();
  qs.set('language', s.language || 'zh-CN');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') qs.set(k, String(v));
  const url = `${API}${pathAndQuery}?${qs.toString()}${query ? `&${query}` : ''}`;
  return getJson<T>(url, { headers: { Accept: 'application/json', ...headers }, proxy: s.proxy || undefined });
}

interface RawResult {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  popularity?: number;
  media_type?: string;
}

function toItem(r: RawResult, kind: Kind): TmdbSearchItem {
  const date = kind === 'movie' ? r.release_date : r.first_air_date;
  return {
    id: r.id,
    kind,
    title: (kind === 'movie' ? r.title : r.name) ?? '',
    originalTitle: (kind === 'movie' ? r.original_title : r.original_name) ?? '',
    year: date ? date.slice(0, 4) : undefined,
    overview: r.overview ?? '',
    posterPath: r.poster_path,
    popularity: r.popularity ?? 0,
  };
}

export async function search(kind: Kind, query: string, year?: string): Promise<TmdbSearchItem[]> {
  const params: Record<string, string | undefined> = { query, include_adult: 'false' };
  if (year) params[kind === 'movie' ? 'primary_release_year' : 'first_air_date_year'] = year;
  const data = await call<{ results: RawResult[] }>(`/search/${kind}`, params);
  return data.results.map((r) => toItem(r, kind));
}

export async function searchMulti(query: string): Promise<TmdbSearchItem[]> {
  const data = await call<{ results: RawResult[] }>('/search/multi', { query, include_adult: 'false' });
  return data.results
    .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
    .map((r) => toItem(r, r.media_type as Kind));
}

export async function details(kind: Kind, id: number): Promise<TmdbDetails> {
  type Raw = RawResult & {
    genres: { id: number; name: string }[];
    original_language?: string;
    origin_country?: string[];
    production_countries?: { iso_3166_1: string }[];
    backdrop_path?: string | null;
    vote_average?: number;
    tagline?: string;
    imdb_id?: string;
    runtime?: number;
    episode_run_time?: number[];
    production_companies?: { name: string }[];
    networks?: { name: string }[];
    seasons?: { season_number: number; poster_path: string | null; name: string }[];
    external_ids?: { imdb_id?: string };
  };
  const r = await call<Raw>(`/${kind}/${id}`, { append_to_response: 'external_ids' });
  const base = toItem(r, kind);
  const countries = r.origin_country?.length
    ? r.origin_country
    : (r.production_countries ?? []).map((c) => c.iso_3166_1);
  return {
    id: r.id,
    kind,
    title: base.title,
    originalTitle: base.originalTitle,
    year: base.year,
    releaseDate: kind === 'movie' ? r.release_date : r.first_air_date,
    overview: base.overview,
    tagline: r.tagline,
    rating: r.vote_average,
    genres: r.genres ?? [],
    originalLanguage: r.original_language,
    originCountry: countries,
    posterPath: r.poster_path,
    backdropPath: r.backdrop_path,
    imdbId: r.imdb_id ?? r.external_ids?.imdb_id,
    runtime: r.runtime ?? r.episode_run_time?.[0],
    studios: (kind === 'tv' ? r.networks : r.production_companies)?.map((c) => c.name) ?? [],
    seasons: r.seasons,
  };
}

export async function episode(tvId: number, season: number, ep: number): Promise<TmdbEpisode | undefined> {
  try {
    const r = await call<{ name: string; overview: string; air_date?: string; still_path?: string | null; vote_average?: number }>(
      `/tv/${tvId}/season/${season}/episode/${ep}`,
    );
    return { name: r.name, overview: r.overview, airDate: r.air_date, stillPath: r.still_path, rating: r.vote_average };
  } catch {
    return undefined;
  }
}

export function imageUrl(p: string | null | undefined, size = 'original'): string | undefined {
  if (!p) return undefined;
  return `${getSettings().tmdb.imageBase.replace(/\/$/, '')}/${size}${p}`;
}

// ---------------------------------------------------------------- matching

function norm(s: string) {
  return s
    .toLowerCase()
    .replace(/[\s\-_.:：·,，!！?？'"’()（）]/g, '')
    .replace(/&/g, 'and');
}

export function score(item: TmdbSearchItem, query: string, year?: string): number {
  const q = norm(query);
  const t = norm(item.title);
  const o = norm(item.originalTitle);
  let s = 0;
  if (q === t || q === o) s += 100;
  else if (t.startsWith(q) || o.startsWith(q) || q.startsWith(t)) s += 60;
  else if (t.includes(q) || o.includes(q)) s += 40;
  if (year && item.year) {
    const diff = Math.abs(Number(year) - Number(item.year));
    if (diff === 0) s += 50;
    else if (diff === 1) s += 25;
    else s -= 20;
  }
  s += Math.min(item.popularity, 100) / 10;
  return s;
}

/**
 * Identify a parsed name on TMDB. Tries the preferred kind first, with and
 * without year, Chinese and Latin titles, then falls back to the other kind.
 */
export async function identify(parsed: ParsedName, forced?: Kind): Promise<TmdbSearchItem | undefined> {
  const kinds: Kind[] = forced ? [forced] : parsed.kind === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];
  const queries = [...new Set([parsed.cnTitle, parsed.enTitle, parsed.title].filter((q): q is string => !!q && q.length > 0))];
  if (!queries.length) return undefined;
  for (const kind of kinds) {
    let best: { item: TmdbSearchItem; s: number } | undefined;
    for (const q of queries) {
      for (const y of parsed.year ? [parsed.year, undefined] : [undefined]) {
        // TV seasons > 1 usually have a later year than the series' first air date
        const yearForSearch = kind === 'tv' && (parsed.season ?? 1) > 1 ? undefined : y;
        const results = await search(kind, q, yearForSearch);
        for (const item of results.slice(0, 10)) {
          const sc = score(item, q, kind === 'tv' && (parsed.season ?? 1) > 1 ? undefined : parsed.year);
          if (!best || sc > best.s) best = { item, s: sc };
        }
        if (best && best.s >= 140) return best.item;
        if (results.length) break; // got results with year: don't retry without
      }
    }
    if (best && best.s >= 40) return best.item;
  }
  return undefined;
}
