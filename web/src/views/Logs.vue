<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { api } from '../api';

interface Entry {
  id: number;
  time: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
}
const entries = ref<Entry[]>([]);
const level = ref<'info' | 'warn' | 'error'>('info');
const follow = ref(true);
const box = ref<HTMLElement | null>(null);
let last = 0;
let timer: number | undefined;

async function poll() {
  try {
    const items = await api<Entry[]>(`/logs?after=${last}&level=${level.value}`);
    if (items.length) {
      last = items[items.length - 1].id;
      entries.value = [...entries.value, ...items].slice(-800);
      if (follow.value) {
        await nextTick();
        box.value?.scrollTo({ top: box.value.scrollHeight });
      }
    }
  } catch {
    /* ignore */
  }
}
watch(level, () => {
  entries.value = [];
  last = 0;
  void poll();
});
onMounted(() => {
  void poll();
  timer = window.setInterval(poll, 3000);
});
onBeforeUnmount(() => clearInterval(timer));
const time = (iso: string) => new Date(iso).toLocaleTimeString('zh-CN', { hour12: false });
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>日志</h1>
        <p>最近 1000 条运行日志（重启后清空）</p>
      </div>
      <div class="row">
        <label class="row small"><input v-model="follow" type="checkbox" /> 自动滚动</label>
        <div class="tabs">
          <button v-for="l in ['info', 'warn', 'error'] as const" :key="l" :class="{ active: level === l }" @click="level = l">
            {{ l === 'info' ? '全部' : l === 'warn' ? '警告' : '错误' }}
          </button>
        </div>
      </div>
    </div>
    <div ref="box" class="card logs mono">
      <div v-for="e in entries" :key="e.id" class="line" :class="e.level">
        <span class="t">{{ time(e.time) }}</span>
        <span class="lv">{{ e.level.toUpperCase() }}</span>
        <span class="m">{{ e.message }}</span>
      </div>
      <div v-if="!entries.length" class="empty">暂无日志</div>
    </div>
  </div>
</template>

<style scoped>
.logs {
  height: calc(100vh - 180px);
  min-height: 300px;
  overflow: auto;
  padding: 12px 0;
  font-size: 12.5px;
}
.line {
  display: flex;
  gap: 12px;
  padding: 3px 16px;
}
.line:hover {
  background: var(--surface-2);
}
.t {
  color: var(--text-3);
  flex: none;
}
.lv {
  width: 44px;
  flex: none;
  font-weight: 700;
  color: var(--info);
}
.warn .lv {
  color: var(--warn);
}
.error .lv {
  color: var(--danger);
}
.error .m {
  color: var(--danger);
}
.m {
  word-break: break-all;
}
</style>
