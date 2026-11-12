import { ProxyAgent, type Dispatcher } from 'undici';

const agents = new Map<string, Dispatcher>();

function dispatcherFor(proxy?: string): Dispatcher | undefined {
  if (!proxy) return undefined;
  let agent = agents.get(proxy);
  if (!agent) {
    agent = new ProxyAgent(proxy);
    agents.set(proxy, agent);
  }
  return agent;
}

export interface HttpOptions extends Omit<RequestInit, 'body'> {
  proxy?: string;
  timeoutMs?: number;
  json?: unknown;
  body?: RequestInit['body'];
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function request(url: string, opts: HttpOptions = {}): Promise<Response> {
  const { proxy, timeoutMs = 20000, json, headers, ...rest } = opts;
  const init: RequestInit & { dispatcher?: Dispatcher } = {
    ...rest,
    headers: { ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(headers as object) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
    signal: AbortSignal.timeout(timeoutMs),
  };
  const dispatcher = dispatcherFor(proxy);
  if (dispatcher) init.dispatcher = dispatcher;
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new HttpError(res.status, `HTTP ${res.status} ${res.statusText}${text ? ` - ${text.slice(0, 200)}` : ''}`);
  }
  return res;
}

export async function getJson<T>(url: string, opts: HttpOptions = {}): Promise<T> {
  const res = await request(url, opts);
  return (await res.json()) as T;
}
