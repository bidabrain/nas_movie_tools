<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowRight, Clapperboard, RotateCcw, Search, Trash2, Wand2 } from 'lucide-vue-next';
import { api, basename, episodeLabel, fmtSize, fmtTime, hideImg, type HistoryRow, type TmdbItem } from '../api';
import Modal from '../components/Modal.vue';
import StatusBadge from '../components/StatusBadge.vue';
import { toast } from '../toast';

const route = useRoute();
const router = useRouter();
const status = ref((route.query.status as string) ?? '');
const q = ref('');
const page = ref(1);
const data = ref<{ total: number; items: HistoryRow[]; pageSize: number }>({ total: 0, items: [], pageSize: 30 });
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const qs = new URLSearchParams({ page: String(page.value), status: status.value, q: q.value });
    data.value = await api(`/history?${qs}`);
  } catch (e) {
    toast.error(e);
  } finally {
    loading.value = false;
  }
}
watch(status, (s) => {
  page.value = 1;
  router.replace({ query: s ? { status: s } : {} });
  void load();
});
let searchTimer: number | undefined;
watch(q, () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 300);
});
watch(page, load);
let refresh: number | undefined;
onMounted(() => {
  void load();
  refresh = window.setInterval(() => !fixing.value && load(), 15000);
});
onBeforeUnmount(() => clearInterval(refresh));

async function retry(r: HistoryRow) {
  try {
    await api(`/history/${r.id}/retry`, { body: {} });
    toast.success('已重新加入整理队列');
    setTimeout(load, 1500);
  } catch (e) {
    toast.error(e);
  }
}
async function remove(r: HistoryRow) {
  if (!confirm(`删除这条记录？\n${basename(r.src_path)}\n\n只删除记录，不会删除任何文件。删除后下次扫描会重新整理该文件。`)) return;
  try {
    await api(`/history/${r.id}`, { method: 'DELETE' });
    void load();
  } catch (e) {
    toast.error(e);
  }
}

// ---- manual identify
const fixing = ref<HistoryRow | null>(null);
const fq = ref('');
const fkind = ref<'' | 'movie' | 'tv'>('');
const results = ref<TmdbItem[]>([]);
const picked = ref<TmdbItem | null>(null);
const fseason = ref<number | null>(null);
const fepisode = ref<number | null>(null);
const searching = ref(false);

function openFix(r: HistoryRow) {
  fixing.value = r;
  picked.value = null;
  results.value = [];
  fkind.value = r.media_type ?? '';
  fseason.value = r.season;
  fepisode.value = r.episode;
  fq.value = r.title ?? basename(r.src_path).replace(/\.[^.]+$/, '').replace(/[._]/g, ' ');
  void doSearch();
}
async function doSearch() {
  if (!fq.value.trim()) return;
  searching.value = true;
  try {
    results.value = await api<TmdbItem[]>(`/tmdb/search?q=${encodeURIComponent(fq.value)}&kind=${fkind.value}`);
  } catch (e) {
    toast.error(e);
  } finally {
    searching.value = false;
  }
}
async function applyFix() {
  if (!fixing.value || !picked.value) return;
  try {
    await api(`/history/${fixing.value.id}/retry`, {
      body: {
        kind: picked.value.kind,
        tmdbId: picked.value.id,
        season: picked.value.kind === 'tv' ? fseason.value ?? 1 : undefined,
        episode: picked.value.kind === 'tv' ? fepisode.value ?? undefined : undefined,
      },
    });
    toast.success(`将按「${picked.value.title}」重新整理`);
    fixing.value = null;
    setTimeout(load, 2000);
  } catch (e) {
    toast.error(e);
  }
}

