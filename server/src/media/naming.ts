/** Characters not allowed in file names on Windows / SMB shares. */
export function sanitize(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, (ch) => (ch === ':' ? '：' : ch === '?' ? '？' : ch === '"' ? "'" : ' '))
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim();
}

export type TemplateVars = Record<string, string | number | undefined>;

/**
 * Render "{title} ({year})/Season {season}/{title} - S{season:02}E{episode:02}".
 * `{key:0N}` zero-pads numbers. Each path segment is sanitized separately and
 * empty decorations such as " ()" or " - " left by missing values are removed.
 */
export function render(template: string, vars: TemplateVars): string {
  const segments = template.split('/').map((seg) => {
    let out = seg.replace(/\{(\w+)(?::0(\d))?\}/g, (_m, key: string, pad?: string) => {
      const v = vars[key];
      if (v === undefined || v === null || v === '') return '';
      return pad ? String(v).padStart(Number(pad), '0') : String(v);
    });
    out = out
      .replace(/\(\s*\)|\[\s*\]|\[tmdbid-\]|\{\s*\}/g, '')
      .replace(/\s+-\s*$/g, '')
      .replace(/^\s*-\s+/g, '')
      .replace(/\s{2,}/g, ' ');
    return sanitize(out);
  });
  return segments.filter(Boolean).join('/');
}
