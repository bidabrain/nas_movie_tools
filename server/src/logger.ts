export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  message: string;
}

const MAX = 1000;
const buffer: LogEntry[] = [];
let seq = 0;

function write(level: LogLevel, message: string, err?: unknown) {
  const detail = err instanceof Error ? `: ${err.message}` : err !== undefined ? `: ${String(err)}` : '';
  const entry: LogEntry = { id: ++seq, time: new Date().toISOString(), level, message: message + detail };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  const line = `${entry.time} [${level.toUpperCase()}] ${entry.message}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else if (level !== 'debug' || process.env.DEBUG) console.log(line);
}

export const log = {
  debug: (m: string, e?: unknown) => write('debug', m, e),
  info: (m: string, e?: unknown) => write('info', m, e),
  warn: (m: string, e?: unknown) => write('warn', m, e),
  error: (m: string, e?: unknown) => write('error', m, e),
  /** Entries newer than `afterId`, newest last. */
  since(afterId = 0, level?: LogLevel): LogEntry[] {
    const order: LogLevel[] = ['debug', 'info', 'warn', 'error'];
    const min = level ? order.indexOf(level) : 0;
    return buffer.filter((e) => e.id > afterId && order.indexOf(e.level) >= min);
  },
};
