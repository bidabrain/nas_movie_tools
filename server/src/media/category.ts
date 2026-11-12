import type { CategoryRule } from '../settings.js';
import type { TmdbDetails } from './tmdb.js';

const list = (s?: string) =>
  (s ?? '')
    .split(/[,，\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

/** First rule whose every non-empty condition matches wins; an empty rule matches everything. */
export function classify(rules: CategoryRule[], info: Pick<TmdbDetails, 'genres' | 'originalLanguage' | 'originCountry'>): string | undefined {
  const genres = info.genres.map((g) => String(g.id));
  const lang = (info.originalLanguage ?? '').toLowerCase();
  const countries = info.originCountry.map((c) => c.toLowerCase());
  for (const rule of rules) {
    const g = list(rule.genreIds);
    const l = list(rule.originalLanguage);
    const c = list(rule.originCountry);
    if (g.length && !g.some((x) => genres.includes(x))) continue;
    if (l.length && !l.includes(lang)) continue;
    if (c.length && !c.some((x) => countries.includes(x))) continue;
    return rule.name;
  }
  return undefined;
}
