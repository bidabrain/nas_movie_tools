import fs from 'node:fs/promises';
import path from 'node:path';
import { SUBTITLE_EXTS } from './parser.js';

/** Files this app (or Jellyfin) writes next to media; safe to remove once no video is left. */
const METADATA_RE =
  /^(poster|fanart|folder|banner|logo|clearart|clearlogo|landscape|backdrop|thumb|disc)\.(jpe?g|png|webp)$|^season\d+-(poster|fanart|banner|landscape)\.(jpe?g|png|webp)$|\.nfo$|-thumb\.(jpe?g|png|webp)$/i;

function isInside(child: string, root: string) {
  const rel = path.relative(path.resolve(root), path.resolve(child));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** True when the directory tree holds nothing but metadata files (or nothing). */
async function onlyMetadata(dir: string): Promise<boolean> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!(await onlyMetadata(path.join(dir, e.name)))) return false;
    } else if (!METADATA_RE.test(e.name)) {
      return false;
    }
  }
  return true;
}

export interface CleanupOptions {
  /** Nothing outside this folder is ever touched (the watch folder's target). */
  guardRoot: string;
  /** Empty folders are pruned up to, but not including, this folder (e.g. 电影/华语电影). */
  pruneRoot: string;
  /** Also delete the video itself (false when it was already moved away). */
  removeVideo: boolean;
}

/**
 * Remove a previously organized output: the video at `oldDest`, its own NFO /
 * thumb / subtitles, then each parent folder below `pruneRoot` that is left
 * with metadata only. Returns what was removed.
 */
export async function removeOrganizedOutput(oldDest: string, opts: CleanupOptions): Promise<{ files: string[]; dirs: string[] }> {
  const { guardRoot, pruneRoot, removeVideo } = opts;
  const removed = { files: [] as string[], dirs: [] as string[] };
  if (!isInside(oldDest, guardRoot)) return removed;
  const dir = path.dirname(oldDest);
  const base = path.basename(oldDest, path.extname(oldDest));

  if (removeVideo) {
    try {
      await fs.rm(oldDest);
      removed.files.push(oldDest);
    } catch {
      /* already gone */
    }
  }
  let entries: string[] = [];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return removed;
  }
  for (const name of entries) {
    const ext = path.extname(name).toLowerCase();
    const own =
      name === `${base}.nfo` ||
      (name.startsWith(base) && /^-thumb\.(jpe?g|png|webp)$/i.test(name.slice(base.length))) ||
      (SUBTITLE_EXTS.includes(ext) && name.startsWith(`${base}.`));
    if (own) {
      await fs.rm(path.join(dir, name), { force: true });
      removed.files.push(path.join(dir, name));
    }
  }

  // prune folders that now hold only metadata (season folder, then the title folder…)
  let d = dir;
  const canPrune = pruneRoot === guardRoot || isInside(pruneRoot, guardRoot);
  while (canPrune && isInside(d, pruneRoot)) {
    if (!(await onlyMetadata(d))) break;
    await fs.rm(d, { recursive: true, force: true });
    removed.dirs.push(d);
    d = path.dirname(d);
  }
  return removed;
}
