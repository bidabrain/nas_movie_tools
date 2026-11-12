<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { AlertTriangle, CheckCircle2, Clapperboard, Film, FolderSearch, Loader2, RefreshCw, Tv } from 'lucide-vue-next';
import { api, basename, episodeLabel, fmtTime, hideImg, type HistoryRow, type WatchFolder } from '../api';
import { toast } from '../toast';

interface Dash {
  stats: {
    success: number;
    failed: number;
    skipped: number;
    pending: number;
    today: number;
    movies: number;
    episodes: number;
    daily: { day: string; n: number }[];
  };
  queue: { running?: string; waiting: string[] };
  folders: WatchFolder[];
  jellyfin: { configured: boolean; ok: boolean; name?: string; version?: string; error?: string; counts?: { MovieCount: number; SeriesCount: number; EpisodeCount: number } };
  tmdbConfigured: boolean;
  notify: { telegram: boolean; gotify: boolean };
  recent: HistoryRow[];
}

const d = ref<Dash | null>(null);
const scanning = ref(false);
let timer: number | undefined;

async function load() {
  try {
    d.value = await api<Dash>('/dashboard');
  } catch (e) {
    toast.error(e);
  }
}
async function scan() {
  scanning.value = true;
  try {
    const r = await api<{ queued: number }>('/scan', { method: 'POST' });
    toast.success(r.queued ? `已加入 ${r.queued} 个文件到整理队列` : '没有发现新的文件');
    await load();
  } catch (e) {
    toast.error(e);
  } finally {
    scanning.value = false;
  }
}

onMounted(() => {
  void load();
  timer = window.setInterval(load, 10000);
});
onBeforeUnmount(() => clearInterval(timer));

const days = computed(() => {
  const out: { day: string; n: number; label: string }[] = [];
  for (let i = 13; i >= 0; i--) {
    const dt = new Date(Date.now() - i * 86400000);
    const key = dt.toISOString().slice(0, 10);
    out.push({ day: key, n: d.value?.stats.daily.find((x) => x.day === key)?.n ?? 0, label: `${dt.getMonth() + 1}/${dt.getDate()}` });
  }
  return out;
});
const maxDay = computed(() => Math.max(1, ...days.value.map((x) => x.n)));

