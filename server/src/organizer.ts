import fs from 'node:fs/promises';
import path from 'node:path';
import { request } from './http.js';
import { getBySrc, upsertHistory, type HistoryRow } from './history.js';
import { queueRefresh } from './integrations/jellyfin.js';
import { notify, notifyGrouped } from './integrations/notify.js';
import { log } from './logger.js';
import { classify } from './media/category.js';
import { render } from './media/naming.js';
import { episodeNfo, movieNfo, tvshowNfo } from './media/nfo.js';
import { parseName, parsePath, SUBTITLE_EXTS, VIDEO_EXTS, type ParsedName } from './media/parser.js';
import * as tmdb from './media/tmdb.js';
import { transfer, writeIfMissing } from './media/transfer.js';
import { getSettings, type WatchFolder } from './settings.js';


export interface Override {
  kind?: 'movie' | 'tv';
  tmdbId?: number;
  season?: number;
  episode?: number;
}

export function isVideo(file: string) {
  return VIDEO_EXTS.includes(path.extname(file).toLowerCase());
}

const IGNORED = /(^|[\\/])(\.|@eaDir|#recycle|\$RECYCLE\.BIN|lost\+found)|sample|trailer|预告/i;

export function isIgnored(file: string) {
  return IGNORED.test(path.basename(file)) || /[\\/](@eaDir|#recycle|\.[^\\/]+)[\\/]/i.test(file);
}

/** Parse using the file name plus every folder between the watch root and the file. */
export function parseWithFolders(file: string, root: string): ParsedName {
  const rel = path.relative(root, file);
  const parts = rel.split(/[\\/]/);
  const fileName = parts.pop()!;
  let parsed = parsePath(fileName, parts[parts.length - 1]);
  for (let i = parts.length - 2; i >= 0; i--) {
    const weak = !parsed.title || /^\d+$/.test(parsed.title) || /^(season|s)\s*\d+$/i.test(parsed.title) || /^第.+季$/.test(parsed.title);
    if (!weak && parsed.year) break;
    const outer = parseName(parts[i]);
    if (weak && outer.title) {
      parsed = { ...parsed, title: outer.title, cnTitle: outer.cnTitle, enTitle: outer.enTitle };
    }
    parsed.year ??= outer.year;
    parsed.season ??= outer.season;
  }
  return parsed;
}

async function download(url: string | undefined, file: string) {
  if (!url) return;
  try {
    const res = await request(url, { proxy: getSettings().tmdb.proxy || undefined, timeoutMs: 30000 });
    const buf = Buffer.from(await res.arrayBuffer());
    await writeIfMissing(file, buf);
  } catch (e) {
    log.warn(`下载图片失败 ${path.basename(file)}`, e);
  }
}

async function siblingSubtitles(video: string): Promise<{ file: string; suffix: string }[]> {
  const dir = path.dirname(video);
  const base = path.basename(video, path.extname(video));
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const videos = entries.filter((e) => VIDEO_EXTS.includes(path.extname(e).toLowerCase()));
  return entries
    .filter((e) => SUBTITLE_EXTS.includes(path.extname(e).toLowerCase()))
    .filter((e) => e.startsWith(base) || videos.length === 1)
    .map((e) => {
      const ext = path.extname(e);
      const stem = e.slice(0, -ext.length);
      let suffix = stem.startsWith(base) ? stem.slice(base.length) : '';
      if (!suffix) {
        const lang = stem.match(/[._](chs|cht|sc|tc|zh[-_]?(cn|tw|hans|hant)?|eng?|jpn?|ja|kor?|简体|繁体|简中|繁中|中文|英文)$/i);
        suffix = lang ? `.${lang[1]}` : '';
      }
      return { file: path.join(dir, e), suffix: suffix + ext.toLowerCase() };
    });
}

export class OrganizeError extends Error {}

/** Organize one video file. Always records the result in history. */
export async function organizeFile(src: string, folder: WatchFolder, override: Override = {}): Promise<HistoryRow> {
  const s = getSettings();
  const o = s.organize;
  const stat = await fs.stat(src);
  const base: Parameters<typeof upsertHistory>[0] = { src_path: src, folder_id: folder.id, status: 'pending', size: stat.size };
  upsertHistory(base);

  try {
    // ---- identify
    const parsed = parseWithFolders(src, folder.source);
    const forcedKind = override.kind ?? (folder.mediaType !== 'auto' ? folder.mediaType : undefined);
    if (override.season !== undefined) parsed.season = override.season;
    if (override.episode !== undefined) parsed.episode = override.episode;
    let kind: 'movie' | 'tv';
    let id: number;
    if (override.tmdbId) {
      kind = forcedKind ?? (parsed.kind === 'tv' ? 'tv' : 'movie');
      id = override.tmdbId;
    } else {
      const hit = await tmdb.identify(parsed, forcedKind);
      if (!hit) throw new OrganizeError(`TMDB 未找到匹配：${parsed.title || path.basename(src)}${parsed.year ? ` (${parsed.year})` : ''}`);
      kind = hit.kind;
      id = hit.id;
    }
    const info = await tmdb.details(kind, id);
    const season = kind === 'tv' ? parsed.season ?? 1 : undefined;
    const episode = kind === 'tv' ? parsed.episode : undefined;
    if (kind === 'tv' && episode === undefined) throw new OrganizeError(`无法从文件名识别集数：${path.basename(src)}`);

    // ---- destination
    const rules = kind === 'movie' ? s.categories.movie : s.categories.tv;
    const category = o.useCategories ? classify(rules, info) : undefined;
    const root = path.join(folder.target, kind === 'movie' ? o.movieDir : o.tvDir, category ?? '');
    const vars = {
      title: info.title,
      original_title: info.originalTitle,
      en_title: parsed.enTitle,
      year: info.year,
      tmdbid: info.id,
      season,
      episode,
      episode_end: parsed.episodeEnd,
      resolution: parsed.resolution,
      part: parsed.part,
    };
    let rel = render(kind === 'movie' ? o.movieTemplate : o.tvTemplate, vars);
    if (!rel) throw new OrganizeError('命名模板渲染结果为空');
    if (kind === 'movie' && parsed.part) rel += ` - ${parsed.part}`;
    if (kind === 'tv' && parsed.episodeEnd && !/episode_end/.test(o.tvTemplate)) {
      rel += `-E${String(parsed.episodeEnd).padStart(2, '0')}`;
    }
    const ext = path.extname(src).toLowerCase();
    const dest = path.join(root, rel + ext);
    const destDir = path.dirname(dest);
    const destBase = path.join(destDir, path.basename(dest, ext));
    const mode = folder.mode || o.mode;

    // ---- transfer video + subtitles
    const subs = await siblingSubtitles(src);
    const moved = await transfer(src, dest, mode, o.overwrite);
    if (moved) {
      for (const sub of subs) {
        try {
          await transfer(sub.file, destBase + sub.suffix, mode === 'symlink' ? 'copy' : mode, 'always');
        } catch (e) {
          log.warn(`字幕处理失败 ${path.basename(sub.file)}`, e);
        }
      }
    }

    // ---- metadata
    const segs = rel.split('/');
    const topDir = segs.length > 1 ? path.join(root, segs[0]) : destDir;
    if (o.writeNfo) {
      if (kind === 'movie') {
        await writeIfMissing(`${destBase}.nfo`, movieNfo(info), moved);
      } else {
        await writeIfMissing(path.join(topDir, 'tvshow.nfo'), tvshowNfo(info));
        const ep = await tmdb.episode(info.id, season!, episode!);
        await writeIfMissing(`${destBase}.nfo`, episodeNfo(info, season!, episode!, ep), moved);
        if (o.downloadArtwork && ep?.stillPath) await download(tmdb.imageUrl(ep.stillPath, 'w780'), `${destBase}-thumb.jpg`);
      }
    }
    if (o.downloadArtwork) {
      await download(tmdb.imageUrl(info.posterPath), path.join(topDir, 'poster.jpg'));
      await download(tmdb.imageUrl(info.backdropPath), path.join(topDir, 'fanart.jpg'));
      if (kind === 'tv') {
        const sp = info.seasons?.find((x) => x.season_number === season)?.poster_path;
        if (sp) await download(tmdb.imageUrl(sp), path.join(topDir, `season${String(season).padStart(2, '0')}-poster.jpg`));
      }
    }

    const row = upsertHistory({
      ...base,
      status: moved ? 'success' : 'skipped',
      dest_path: dest,
      media_type: kind,
      tmdb_id: info.id,
      title: info.title,
      year: info.year ?? null,
      season: season ?? null,
      episode: episode ?? null,
      category: category ?? null,
      poster: tmdb.imageUrl(info.posterPath, 'w342') ?? null,
      message: moved ? null : '目标文件已存在，按覆盖策略跳过',
    });

    if (moved) {
      log.info(`整理完成 ${path.basename(src)} → ${dest}`);
      queueRefresh(topDir);
      if (s.notify.onSuccess) {
        const label = kind === 'tv' ? `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}` : '';
        const msg = {
          title: `✅ ${info.title}${info.year ? ` (${info.year})` : ''} 已入库`,
          body: [
            `类型：${kind === 'movie' ? '电影' : '剧集'}${category ? ` · ${category}` : ''}`,
            label ? `集数：${label}` : '',
            info.rating ? `评分：${info.rating.toFixed(1)}` : '',
            info.overview ? `简介：${info.overview.slice(0, 120)}${info.overview.length > 120 ? '…' : ''}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
          image: tmdb.imageUrl(info.backdropPath ?? info.posterPath, 'w780'),
          link: `https://www.themoviedb.org/${kind}/${info.id}`,
        };
        if (kind === 'tv') notifyGrouped(`tv:${info.id}:${season}`, msg, `• ${label} ${path.basename(dest)}`);
        else void notify(msg);
      }
    } else {
      log.info(`目标已存在，跳过 ${path.basename(src)}`);
    }
    return row;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`整理失败 ${path.basename(src)}`, e);
    const row = upsertHistory({ ...base, status: 'failed', message });
    if (getSettings().notify.onFailure) {
      void notify({ title: '⚠️ 整理失败', body: `${path.basename(src)}\n${message}` });
    }
    return row;
  }
}

/** Should this path be (re)processed? */
export function needsProcessing(src: string, size: number) {
  const h = getBySrc(src);
  if (!h) return true;
  if (h.status === 'pending') return true; // interrupted run; the queue de-duplicates
  if (h.status === 'success' || h.status === 'skipped') return h.size !== size;
  return false; // failed: wait for a manual retry
}
