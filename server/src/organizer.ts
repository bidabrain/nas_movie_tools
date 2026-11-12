import fs from 'node:fs/promises';
import path from 'node:path';
import { request } from './http.js';
import { getBySrc, otherOwnersOfDest, upsertHistory, type HistoryRow } from './history.js';
import { removeOrganizedOutput } from './media/cleanup.js';
import { queueRefresh } from './integrations/jellyfin.js';
import { notify, notifyGrouped } from './integrations/notify.js';
import { log } from './logger.js';
import { classify } from './media/category.js';
import { render } from './media/naming.js';
import { episodeNfo, movieNfo, tvshowNfo } from './media/nfo.js';
import { parseName, parsePath, SUBTITLE_EXTS, VIDEO_EXTS, type ParsedName } from './media/parser.js';
import * as tmdb from './media/tmdb.js';
import { sameFile, transfer, writeIfMissing } from './media/transfer.js';
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

/**
 * Is the file recorded at `prior.dest_path` really the output made from
 * `input`? Only then may it be deleted when re-identifying.
 */
async function ownsOldOutput(prior: HistoryRow, input: string): Promise<boolean> {
  if (!prior.dest_path) return false;
  if (otherOwnersOfDest(prior.dest_path, prior.src_path) > 0) return false;
  if (await sameFile(input, prior.dest_path)) return true; // hardlink / symlink
  if (prior.status === 'skipped') return false; // dest belonged to another file
  const [a, b] = await Promise.all([fs.stat(input).catch(() => undefined), fs.stat(prior.dest_path).catch(() => undefined)]);
  return !!a && !!b && a.size === b.size; // copy mode
}

async function cleanupOld(prior: HistoryRow, folder: WatchFolder, removeVideo: boolean) {
  const o = getSettings().organize;
  const kindDir = prior.media_type === 'tv' ? o.tvDir : o.movieDir;
  const removed = await removeOrganizedOutput(prior.dest_path!, {
    guardRoot: folder.target,
    pruneRoot: path.join(folder.target, kindDir, prior.category ?? ''),
    removeVideo,
  });
  const n = removed.files.length + removed.dirs.length;
  if (!n) return;
  log.info(`已清理旧的整理结果 ${prior.dest_path}（删除 ${removed.files.length} 个文件、${removed.dirs.length} 个空目录）`);
  // tell Jellyfin about the highest folder that disappeared (or the file itself)
  const gone = removed.dirs.length ? removed.dirs[removed.dirs.length - 1] : prior.dest_path!;
  queueRefresh(gone, 'Deleted');
}

/** Organize one video file. Always records the result in history. */
export async function organizeFile(src: string, folder: WatchFolder, override: Override = {}): Promise<HistoryRow> {
  const s = getSettings();
  const o = s.organize;
  const prior = getBySrc(src);

  // In move mode the source is gone after the first run; re-identifying then
  // relocates the file that already sits in the library.
  let input = src;
  let stat = await fs.stat(src).catch(() => undefined);
  if (!stat && prior?.dest_path) {
    const st = await fs.stat(prior.dest_path).catch(() => undefined);
    if (st) {
      input = prior.dest_path;
      stat = st;
    }
  }
  // Keep what is currently in the library on the record until it is replaced,
  // so a failed re-identify can still clean it up on the next attempt.
  const keep: Partial<HistoryRow> = prior
    ? {
        dest_path: prior.dest_path,
        media_type: prior.media_type,
        tmdb_id: prior.tmdb_id,
        title: prior.title,
        year: prior.year,
        season: prior.season,
        episode: prior.episode,
        category: prior.category,
        poster: prior.poster,
      }
    : {};
  if (!stat) {
    return upsertHistory({ ...keep, src_path: src, folder_id: folder.id, status: 'failed', message: '源文件已不存在' });
  }
  const base: Parameters<typeof upsertHistory>[0] = { ...keep, src_path: src, folder_id: folder.id, status: 'pending', size: stat.size };
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
    const relocating = input !== src;
    const mode = relocating ? 'move' : folder.mode || o.mode;

    // ---- transfer video + subtitles
    const subs = await siblingSubtitles(input);
    const result = await transfer(input, dest, mode, o.overwrite);
    const placed = result !== 'exists';
    const moved = result === 'done';
    if (moved) {
      for (const sub of subs) {
        try {
          await transfer(sub.file, destBase + sub.suffix, mode === 'symlink' ? 'copy' : mode, 'always');
        } catch (e) {
          log.warn(`字幕处理失败 ${path.basename(sub.file)}`, e);
        }
      }
    }

    // ---- remove the output of an earlier (wrong) identification
    if (prior?.dest_path && path.resolve(prior.dest_path) !== path.resolve(dest)) {
      if (relocating) {
        // the video itself was moved; drop its old NFO/thumb and empty folders
        if (moved) await cleanupOld(prior, folder, false);
        else log.warn(`新位置已有文件，保留原位置的文件 ${prior.dest_path}`);
      } else if (await ownsOldOutput(prior, input)) {
        await cleanupOld(prior, folder, true);
      } else {
        log.warn(`旧的整理结果无法确认属于此文件，未删除：${prior.dest_path}`);
      }
    }

    // ---- metadata
    const segs = rel.split('/');
    const topDir = segs.length > 1 ? path.join(root, segs[0]) : destDir;
    if (o.writeNfo) {
      if (kind === 'movie') {
        await writeIfMissing(`${destBase}.nfo`, movieNfo(info), placed);
      } else {
        await writeIfMissing(path.join(topDir, 'tvshow.nfo'), tvshowNfo(info));
        const ep = await tmdb.episode(info.id, season!, episode!);
        await writeIfMissing(`${destBase}.nfo`, episodeNfo(info, season!, episode!, ep), placed);
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
      status: placed ? 'success' : 'skipped',
      size: stat.size,
      dest_path: dest,
      media_type: kind,
      tmdb_id: info.id,
      title: info.title,
      year: info.year ?? null,
      season: season ?? null,
      episode: episode ?? null,
      category: category ?? null,
      poster: tmdb.imageUrl(info.posterPath, 'w342') ?? null,
      message: placed ? null : '目标文件已存在，按覆盖策略跳过',
    });

    if (result === 'same') {
      log.info(`已在媒体库中 ${path.basename(src)} → ${dest}`);
    } else if (moved) {
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
    const row = upsertHistory({ ...base, src_path: src, status: 'failed', message });
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
