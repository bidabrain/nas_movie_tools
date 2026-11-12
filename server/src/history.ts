import { db } from './db.js';

export type Status = 'pending' | 'success' | 'failed' | 'skipped';

export interface HistoryRow {
  id: number;
  src_path: string;
  dest_path: string | null;
  folder_id: string | null;
  status: Status;
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

export type HistoryInput = Partial<Omit<HistoryRow, 'id' | 'created_at' | 'updated_at'>> & { src_path: string; status: Status };

const COLS = [
  'dest_path',
  'folder_id',
  'status',
  'media_type',
  'tmdb_id',
  'title',
  'year',
  'season',
  'episode',
  'category',
  'poster',
  'message',
  'size',
] as const;

export function upsertHistory(input: HistoryInput): HistoryRow {
  const now = new Date().toISOString();
  const values = COLS.map((c) => (input[c] === undefined ? null : input[c]));
  db.prepare(
    `INSERT INTO history (src_path, ${COLS.join(', ')}, created_at, updated_at)
     VALUES (?, ${COLS.map(() => '?').join(', ')}, ?, ?)
     ON CONFLICT(src_path) DO UPDATE SET ${COLS.map((c) => `${c} = excluded.${c}`).join(', ')}, updated_at = excluded.updated_at`,
  ).run(input.src_path, ...(values as (string | number | null)[]), now, now);
  return getBySrc(input.src_path)!;
}

export function getBySrc(src: string): HistoryRow | undefined {
  return db.prepare('SELECT * FROM history WHERE src_path = ?').get(src) as HistoryRow | undefined;
}

/** Other records that claim the same organized file (so it must not be deleted). */
export function otherOwnersOfDest(dest: string, src: string): number {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM history WHERE dest_path = ? AND src_path <> ? AND status = 'success'").get(dest, src) as {
      n: number;
    }
  ).n;
}

export function getHistory(id: number): HistoryRow | undefined {
  return db.prepare('SELECT * FROM history WHERE id = ?').get(id) as HistoryRow | undefined;
}

export function deleteHistory(id: number) {
  db.prepare('DELETE FROM history WHERE id = ?').run(id);
}

export function listHistory(opts: { page?: number; pageSize?: number; status?: string; q?: string }) {
  const page = Math.max(1, opts.page ?? 1);
  const size = Math.min(200, Math.max(1, opts.pageSize ?? 30));
  const where: string[] = [];
  const args: (string | number)[] = [];
  if (opts.status) {
    where.push('status = ?');
    args.push(opts.status);
  }
  if (opts.q) {
    where.push('(title LIKE ? OR src_path LIKE ? OR dest_path LIKE ?)');
    const like = `%${opts.q}%`;
    args.push(like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM history ${w}`).get(...args) as { n: number }).n;
  const items = db
    .prepare(`SELECT * FROM history ${w} ORDER BY updated_at DESC LIMIT ? OFFSET ?`)
    .all(...args, size, (page - 1) * size) as unknown as HistoryRow[];
  return { total, page, pageSize: size, items };
}

export function stats() {
  const by = db.prepare('SELECT status, COUNT(*) AS n FROM history GROUP BY status').all() as { status: Status; n: number }[];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const t = db
    .prepare("SELECT COUNT(*) AS n FROM history WHERE status = 'success' AND updated_at >= ?")
    .get(today.toISOString()) as { n: number };
  const kinds = db
    .prepare("SELECT media_type, COUNT(*) AS n FROM history WHERE status = 'success' GROUP BY media_type")
    .all() as { media_type: string; n: number }[];
  const daily = db
    .prepare(
      "SELECT substr(updated_at, 1, 10) AS day, COUNT(*) AS n FROM history WHERE status = 'success' AND updated_at >= ? GROUP BY day ORDER BY day",
    )
    .all(new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10)) as { day: string; n: number }[];
  const count = (s: Status) => by.find((b) => b.status === s)?.n ?? 0;
  return {
    success: count('success'),
    failed: count('failed'),
    skipped: count('skipped'),
    pending: count('pending'),
    today: t.n,
    movies: kinds.find((k) => k.media_type === 'movie')?.n ?? 0,
    episodes: kinds.find((k) => k.media_type === 'tv')?.n ?? 0,
    daily,
  };
}
