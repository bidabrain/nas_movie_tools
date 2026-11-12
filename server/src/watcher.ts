import fs from 'node:fs/promises';
import path from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';
import { log } from './logger.js';
import { isIgnored, isVideo, needsProcessing, organizeFile, type Override } from './organizer.js';
import { getSettings, onSettingsChange, type WatchFolder } from './settings.js';

interface Job {
  file: string;
  folder: WatchFolder;
  override?: Override;
  force?: boolean;
}

const queue: Job[] = [];
const queued = new Set<string>();
let running: string | undefined;
const watchers = new Map<string, FSWatcher>();
let scanTimer: NodeJS.Timeout | undefined;

export function queueState() {
  return { running, waiting: queue.map((j) => j.file) };
}

export function enqueue(job: Job) {
  if (queued.has(job.file)) return false;
  queued.add(job.file);
  queue.push(job);
  void pump();
  return true;
}

async function pump() {
  if (running) return;
  const job = queue.shift();
  if (!job) return;
  running = job.file;
  try {
    const stat = await fs.stat(job.file).catch(() => undefined);
    if (!stat) {
      log.debug(`文件已不存在，跳过 ${job.file}`);
    } else if (!job.force && stat.size < getSettings().organize.minFileSizeMB * 1024 * 1024) {
      log.debug(`文件过小，跳过 ${job.file}`);
    } else if (job.force || needsProcessing(job.file, stat.size)) {
      await organizeFile(job.file, job.folder, job.override);
    }
  } catch (e) {
    log.error(`处理 ${job.file} 时出错`, e);
  } finally {
    queued.delete(job.file);
    running = undefined;
    setImmediate(() => void pump());
  }
}

function insideTarget(file: string, folder: WatchFolder) {
  const rel = path.relative(path.resolve(folder.target), path.resolve(file));
  return !rel.startsWith('..') && !path.isAbsolute(rel);
}

function consider(file: string, folder: WatchFolder) {
  if (!isVideo(file) || isIgnored(file) || insideTarget(file, folder)) return;
  enqueue({ file, folder });
}

async function walk(dir: string, out: string[], depth = 0) {
  if (depth > 8) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    log.warn(`无法读取目录 ${dir}`, e);
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!isIgnored(full + path.sep)) await walk(full, out, depth + 1);
    } else if (e.isFile() && isVideo(e.name)) out.push(full);
  }
}

/** Walk a folder and queue every video that has not been organized yet. */
export async function scanFolder(folder: WatchFolder): Promise<number> {
  const files: string[] = [];
  await walk(folder.source, files);
  const stableMs = getSettings().organize.stableSeconds * 1000;
  let n = 0;
  for (const f of files) {
    if (isIgnored(f) || insideTarget(f, folder)) continue;
    const st = await fs.stat(f).catch(() => undefined);
    if (!st || Date.now() - st.mtimeMs < stableMs) continue; // still being written
    if (needsProcessing(f, st.size) && enqueue({ file: f, folder })) n++;
  }
  if (n) log.info(`扫描「${folder.name || folder.source}」发现 ${n} 个待整理文件`);
  return n;
}

export async function scanAll() {
  let n = 0;
  for (const f of getSettings().watchFolders.filter((x) => x.enabled)) n += await scanFolder(f);
  return n;
}

async function stopAll() {
  await Promise.all([...watchers.values()].map((w) => w.close()));
  watchers.clear();
}

export async function startWatchers() {
  await stopAll();
  const s = getSettings();
  lastSig = JSON.stringify([s.watchFolders, s.organize.stableSeconds, s.organize.scanIntervalMinutes]);
  for (const folder of s.watchFolders) {
    if (!folder.enabled || !folder.source) continue;
    try {
      await fs.access(folder.source);
    } catch {
      log.error(`监控目录不存在或无权限：${folder.source}`);
      continue;
    }
    const w = chokidar.watch(folder.source, {
      ignoreInitial: true,
      persistent: true,
      usePolling: folder.usePolling,
      interval: 5000,
      binaryInterval: 10000,
      depth: 8,
      awaitWriteFinish: { stabilityThreshold: Math.max(2, s.organize.stableSeconds) * 1000, pollInterval: 1000 },
      ignored: (p: string) => isIgnored(p) || insideTarget(p, folder),
    });
    w.on('add', (file) => consider(file, folder));
    w.on('change', (file) => consider(file, folder));
    w.on('error', (e) => log.error(`监控出错 ${folder.source}`, e));
    watchers.set(folder.id, w);
    log.info(`开始监控 ${folder.source}${folder.usePolling ? '（轮询模式）' : ''}`);
  }
  clearInterval(scanTimer);
  const minutes = s.organize.scanIntervalMinutes;
  if (minutes > 0) scanTimer = setInterval(() => void scanAll(), minutes * 60000);
  void scanAll();
}

export function watcherStatus() {
  return getSettings().watchFolders.map((f) => ({ id: f.id, active: watchers.has(f.id) }));
}

let restartTimer: NodeJS.Timeout | undefined;
let lastSig = '';
onSettingsChange((s) => {
  const sig = JSON.stringify([s.watchFolders, s.organize.stableSeconds, s.organize.scanIntervalMinutes]);
  if (sig === lastSig) return;
  lastSig = sig;
  clearTimeout(restartTimer);
  restartTimer = setTimeout(() => void startWatchers(), 500);
});
