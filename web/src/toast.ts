import { reactive } from 'vue';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

export const toasts = reactive<Toast[]>([]);
let seq = 0;

function push(kind: Toast['kind'], text: string, ms = 3500) {
  const id = ++seq;
  toasts.push({ id, kind, text });
  setTimeout(() => {
    const i = toasts.findIndex((t) => t.id === id);
    if (i >= 0) toasts.splice(i, 1);
  }, ms);
}

export const toast = {
  success: (t: string) => push('success', t),
  error: (t: unknown) => push('error', t instanceof Error ? t.message : String(t), 6000),
  info: (t: string) => push('info', t),
};
