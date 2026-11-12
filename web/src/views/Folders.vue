<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ArrowDown, FolderInput, FolderOutput, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-vue-next';
import { api, basename, type Settings, type WatchFolder } from '../api';
import Modal from '../components/Modal.vue';
import PathInput from '../components/PathInput.vue';
import Toggle from '../components/Toggle.vue';
import { toast } from '../toast';

const folders = ref<WatchFolder[]>([]);
const globalMode = ref('hardlink');
const libs = ref<{ name: string; paths: string[] }[]>([]);
const editing = ref<WatchFolder | null>(null);
const isNew = ref(false);

const modeLabel: Record<string, string> = { hardlink: '硬链接', copy: '复制', move: '移动', symlink: '软链接' };
const typeLabel: Record<string, string> = { auto: '自动识别', movie: '仅电影', tv: '仅剧集' };

async function load() {
  try {
    const [dash, s] = await Promise.all([api<{ folders: WatchFolder[] }>('/dashboard'), api<Settings>('/settings')]);
    folders.value = dash.folders;
    globalMode.value = s.organize.mode;
  } catch (e) {
    toast.error(e);
  }
  api<{ libraries: { name: string; paths: string[] }[] }>('/jellyfin/libraries')
    .then((r) => (libs.value = r.libraries))
    .catch(() => undefined);
}
onMounted(load);

async function persist(list: WatchFolder[]) {
  const clean = list.map(({ active: _a, ...f }) => f);
  await api('/settings', { method: 'PUT', body: { watchFolders: clean } });
  await new Promise((r) => setTimeout(r, 800)); // watchers restart
  await load();
}

