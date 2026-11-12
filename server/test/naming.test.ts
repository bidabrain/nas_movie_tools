import { test } from 'node:test';
import assert from 'node:assert/strict';
import { render, sanitize } from '../src/media/naming.js';
import { classify } from '../src/media/category.js';
import { defaultSettings } from '../src/settings.js';

test('render tv template with padding', () => {
  const out = render('{title} ({year}) [tmdbid-{tmdbid}]/Season {season}/{title} - S{season:02}E{episode:02}', {
    title: '绝命毒师',
    year: '2008',
    tmdbid: 1396,
    season: 3,
    episode: 7,
  });
  assert.equal(out, '绝命毒师 (2008) [tmdbid-1396]/Season 3/绝命毒师 - S03E07');
});

test('render drops empty decorations', () => {
  assert.equal(render('{title} ({year}) [tmdbid-{tmdbid}]/{title} ({year})', { title: 'X' }), 'X/X');
});

test('sanitize removes illegal characters', () => {
  assert.equal(sanitize('Mission: Impossible?'), 'Mission： Impossible？');
  assert.equal(sanitize('a/b\\c'), 'a b c');
});

test('classify with default rules', () => {
  const { movie, tv } = defaultSettings().categories;
  assert.equal(classify(movie, { genres: [{ id: 16, name: '' }], originalLanguage: 'ja', originCountry: ['JP'] }), '动画电影');
  assert.equal(classify(movie, { genres: [{ id: 18, name: '' }], originalLanguage: 'zh', originCountry: ['CN'] }), '华语电影');
  assert.equal(classify(movie, { genres: [{ id: 18, name: '' }], originalLanguage: 'en', originCountry: ['US'] }), '外语电影');
  assert.equal(classify(tv, { genres: [{ id: 18, name: '' }], originalLanguage: 'ko', originCountry: ['KR'] }), '日韩剧');
  assert.equal(classify(tv, { genres: [{ id: 18, name: '' }], originalLanguage: 'xx', originCountry: ['ZZ'] }), '未分类');
});
