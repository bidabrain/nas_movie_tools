import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isolateDataDir, startMockTmdb, tree } from './helpers.js';

const dataDir = isolateDataDir();
const mock = await startMockTmdb();
process.env.TMDB_API_BASE = mock.base;

const { saveSettings, getSettings, normalizeFolders } = await import('../src/settings.js');
const { organizeFile } = await import('../src/organizer.js');
const { getBySrc } = await import('../src/history.js');
const { arrivedAfterBaseline } = await import('../src/watcher.js');

const src = path.join(dataDir, 'downloads');
const lib = path.join(dataDir, 'media');

before(() => {
  saveSettings({
    tmdb: { apiKey: 'test', language: 'zh-CN', proxy: '', imageBase: 'http://127.0.0.1:9/none' },
    organize: { ...getSettings().organize, writeNfo: true, downloadArtwork: false, minFileSizeMB: 0 },
  });
});
after(() => mock.close());

function folder(mode: 'hardlink' | 'move' | 'copy') {
  return { id: `f-${mode}`, name: mode, source: path.join(src, mode), target: path.join(lib, mode), enabled: true, usePolling: false, mediaType: 'auto' as const, mode };
}

function makeVideo(dir: string, name: string) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, 'video-bytes');
  fs.writeFileSync(f.replace(/\.mkv$/, '.chs.srt'), 'sub');
  return f;
}

for (const mode of ['hardlink', 'copy', 'move'] as const) {
  test(`re-identify replaces the wrong output (${mode})`, async () => {
    const f = folder(mode);
    const video = makeVideo(f.source, 'Some.Movie.2020.1080p.mkv');

    const first = await organizeFile(video, f);
    assert.equal(first.status, 'success');
    assert.equal(first.title, '错误电影');
    const wrongDir = '电影/外语电影/错误电影 (2001) [tmdbid-1]';
    assert.ok(tree(f.target).includes(`${wrongDir}/错误电影 (2001).mkv`));
    assert.ok(tree(f.target).includes(`${wrongDir}/错误电影 (2001).chs.srt`));
    assert.ok(tree(f.target).includes(`${wrongDir}/错误电影 (2001).nfo`));
    // pretend Jellyfin dropped artwork there too
    fs.writeFileSync(path.join(f.target, wrongDir, 'poster.jpg'), 'img');

    const second = await organizeFile(video, f, { kind: 'movie', tmdbId: 2 });
    assert.equal(second.status, 'success');
    assert.equal(second.title, '正确电影');

    const t = tree(f.target);
    assert.ok(!t.some((p) => p.includes('错误电影')), `old output removed, got ${t.join(', ')}`);
    assert.ok(t.includes('电影/华语电影/正确电影 (2020) [tmdbid-2]/正确电影 (2020).mkv'));
    assert.ok(t.includes('电影/华语电影/正确电影 (2020) [tmdbid-2]/正确电影 (2020).chs.srt'));
    assert.ok(t.includes('电影/外语电影/'), 'category folder itself is kept');

    if (mode === 'move') assert.ok(!fs.existsSync(video));
    else assert.ok(fs.existsSync(video), 'source in the download folder is untouched');
    assert.equal(getBySrc(video)?.dest_path, path.join(f.target, '电影/华语电影/正确电影 (2020) [tmdbid-2]/正确电影 (2020).mkv'));
  });
}

test('old output that holds other videos is kept', async () => {
  const f = folder('hardlink');
  const video = makeVideo(path.join(f.source, 'b'), 'Other.Movie.2020.mkv');
  const first = await organizeFile(video, f);
  const dir = path.dirname(first.dest_path!);
  fs.writeFileSync(path.join(dir, 'someone-else.mkv'), 'x'); // unrelated video in the same folder
  await organizeFile(video, f, { kind: 'movie', tmdbId: 2 });
  assert.ok(!fs.existsSync(first.dest_path!), 'our own wrong file is removed');
  assert.ok(fs.existsSync(path.join(dir, 'someone-else.mkv')), 'unrelated video is not touched');
});

test('only-new baseline', () => {
  const [f] = normalizeFolders([], [{ ...folder('hardlink'), id: '', onlyNew: true }], new Date('2026-01-01T00:00:00Z'));
  assert.equal(f.since, '2026-01-01T00:00:00.000Z');
  const old = Date.parse('2025-12-31T00:00:00Z');
  const fresh = Date.parse('2026-01-02T00:00:00Z');
  assert.equal(arrivedAfterBaseline({ mtimeMs: old, ctimeMs: old }, f), false);
  assert.equal(arrivedAfterBaseline({ mtimeMs: fresh, ctimeMs: fresh }, f), true);
  assert.equal(arrivedAfterBaseline({ mtimeMs: old, ctimeMs: fresh }, f), true, 'moved in later (ctime) counts as new');

  // baseline kept while the option stays on, cleared when switched off, retaken when switched on again
  const [kept] = normalizeFolders([f], [{ ...f, since: 'tampered' }], new Date('2027-01-01T00:00:00Z'));
  assert.equal(kept.since, f.since);
  const [off] = normalizeFolders([f], [{ ...f, onlyNew: false }]);
  assert.equal(off.since, undefined);
  const [on] = normalizeFolders([off], [{ ...off, onlyNew: true }], new Date('2027-01-01T00:00:00Z'));
  assert.equal(on.since, '2027-01-01T00:00:00.000Z');
});
