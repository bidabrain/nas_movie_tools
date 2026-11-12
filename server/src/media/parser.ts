/**
 * Filename / folder-name parser.
 *
 * Extracts title (Chinese and Latin), year, season, episode and a few quality
 * hints from typical release names such as
 *   "The.Last.of.Us.S01E03.2160p.WEB-DL.DDP5.1.H.265-NTb.mkv"
 *   "流浪地球2.The.Wandering.Earth.II.2023.2160p.WEB-DL.H265.mkv"
 *   "[SubsPlease] Sousou no Frieren - 05 (1080p) [ABCD1234].mkv"
 *   "庆余年 第二季 第03集.mp4"
 */

export const VIDEO_EXTS = ['.mkv', '.mp4', '.avi', '.ts', '.m2ts', '.mov', '.wmv', '.flv', '.rmvb', '.webm', '.iso', '.mpg', '.mpeg', '.m4v'];
export const SUBTITLE_EXTS = ['.srt', '.ass', '.ssa', '.sub', '.idx', '.sup', '.vtt'];

export interface ParsedName {
  /** Best title to search with. */
  title: string;
  cnTitle?: string;
  enTitle?: string;
  year?: string;
  season?: number;
  episode?: number;
  episodeEnd?: number;
  part?: string;
  resolution?: string;
  /** Hint derived from season/episode markers. */
  kind?: 'movie' | 'tv';
}

const CN_NUM: Record<string, number> = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

export function cnToNumber(s: string): number | undefined {
  if (/^\d+$/.test(s)) return Number(s);
  if (!/^[零一二两三四五六七八九十百]+$/.test(s)) return undefined;
  let total = 0;
  let current = 0;
  for (const ch of s) {
    if (ch === '百') {
      total += (current || 1) * 100;
      current = 0;
    } else if (ch === '十') {
      total += (current || 1) * 10;
      current = 0;
    } else {
      current = CN_NUM[ch] ?? 0;
    }
  }
  return total + current;
}

const STOP_WORDS = new RegExp(
  '^(' +
    [
      '\\d{3,4}[pi]',
      '[248]k',
      'uhd',
      'hdr\\d*',
      'sdr',
      'dv',
      'dovi',
      'remux',
      'blu-?ray',
      'bluray',
      'bdrip',
      'brrip',
      'bd',
      'web(-?dl|rip)?',
      'hdtv',
      'dvdrip',
      'hdrip',
      'x26[45]',
      'h\\.?26[45]',
      'hevc',
      'avc',
      'aac.*',
      'ac3',
      'dts.*',
      'ddp?\\d.*',
      'truehd.*',
      'atmos',
      'flac',
      '10bit',
      '8bit',
      'repack',
      'proper',
      'complete',
      'nf',
      'amzn',
      'dsnp',
      'hmax',
      'atvp',
      'itunes',
      'imax',
      'extended',
      'uncut',
      'internal',
      'multi',
      'chs|cht|chi|eng|gb|big5',
      '国语|粤语|中字|简繁|双语|中英|特效|内封|外挂',
    ].join('|') +
    ')$',
  'i',
);

const NOISE_RE =
  /(\d+(\.\d+)?\s*[MGT]i?B)|(\d{4}[-._]\d{1,2}[-._]\d{1,2})|[★☆]|全\d+[集话話]|[多中国英葡法俄日韩德意西印泰台港粤双文语简繁体特效内封官译外挂]+字幕|\w*字幕组|未删减版?|完结|连载|合集|超清|高清|蓝光|国语|粤语|中字|双语/gi;

const HAS_CJK = /[㐀-鿿豈-﫿]/;

function stripExt(name: string) {
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const ext = name.slice(dot).toLowerCase();
    if (VIDEO_EXTS.includes(ext) || SUBTITLE_EXTS.includes(ext)) return name.slice(0, dot);
  }
  return name;
}

