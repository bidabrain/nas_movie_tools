import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseName, parsePath } from '../src/media/parser.js';

const cases: [string, Partial<ReturnType<typeof parseName>>][] = [
  ['The.Last.of.Us.S01E03.2160p.WEB-DL.DDP5.1.H.265-NTb.mkv', { enTitle: 'The Last of Us', season: 1, episode: 3, kind: 'tv', resolution: '2160p' }],
  ['流浪地球2.The.Wandering.Earth.II.2023.2160p.WEB-DL.H265.mkv', { cnTitle: '流浪地球2', enTitle: 'The Wandering Earth II', year: '2023', kind: undefined }],
  ['[SubsPlease] Sousou no Frieren - 05 (1080p) [ABCD1234].mkv', { enTitle: 'Sousou no Frieren', episode: 5, kind: 'tv' }],
  ['[Nekomoe kissaten][Sousou no Frieren][05][1080p][CHS].mp4', { enTitle: 'Sousou no Frieren', episode: 5 }],
  ['庆余年 第二季 第03集.mp4', { cnTitle: '庆余年', season: 2, episode: 3 }],
  ['Oppenheimer.2023.1080p.BluRay.x264-GROUP.mkv', { enTitle: 'Oppenheimer', year: '2023' }],
  ['Blade.Runner.2049.2017.UHD.BluRay.2160p.mkv', { enTitle: 'Blade Runner 2049', year: '2017' }],
  ['2012.2009.1080p.BluRay.mkv', { title: '2012', year: '2009' }],
  ['1917.2019.2160p.mkv', { title: '1917', year: '2019' }],
  ['Avatar.The.Way.of.Water.2022.Part1.mkv', { enTitle: 'Avatar The Way of Water', year: '2022', part: 'part1' }],
  ['Friends.1x05.720p.mkv', { enTitle: 'Friends', season: 1, episode: 5 }],
  ['Show.Name.S02E01-E02.1080p.mkv', { enTitle: 'Show Name', season: 2, episode: 1, episodeEnd: 2 }],
  ['05.mkv', { episode: 5, kind: 'tv' }],
];

for (const [input, expected] of cases) {
  test(`parse ${input}`, () => {
    const r = parseName(input);
    for (const [k, v] of Object.entries(expected)) {
      assert.equal((r as unknown as Record<string, unknown>)[k], v, `${k} of ${input}: got ${JSON.stringify(r)}`);
    }
  });
}

test('folder supplies title and season, file supplies episode', () => {
  const r = parsePath('E07.mkv', 'Breaking.Bad.S03.1080p.BluRay');
  assert.equal(r.enTitle, 'Breaking Bad');
  assert.equal(r.season, 3);
  assert.equal(r.episode, 7);
  assert.equal(r.kind, 'tv');
});