function add() {
  isNew.value = true;
  editing.value = { id: '', name: '', source: '', target: '', enabled: true, usePolling: false, mediaType: 'auto', mode: '', onlyNew: false };
}
function edit(f: WatchFolder) {
  isNew.value = false;
  editing.value = { ...f };
}
async function save() {
  const f = editing.value!;
  if (!f.source || !f.target) return toast.error('请填写下载目录和媒体库目录');
  if (f.source.replace(/[\\/]+$/, '') === f.target.replace(/[\\/]+$/, '')) return toast.error('下载目录和媒体库目录不能相同');
  const list = isNew.value ? [...folders.value, f] : folders.value.map((x) => (x.id === f.id ? f : x));
  try {
    await persist(list);
    editing.value = null;
    toast.success('已保存，监控已更新');
  } catch (e) {
    toast.error(e);
  }
}
async function toggle(f: WatchFolder) {
  try {
    await persist(folders.value.map((x) => (x.id === f.id ? { ...x, enabled: !x.enabled } : x)));
  } catch (e) {
    toast.error(e);
  }
}
async function remove(f: WatchFolder) {
  if (!confirm(`删除监控目录「${f.name || f.source}」？\n不会删除任何文件。`)) return;
  try {
    await persist(folders.value.filter((x) => x.id !== f.id));
  } catch (e) {
    toast.error(e);
  }
}
async function scan(f: WatchFolder) {
  try {
    const r = await api<{ queued: number }>(`/folders/${f.id}/scan`, { method: 'POST' });
    toast.success(r.queued ? `已加入 ${r.queued} 个文件` : '没有发现新文件');
  } catch (e) {
    toast.error(e);
  }
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>监控目录</h1>
        <p>下载目录出现新的视频文件时，自动识别并整理到对应的媒体库目录</p>
      </div>
      <button class="btn primary" @click="add"><Plus :size="16" /> 添加目录</button>
    </div>

    <div v-if="folders.length" class="grid folders">
      <div v-for="f in folders" :key="f.id" class="card folder" :class="{ disabled: !f.enabled }">
        <div class="card-head">
          <div class="row" style="min-width: 0">
            <span class="dot" :class="f.enabled ? (f.active ? 'on' : 'off') : ''" />
            <h2 class="ellipsis">{{ f.name || basename(f.source) }}</h2>
          </div>
          <Toggle :model-value="f.enabled" @update:model-value="toggle(f)" />
        </div>
        <div class="flow">
          <div class="loc">
            <FolderInput :size="16" />
            <div>
              <div class="muted small">下载目录</div>
              <div class="mono break">{{ f.source }}</div>
            </div>
          </div>
          <ArrowDown :size="16" class="muted down" />
          <div class="loc">
            <FolderOutput :size="16" />
            <div>
              <div class="muted small">媒体库目录</div>
              <div class="mono break">{{ f.target }}</div>
            </div>
          </div>
        </div>
        <div class="row wrap tags">
          <span class="badge">{{ typeLabel[f.mediaType] }}</span>
          <span class="badge">{{ modeLabel[f.mode || globalMode] }}{{ f.mode ? '' : '（默认）' }}</span>
          <span v-if="f.usePolling" class="badge info">轮询模式</span>
          <span v-if="f.onlyNew" class="badge accent" :title="f.since ? `忽略 ${new Date(f.since).toLocaleString('zh-CN')} 之前已存在的文件` : ''">只处理新文件</span>
          <span v-if="f.enabled && !f.active" class="badge danger">目录不可访问</span>
        </div>
        <div class="row foot">
          <button class="btn sm" @click="scan(f)"><RefreshCw :size="14" /> 扫描</button>
          <span class="spacer" />
          <button class="btn sm icon" title="编辑" @click="edit(f)"><Pencil :size="14" /></button>
          <button class="btn sm icon danger" title="删除" @click="remove(f)"><Trash2 :size="14" /></button>
        </div>
      </div>
    </div>
    <div v-else class="card empty">
      <FolderInput :size="28" />
      <div>还没有监控目录</div>
      <button class="btn primary" style="margin-top: 12px" @click="add"><Plus :size="16" /> 添加第一个目录</button>
    </div>

    <Modal v-if="editing" :title="isNew ? '添加监控目录' : '编辑监控目录'" width="640px" @close="editing = null">
      <div class="stack">
        <div class="field">
          <label>名称</label>
          <input v-model="editing.name" class="input" placeholder="例如：电影下载" />
        </div>
        <div class="field">
          <label>下载目录（监控）</label>
          <PathInput v-model="editing.source" placeholder="/downloads/movies" />
          <span class="hint">下载器保存文件的目录，会递归监控子目录</span>
        </div>
        <div class="field">
          <label>媒体库目录（整理到）</label>
          <PathInput v-model="editing.target" placeholder="/media" />
          <div v-if="libs.length" class="row wrap libs">
            <span class="hint">从 Jellyfin 媒体库选择：</span>
            <template v-for="l in libs" :key="l.name">
              <button v-for="p in l.paths" :key="p" type="button" class="badge accent lib" :title="p" @click="editing.target = p">{{ l.name }}</button>
            </template>
          </div>
          <span class="hint">实际路径为：媒体库目录 / 电影或剧集目录 / 分类 / 命名模板（可在设置中修改）</span>
        </div>
        <div class="form-grid">
          <div class="field">
            <label>媒体类型</label>
            <select v-model="editing.mediaType" class="input">
              <option value="auto">自动识别</option>
              <option value="movie">仅电影</option>
              <option value="tv">仅剧集</option>
            </select>
          </div>
          <div class="field">
            <label>整理方式</label>
            <select v-model="editing.mode" class="input">
              <option value="">使用默认（{{ modeLabel[globalMode] }}）</option>
              <option value="hardlink">硬链接（推荐，不占空间，可继续做种）</option>
              <option value="copy">复制</option>
              <option value="move">移动</option>
              <option value="symlink">软链接</option>
            </select>
          </div>
        </div>
        <Toggle
          :model-value="!!editing.onlyNew"
          @update:model-value="editing.onlyNew = $event"
          label="只处理新文件"
          :hint="editing.onlyNew && editing.since ? `忽略 ${new Date(editing.since).toLocaleString('zh-CN')} 之前已存在的文件，只整理之后新出现的文件` : '开启后，保存时目录里已有的文件都会被忽略，只整理之后新下载或新放入的文件'"
        />
        <Toggle v-model="editing.usePolling" label="轮询模式" hint="目录位于 SMB/NFS 网络共享，或文件变化无法被实时检测时开启" />
        <Toggle v-model="editing.enabled" label="启用监控" />
      </div>
      <template #footer>
        <button class="btn" @click="editing = null">取消</button>
        <button class="btn primary" @click="save">保存</button>
      </template>
    </Modal>
  </div>
</template>

<style scoped>
.folders {
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
}
.folder {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.folder .card-head {
  margin-bottom: 0;
}
.folder.disabled {
  opacity: 0.65;
}
.flow {
  background: var(--surface-2);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.loc {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}
.loc > svg {
  margin-top: 3px;
  color: var(--accent);
  flex: none;
}
.down {
  margin-left: 0;
}
.tags {
  gap: 6px;
}
.foot {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.libs {
  gap: 6px;
}
.lib {
  border: 0;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  font-weight: 600;
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}
@media (max-width: 860px) {
  .folders {
    grid-template-columns: 1fr;
  }
}
</style>