function cleanTitle(s: string): string {
  return s
    .replace(/[._]+/g, ' ')
    .replace(/\s*[-–]\s*$/g, '')
    .replace(/^\s*[-–]\s*/g, '')
    .replace(/[\[\]()【】（）]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseName(raw: string): ParsedName {
  let name = stripExt(raw.trim());
  const out: ParsedName = { title: '' };

  // A bare number ("01.mkv") is an episode number.
  if (/^\d{1,4}$/.test(name)) {
    out.episode = Number(name);
    out.kind = 'tv';
    return out;
  }

  // --- anime style: "[Group] Title - 05 (1080p)" or "[Group][Title][05][1080p]"
  const bracketGroups = [...name.matchAll(/\[([^\]]+)\]|【([^】]+)】/g)].map((m) => (m[1] ?? m[2]).trim());
  const leadingBracket = /^\s*[\[【]/.test(name);
  if (leadingBracket) {
    name = name.replace(/^\s*(\[[^\]]*\]|【[^】]*】)\s*/, '');
    if (/^\s*[\[【]/.test(name) && bracketGroups.length >= 3) {
      // fully bracketed form
      const rest = bracketGroups.slice(1);
      const epIdx = rest.findIndex((g) => /^(EP?)?\d{1,4}(v\d)?$/i.test(g) || /^第?\d{1,4}[集话話]$/.test(g));
      if (epIdx > 0) {
        out.episode = Number(rest[epIdx].match(/\d{1,4}/)![0]);
        out.kind = 'tv';
        name = rest.slice(0, epIdx).join(' ');
      }
    }
  }

  // --- resolution
  const res = name.match(/\b(2160|1080|720|576|480)[pi]\b|\b([248])K\b/i);
  if (res) out.resolution = res[1] ? `${res[1]}p` : `${res[2]}K`;

  // --- season / episode markers
  let cut = name.length; // everything after the first marker is not title
  const mark = (index: number | undefined) => {
    if (index !== undefined && index >= 0 && index < cut) cut = index;
  };

  let m = name.match(/S(\d{1,2})[\s._-]*E[Pp]?(\d{1,4})(?:[\s._-]*(?:E|-E?)(\d{1,4}))?/i);
  if (m) {
    out.season = Number(m[1]);
    out.episode = Number(m[2]);
    if (m[3]) out.episodeEnd = Number(m[3]);
    mark(m.index);
  } else {
    m = name.match(/\b(\d{1,2})x(\d{2,3})\b/i);
    if (m) {
      out.season = Number(m[1]);
      out.episode = Number(m[2]);
      mark(m.index);
    }
  }
  if (out.season === undefined) {
    m = name.match(/(?:^|[\s._\[-])S(?:eason)?[\s._]?(\d{1,2})(?=$|[\s._\]-])/i);
    if (m) {
      out.season = Number(m[1]);
      mark(m.index);
    }
  }
  m = name.match(/第\s*([0-9零一二两三四五六七八九十百]+)\s*季/);
  if (m) {
    out.season ??= cnToNumber(m[1]);
    mark(m.index);
  }
  m = name.match(/第\s*([0-9零一二两三四五六七八九十百]+)\s*[集话話期]/);
  if (m) {
    out.episode ??= cnToNumber(m[1]);
    mark(m.index);
  }
  if (out.episode === undefined) {
    m = name.match(/(?:^|[\s._\[-])EP?(\d{1,4})(?=$|[\s._\]-])/i);
    if (m) {
      out.episode = Number(m[1]);
      mark(m.index);
    }
  }
  if (out.episode === undefined) {
    // "Title - 05" / "Title - 05v2"
    m = name.match(/\s-\s(\d{1,4})(?:v\d)?(?=$|[\s.\[(])/);
    if (m) {
      out.episode = Number(m[1]);
      mark(m.index);
    }
  }
  if (out.season !== undefined || out.episode !== undefined) out.kind = 'tv';

  // --- part / cd
  m = name.match(/[\s._-](part|cd|disc|disk)[\s._]?([0-9a-d]{1,2})(?=$|[\s._-])/i);
  if (m) {
    out.part = `${m[1].toLowerCase()}${m[2]}`;
    mark(m.index);
  }

  // --- year: the last plausible year that is not at the very start
  // ("2012.2009.mkv" -> title 2012 / year 2009, "Blade.Runner.2049.2017" -> year 2017)
  const years = [...name.slice(0, cut).matchAll(/(?<![0-9])(19[2-9]\d|20[0-4]\d)(?![0-9pP])/g)].filter(
    (y) => y.index! > 0,
  );
  if (years.length) {
    const chosen = years[years.length - 1];
    out.year = chosen[1];
    mark(chosen.index);
  }

  // --- title tokens: stop at first technical token
  let head = name.slice(0, cut).replace(NOISE_RE, ' ');
  const tokens = head.split(/[\s._]+/).filter(Boolean);
  const kept: string[] = [];
  for (const t of tokens) {
    if (STOP_WORDS.test(t)) break;
    if (/^[\[(（【].*[\])）】]$/.test(t)) continue;
    kept.push(t);
  }
  head = cleanTitle(kept.join(' '));

  // split CJK vs Latin
  const cnParts: string[] = [];
  const enParts: string[] = [];
  for (const t of head.split(' ')) {
    if (!t) continue;
    if (HAS_CJK.test(t)) {
      // "流浪地球2" or "复仇者联盟4：终局之战" -> keep together
      cnParts.push(t);
    } else if (cnParts.length === 0 || enParts.length > 0 || /[a-z]/i.test(t)) {
      enParts.push(t);
    } else {
      cnParts.push(t); // numbers following a CJK title, e.g. "西游记 2"
    }
  }
  const cn = cnParts.join(' ').replace(/\s*[:：]\s*/g, '：').trim();
  const en = enParts
    .join(' ')
    .replace(/\s+-\s*$/, '')
    .trim();
  if (cn) out.cnTitle = cn;
  if (en && /[a-z0-9]/i.test(en)) out.enTitle = en;
  out.title = out.cnTitle || out.enTitle || head;
  return out;
}

/**
 * Parse a file in the context of its parent folder: the folder usually carries
 * the clean title / year / season while the file carries the episode.
 */
export function parsePath(fileName: string, parentName?: string): ParsedName {
  const file = parseName(fileName);
  if (!parentName) return file;
  const dir = parseName(parentName);
  const weakTitle = !file.title || /^\d+$/.test(file.title) || file.title.length < 2;
  const merged: ParsedName = { ...file };
  if (weakTitle && dir.title) {
    merged.title = dir.title;
    merged.cnTitle = dir.cnTitle;
    merged.enTitle = dir.enTitle;
  } else {
    merged.cnTitle ??= dir.cnTitle;
    merged.enTitle ??= dir.enTitle;
  }
  merged.year ??= dir.year;
  merged.season ??= dir.season;
  merged.resolution ??= dir.resolution;
  if (merged.episode !== undefined && merged.season === undefined) merged.season = 1;
  merged.kind = merged.season !== undefined || merged.episode !== undefined ? 'tv' : file.kind ?? dir.kind;
  return merged;
}