const shortPath = (p: string) => {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 4 ? `…/${parts.slice(-4).join('/')}` : p;
};
const pages = () => Math.max(1, Math.ceil(data.value.total / data.value.pageSize));
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>整理记录</h1>
        <p>共 {{ data.total }} 条 · 失败的记录可以手动指定 TMDB 条目后重新整理</p>
      </div>
    </div>

    <div class="toolbar">
      <div class="tabs">
        <button v-for="t in [['', '全部'], ['success', '已入库'], ['failed', '失败'], ['skipped', '已跳过'], ['pending', '处理中']]" :key="t[0]" :class="{ active: status === t[0] }" @click="status = t[0]">
          {{ t[1] }}
        </button>
      </div>
      <div class="search">
        <Search :size="16" />
        <input v-model="q" class="input" placeholder="搜索标题或路径" />
      </div>
    </div>

    <div class="card list" :class="{ loading }">
      <div v-for="r in data.items" :key="r.id" class="item">
        <img v-if="r.poster" :src="r.poster" class="poster" loading="lazy" alt="" @error="hideImg" />
        <div v-else class="poster ph"><Clapperboard :size="18" /></div>
        <div class="main">
          <div class="row wrap title-row">
            <span class="title">{{ r.title ?? basename(r.src_path) }}</span>
            <span v-if="r.year" class="muted">({{ r.year }})</span>
            <span v-if="r.media_type === 'tv'" class="badge accent">{{ episodeLabel(r) }}</span>
            <span v-if="r.category" class="badge">{{ r.category }}</span>
            <StatusBadge :status="r.status" />
          </div>
          <div class="paths small">
            <span class="mono ellipsis" :title="r.src_path">{{ basename(r.src_path) }}</span>
            <template v-if="r.dest_path">
              <ArrowRight :size="13" class="muted arrow" />
              <span class="mono ellipsis dest" :title="r.dest_path">{{ shortPath(r.dest_path) }}</span>
            </template>
          </div>
          <div v-if="r.message" class="msg small" :class="r.status">{{ r.message }}</div>
          <div class="muted small">{{ fmtSize(r.size) }} · {{ fmtTime(r.updated_at) }}</div>
        </div>
        <div class="actions">
          <button class="btn sm" title="手动识别" @click="openFix(r)"><Wand2 :size="14" /><span class="hide-sm">手动识别</span></button>
          <button class="btn sm icon" title="重新整理" @click="retry(r)"><RotateCcw :size="14" /></button>
          <button class="btn sm icon danger" title="删除记录" @click="remove(r)"><Trash2 :size="14" /></button>
        </div>
      </div>
      <div v-if="!data.items.length" class="empty">暂无记录</div>
    </div>

    <div v-if="pages() > 1" class="pager">
      <button class="btn sm" :disabled="page <= 1" @click="page--">上一页</button>
      <span class="muted small">{{ page }} / {{ pages() }}</span>
      <button class="btn sm" :disabled="page >= pages()" @click="page++">下一页</button>
    </div>

    <Modal v-if="fixing" title="手动识别" width="720px" @close="fixing = null">
      <div class="mono small muted break" style="margin-bottom: 12px">{{ fixing.src_path }}</div>
      <form class="row" @submit.prevent="doSearch">
        <select v-model="fkind" class="input" style="width: 110px">
          <option value="">全部</option>
          <option value="movie">电影</option>
          <option value="tv">剧集</option>
        </select>
        <input v-model="fq" class="input" placeholder="输入片名搜索 TMDB" />
        <button class="btn primary" :disabled="searching">搜索</button>
      </form>
      <div class="results">
        <button v-for="it in results" :key="`${it.kind}${it.id}`" type="button" class="res" :class="{ picked: picked?.id === it.id && picked?.kind === it.kind }" @click="picked = it">
          <img v-if="it.poster" :src="it.poster" class="poster" alt="" @error="hideImg" />
          <div v-else class="poster ph"><Clapperboard :size="16" /></div>
          <div class="res-main">
            <div class="row wrap">
              <b>{{ it.title }}</b>
              <span class="muted">{{ it.year }}</span>
              <span class="badge" :class="it.kind === 'tv' ? 'accent' : 'info'">{{ it.kind === 'tv' ? '剧集' : '电影' }}</span>
            </div>
            <div class="muted small ellipsis">{{ it.originalTitle }} · TMDB {{ it.id }}</div>
            <div class="small overview">{{ it.overview }}</div>
          </div>
        </button>
        <div v-if="!results.length && !searching" class="empty small">没有结果，换个关键词试试</div>
      </div>
      <div v-if="picked?.kind === 'tv'" class="row" style="margin-top: 14px">
        <div class="field" style="flex: 1">
          <label>季</label>
          <input v-model.number="fseason" type="number" min="0" class="input" />
        </div>
        <div class="field" style="flex: 1">
          <label>集</label>
          <input v-model.number="fepisode" type="number" min="0" class="input" />
        </div>
      </div>
      <template #footer>
        <button class="btn" @click="fixing = null">取消</button>
        <button class="btn primary" :disabled="!picked || (picked.kind === 'tv' && !fepisode && fepisode !== 0)" @click="applyFix">按此条目整理</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.search {
  position: relative;
  width: 280px;
  max-width: 100%;
}
.search svg {
  position: absolute;
  left: 11px;
  top: 10px;
  color: var(--text-3);
}
.search .input {
  padding-left: 34px;
}
.list {
  padding: 0;
}
.list.loading {
  opacity: 0.7;
}
.item {
  display: flex;
  gap: 14px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
  align-items: flex-start;
}
.item:last-child {
  border-bottom: 0;
}
.item > .poster {
  width: 52px;
  height: 78px;
}
.poster.ph {
  display: grid;
  place-items: center;
  color: var(--text-3);
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.title-row {
  gap: 8px;
}
.title {
  font-weight: 650;
  font-size: 14.5px;
}
.paths {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  color: var(--text-2);
}
.paths .ellipsis {
  min-width: 0;
}
.arrow {
  flex: none;
}
.dest {
  color: var(--text);
}
.msg {
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--surface-2);
  width: fit-content;
  max-width: 100%;
}
.msg.failed {
  background: var(--danger-soft);
  color: var(--danger);
}
.msg.skipped {
  background: var(--warn-soft);
  color: var(--warn);
}
.actions {
  display: flex;
  gap: 6px;
  flex: none;
}
.pager {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}
.results {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 420px;
  overflow: auto;
}
.res {
  display: flex;
  gap: 12px;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  cursor: pointer;
}
.res:hover {
  border-color: var(--text-3);
}
.res.picked {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.res .poster {
  width: 46px;
  height: 69px;
}
.res-main {
  min-width: 0;
  flex: 1;
}
.overview {
  color: var(--text-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
@media (max-width: 860px) {
  .item {
    flex-wrap: wrap;
  }
  .actions {
    width: 100%;
    justify-content: flex-end;
  }
}
</style>
