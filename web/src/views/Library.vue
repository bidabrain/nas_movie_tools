<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Film, Library, MonitorPlay, Music, RefreshCw, Tv } from 'lucide-vue-next';
import { api } from '../api';
import { toast } from '../toast';

interface Lib {
  id: string;
  name: string;
  type: string;
  paths: string[];
}
const libs = ref<Lib[]>([]);
const counts = ref<{ MovieCount: number; SeriesCount: number; EpisodeCount: number } | null>(null);
const error = ref('');
const loading = ref(true);
const refreshing = ref<string | null>(null);

const typeName: Record<string, string> = { movies: '电影', tvshows: '剧集', music: '音乐', homevideos: '家庭视频', boxsets: '合集', mixed: '混合', books: '书籍' };
const iconFor = (t: string) => (t === 'movies' ? Film : t === 'tvshows' ? Tv : t === 'music' ? Music : MonitorPlay);

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const r = await api<{ libraries: Lib[]; counts?: typeof counts.value }>('/jellyfin/libraries');
    libs.value = r.libraries;
    counts.value = r.counts ?? null;
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function refresh(id?: string) {
  refreshing.value = id ?? 'all';
  try {
    await api('/jellyfin/refresh', { body: { id } });
    toast.success('已请求 Jellyfin 扫描媒体库');
  } catch (e) {
    toast.error(e);
  } finally {
    refreshing.value = null;
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>Jellyfin 媒体库</h1>
        <p>整理完成后会自动通知 Jellyfin 扫描新文件，也可以在这里手动刷新</p>
      </div>
      <button class="btn primary" :disabled="!!refreshing || !!error" @click="refresh()">
        <RefreshCw :size="16" :class="{ spin: refreshing === 'all' }" /> 刷新全部媒体库
      </button>
    </div>

    <div v-if="error" class="card empty">
      <Library :size="28" />
      <div>{{ error }}</div>
      <RouterLink to="/settings?tab=jellyfin" class="btn primary" style="margin-top: 12px">去配置 Jellyfin</RouterLink>
    </div>

    <template v-else>
      <div v-if="counts" class="counts">
        <div class="card"><b>{{ counts.MovieCount }}</b><span class="muted">电影</span></div>
        <div class="card"><b>{{ counts.SeriesCount }}</b><span class="muted">剧集</span></div>
        <div class="card"><b>{{ counts.EpisodeCount }}</b><span class="muted">单集</span></div>
      </div>
      <div class="grid libs">
        <div v-for="l in libs" :key="l.id" class="card lib">
          <div class="card-head">
            <div class="row">
              <span class="lib-icon"><component :is="iconFor(l.type)" :size="18" /></span>
              <div>
                <h2>{{ l.name }}</h2>
                <div class="muted small">{{ typeName[l.type] ?? l.type }}</div>
              </div>
            </div>
            <button class="btn sm" :disabled="!!refreshing" @click="refresh(l.id)">
              <RefreshCw :size="14" :class="{ spin: refreshing === l.id }" /> 刷新
            </button>
          </div>
          <div class="muted small">媒体库路径（Jellyfin 视角）</div>
          <div v-for="p in l.paths" :key="p" class="mono path">{{ p }}</div>
        </div>
      </div>
      <div v-if="!loading && !libs.length" class="card empty">Jellyfin 中还没有媒体库</div>
    </template>
  </div>
</template>

<style scoped>
.counts {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.counts .card {
  display: flex;
  flex-direction: column;
}
.counts b {
  font-size: 26px;
  letter-spacing: -0.02em;
}
.libs {
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
}
.lib-icon {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: var(--accent-soft);
  color: var(--accent);
  display: grid;
  place-items: center;
}
.path {
  margin-top: 6px;
  padding: 6px 10px;
  background: var(--surface-2);
  border-radius: 6px;
  word-break: break-all;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 860px) {
  .libs {
    grid-template-columns: 1fr;
  }
}
</style>
