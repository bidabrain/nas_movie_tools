import type { TmdbDetails, TmdbEpisode } from './tmdb.js';

const esc = (s: string | number | undefined) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const tag = (name: string, value: string | number | undefined, attrs = '') =>
  value === undefined || value === '' ? '' : `  <${name}${attrs}>${esc(value)}</${name}>\n`;

function common(d: TmdbDetails) {
  let x = '';
  x += tag('title', d.title);
  x += tag('originaltitle', d.originalTitle);
  x += tag('plot', d.overview);
  x += tag('outline', d.overview);
  x += tag('tagline', d.tagline);
  x += tag('year', d.year);
  x += tag('premiered', d.releaseDate);
  x += tag('rating', d.rating?.toFixed(1));
  x += tag('runtime', d.runtime);
  x += tag('tmdbid', d.id);
  x += tag('uniqueid', d.id, ' type="tmdb" default="true"');
  if (d.imdbId) x += tag('uniqueid', d.imdbId, ' type="imdb"');
  for (const g of d.genres) x += tag('genre', g.name);
  for (const c of d.originCountry) x += tag('country', c);
  for (const s of d.studios.slice(0, 3)) x += tag('studio', s);
  return x;
}

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

export function movieNfo(d: TmdbDetails): string {
  return `${HEAD}<movie>\n${common(d)}</movie>\n`;
}

export function tvshowNfo(d: TmdbDetails): string {
  return `${HEAD}<tvshow>\n${common(d)}</tvshow>\n`;
}

export function episodeNfo(show: TmdbDetails, season: number, ep: number, e?: TmdbEpisode): string {
  let x = '';
  x += tag('title', e?.name || `第 ${ep} 集`);
  x += tag('showtitle', show.title);
  x += tag('season', season);
  x += tag('episode', ep);
  x += tag('plot', e?.overview);
  x += tag('aired', e?.airDate);
  x += tag('rating', e?.rating?.toFixed(1));
  return `${HEAD}<episodedetails>\n${x}</episodedetails>\n`;
}