const setupTodo = computed(() => {
  if (!d.value) return [];
  const t: { text: string; to: string }[] = [];
  if (!d.value.tmdbConfigured) t.push({ text: '填写 TMDB API Key，用于识别影片和下载海报', to: '/settings' });
  if (!d.value.folders.length) t.push({ text: '添加一个监控目录（下载目录 → 媒体库目录）', to: '/folders' });
  if (!d.value.jellyfin.configured) t.push({ text: '连接 Jellyfin，整理后自动刷新媒体库', to: '/settings?tab=jellyfin' });
  return t;
});
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>概览</h1>
        <p>自动监控下载目录，识别影片并整理到 Jellyfin 媒体库</p>
      </div>
      <button class="btn primary" :disabled="scanning" @click="scan">
        <RefreshCw :size="16" :class="{ spin: scanning }" /> 立即扫描
      </button>
    </div>

    <div v-if="setupTodo.length" class="card todo">
      <h2>开始使用</h2>
      <RouterLink v-for="t in setupTodo" :key="t.text" :to="t.to" class="todo-item">
        <span class="todo-dot" />{{ t.text }}
      </RouterLink>
    </div>

    <div v-if="d" class="stats">
      <div class="card stat">
        <div class="stat-icon accent"><CheckCircle2 :size="18" /></div>
        <div class="stat-num">{{ d.stats.success }}</div>
        <div class="muted small">累计入库 · 今日 {{ d.stats.today }}</div>
      </div>
      <div class="card stat">
        <div class="stat-icon info"><Film :size="18" /></div>
        <div class="stat-num">{{ d.stats.movies }}</div>
        <div class="muted small">电影</div>
      </div>
      <div class="card stat">
        <div class="stat-icon success"><Tv :size="18" /></div>
        <div class="stat-num">{{ d.stats.episodes }}</div>
        <div class="muted small">剧集（集）</div>
      </div>
      <RouterLink to="/history?status=failed" class="card stat link">
        <div class="stat-icon danger"><AlertTriangle :size="18" /></div>
        <div class="stat-num">{{ d.stats.failed }}</div>
        <div class="muted small">识别失败，待处理</div>
      </RouterLink>
    </div>

    <div v-if="d" class="cols">
      <div class="stack">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>最近入库</h2>
              <p>最新整理完成的影片</p>
            </div>
            <RouterLink to="/history" class="btn sm ghost">全部记录</RouterLink>
          </div>
          <div v-if="d.recent.length" class="posters">
            <div v-for="r in d.recent" :key="r.id" class="poster-card" :title="r.dest_path ?? ''">
              <img v-if="r.poster" :src="r.poster" class="poster" loading="lazy" alt="" @error="hideImg" />
              <div v-else class="poster ph"><Clapperboard :size="24" /></div>
              <div class="pc-title ellipsis">{{ r.title }}</div>
              <div class="muted small ellipsis">
                {{ r.media_type === 'tv' ? episodeLabel(r) : r.year }} · {{ fmtTime(r.updated_at) }}
              </div>
            </div>
          </div>
          <div v-else class="empty">还没有整理过的影片</div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h2>近 14 天入库</h2>
              <p>每天成功整理的文件数</p>
            </div>
          </div>
          <div class="bars">
            <div v-for="x in days" :key="x.day" class="bar-col" :title="`${x.label}：${x.n}`">
              <div class="bar-track"><div class="bar" :style="{ height: `${(x.n / maxDay) * 100}%` }" /></div>
              <div class="bar-label">{{ x.label }}</div>
            </div>
          </div>
        </div>
      </div>

      <div class="stack">
        <div class="card">
          <div class="card-head"><h2>服务状态</h2></div>
          <div class="svc">
            <span class="dot" :class="d.jellyfin.ok ? 'on' : d.jellyfin.configured ? 'off' : ''" />
            <div class="svc-main">
              <div class="svc-name">Jellyfin</div>
              <div class="muted small ellipsis">
                {{ d.jellyfin.ok ? `${d.jellyfin.name} · v${d.jellyfin.version}` : d.jellyfin.configured ? d.jellyfin.error : '未配置' }}
              </div>
            </div>
          </div>
          <div v-if="d.jellyfin.counts" class="jf-counts">
            <div><b>{{ d.jellyfin.counts.MovieCount }}</b><span>电影</span></div>
            <div><b>{{ d.jellyfin.counts.SeriesCount }}</b><span>剧集</span></div>
            <div><b>{{ d.jellyfin.counts.EpisodeCount }}</b><span>单集</span></div>
          </div>
          <div class="svc">
            <span class="dot" :class="d.tmdbConfigured ? 'on' : ''" />
            <div class="svc-main">
              <div class="svc-name">TMDB</div>
              <div class="muted small">{{ d.tmdbConfigured ? '已配置' : '未配置' }}</div>
            </div>
          </div>
          <div class="svc">
            <span class="dot" :class="d.notify.telegram || d.notify.gotify ? 'on' : ''" />
            <div class="svc-main">
              <div class="svc-name">通知</div>
              <div class="muted small">
                {{ [d.notify.telegram && 'Telegram', d.notify.gotify && 'Gotify'].filter(Boolean).join(' · ') || '未启用' }}
              </div>
            </div>
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <h2>监控目录</h2>
            <RouterLink to="/folders" class="btn sm ghost">管理</RouterLink>
          </div>
          <div v-if="d.folders.length" class="stack folders">
            <div v-for="f in d.folders" :key="f.id" class="svc">
              <span class="dot" :class="f.enabled ? (f.active ? 'on' : 'off') : ''" />
              <div class="svc-main">
                <div class="svc-name ellipsis">{{ f.name || basename(f.source) }}</div>
                <div class="muted small mono ellipsis">{{ f.source }}</div>
              </div>
            </div>
          </div>
          <div v-else class="empty small"><FolderSearch :size="22" /><br />暂无监控目录</div>
        </div>

        <div class="card">
          <div class="card-head"><h2>整理队列</h2></div>
          <div v-if="d.queue.running" class="svc">
            <Loader2 :size="16" class="spin accent-c" />
            <div class="svc-main">
              <div class="svc-name ellipsis">{{ basename(d.queue.running) }}</div>
              <div class="muted small">正在处理 · 等待 {{ d.queue.waiting.length }} 个</div>
            </div>
          </div>
          <div v-else class="muted small">空闲</div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.todo {
  margin-bottom: 16px;
  border-color: var(--accent);
  background: var(--accent-soft);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.todo h2 {
  margin-bottom: 4px;
}
.todo-item {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--text);
  font-weight: 500;
}
.todo-item:hover {
  color: var(--accent);
}
.todo-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.stats {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 16px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  color: inherit;
}
.stat.link:hover {
  border-color: var(--danger);
}
.stat-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  margin-bottom: 10px;
}
.stat-icon.accent {
  background: var(--accent-soft);
  color: var(--accent);
}
.stat-icon.info {
  background: var(--info-soft);
  color: var(--info);
}
.stat-icon.success {
  background: var(--success-soft);
  color: var(--success);
}
.stat-icon.danger {
  background: var(--danger-soft);
  color: var(--danger);
}
.stat-num {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.02em;
}
.cols {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  align-items: start;
}
.posters {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
  gap: 16px 12px;
}
.poster-card .poster {
  width: 100%;
  aspect-ratio: 2 / 3;
  display: block;
  margin-bottom: 8px;
}
.poster.ph {
  display: grid !important;
  place-items: center;
  color: var(--text-3);
}
.pc-title {
  font-weight: 600;
  font-size: 13px;
}
.bars {
  display: flex;
  gap: 6px;
  height: 140px;
}
.bar-col {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.bar-track {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  border-radius: 6px;
  background: var(--surface-2);
}
.bar {
  width: 100%;
  background: var(--accent);
  border-radius: 6px;
  min-height: 0;
  transition: height 0.3s;
}
.bar-label {
  font-size: 10.5px;
  color: var(--text-3);
  white-space: nowrap;
}
.svc {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}
.svc-main {
  min-width: 0;
  flex: 1;
}
.svc-name {
  font-weight: 600;
}
.jf-counts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin: 4px 0 8px 20px;
}
.jf-counts div {
  background: var(--surface-2);
  border-radius: 8px;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
}
.jf-counts b {
  font-size: 16px;
}
.jf-counts span {
  font-size: 11.5px;
  color: var(--text-3);
}
.folders {
  gap: 0;
}
.accent-c {
  color: var(--accent);
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 1080px) {
  .cols {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 860px) {
  .stats {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
