import { request } from '../http.js';
import { log } from '../logger.js';
import { getSettings, type Settings } from '../settings.js';

export interface NotifyMessage {
  title: string;
  /** Plain text body; lines separated by \n. */
  body: string;
  image?: string;
  /** Link to the item (TMDB page). */
  link?: string;
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendTelegram(msg: NotifyMessage, conf: Settings['notify']['telegram']) {
  const base = `${(conf.apiBase || 'https://api.telegram.org').replace(/\/+$/, '')}/bot${conf.botToken}`;
  let text = `<b>${escHtml(msg.title)}</b>\n${escHtml(msg.body)}`;
  if (msg.link) text += `\n<a href="${escHtml(msg.link)}">TMDB</a>`;
  const proxy = getSettings().tmdb.proxy || undefined;
  if (msg.image) {
    try {
      await request(`${base}/sendPhoto`, {
        method: 'POST',
        proxy,
        json: { chat_id: conf.chatId, photo: msg.image, caption: text.slice(0, 1024), parse_mode: 'HTML' },
      });
      return;
    } catch (e) {
      log.debug('Telegram sendPhoto 失败，改为发送文本', e);
    }
  }
  await request(`${base}/sendMessage`, {
    method: 'POST',
    proxy,
    json: { chat_id: conf.chatId, text, parse_mode: 'HTML', disable_web_page_preview: !msg.link },
  });
}

export async function sendGotify(msg: NotifyMessage, conf: Settings['notify']['gotify']) {
  const url = `${conf.url.replace(/\/+$/, '')}/message`;
  let md = msg.body.replace(/\n/g, '  \n');
  if (msg.image) md = `![poster](${msg.image})\n\n${md}`;
  if (msg.link) md += `\n\n[TMDB](${msg.link})`;
  const notification: Record<string, unknown> = {};
  if (msg.image) notification.bigImageUrl = msg.image;
  if (msg.link) notification.click = { url: msg.link };
  await request(url, {
    method: 'POST',
    headers: { 'X-Gotify-Key': conf.token },
    json: {
      title: msg.title,
      message: md,
      priority: Number(conf.priority) || 5,
      extras: {
        'client::display': { contentType: 'text/markdown' },
        ...(Object.keys(notification).length ? { 'client::notification': notification } : {}),
      },
    },
  });
}

export async function notify(msg: NotifyMessage) {
  const n = getSettings().notify;
  const jobs: Promise<void>[] = [];
  if (n.telegram.enabled && n.telegram.botToken && n.telegram.chatId) {
    jobs.push(sendTelegram(msg, n.telegram).catch((e) => log.error('Telegram 通知发送失败', e)));
  }
  if (n.gotify.enabled && n.gotify.url && n.gotify.token) {
    jobs.push(sendGotify(msg, n.gotify).catch((e) => log.error('Gotify 通知发送失败', e)));
  }
  await Promise.all(jobs);
}

// ------------------------------------------------- batching of episode events

interface Pending {
  title: string;
  image?: string;
  link?: string;
  lines: string[];
  timer: NodeJS.Timeout;
}
const groups = new Map<string, Pending>();

/**
 * Queue a message under `key` (e.g. "tv:1399:s1"). Messages with the same key
 * that arrive within `windowMs` are merged into one notification.
 */
export function notifyGrouped(key: string, msg: NotifyMessage, line: string, windowMs = 30000) {
  const g = groups.get(key);
  if (g) {
    g.lines.push(line);
    return;
  }
  const entry: Pending = {
    title: msg.title,
    image: msg.image,
    link: msg.link,
    lines: [line],
    timer: setTimeout(() => {
      groups.delete(key);
      const body =
        entry.lines.length === 1
          ? msg.body
          : `${msg.body.split('\n')[0]}\n共 ${entry.lines.length} 个文件：\n${entry.lines.sort((a, b) => a.localeCompare(b)).join('\n')}`;
      void notify({ title: entry.title, body, image: entry.image, link: entry.link });
    }, windowMs),
  };
  groups.set(key, entry);
}
