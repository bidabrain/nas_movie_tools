<script setup lang="ts">
import { ref } from 'vue';
import { ChevronRight, Folder, FolderOpen, CornerLeftUp } from 'lucide-vue-next';
import Modal from './Modal.vue';
import { api } from '../api';
import { toast } from '../toast';

const model = defineModel<string>({ required: true });
defineProps<{ placeholder?: string }>();

interface Listing {
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}
const open = ref(false);
const listing = ref<Listing | null>(null);
const loading = ref(false);

async function browse(p: string) {
  loading.value = true;
  try {
    listing.value = await api<Listing>(`/fs/browse?path=${encodeURIComponent(p)}`);
  } catch (e) {
    toast.error(e);
    if (!listing.value) listing.value = await api<Listing>('/fs/browse?path=');
  } finally {
    loading.value = false;
  }
}

function show() {
  open.value = true;
  void browse(model.value || '');
}
function choose() {
  if (listing.value?.path) model.value = listing.value.path;
  open.value = false;
}
</script>

<template>
  <div class="path-input">
    <input v-model="model" class="input mono" :placeholder="placeholder" />
    <button type="button" class="btn icon" title="浏览目录" @click="show"><FolderOpen :size="16" /></button>
  </div>
  <Modal v-if="open" title="选择目录" width="620px" @close="open = false">
    <div class="current mono">{{ listing?.path || '根目录' }}</div>
    <div class="list" :class="{ loading }">
      <button v-if="listing && listing.parent !== null" class="item" @click="browse(listing.parent ?? '')">
        <CornerLeftUp :size="16" /> <span>上一级</span>
      </button>
      <button v-for="d in listing?.dirs ?? []" :key="d.path" class="item" @click="browse(d.path)">
        <Folder :size="16" /> <span class="ellipsis">{{ d.name }}</span>
        <ChevronRight :size="14" class="chev" />
      </button>
      <div v-if="listing && !listing.dirs.length" class="empty small">没有子目录</div>
    </div>
    <template #footer>
      <button class="btn" @click="open = false">取消</button>
      <button class="btn primary" :disabled="!listing?.path" @click="choose">选择此目录</button>
    </template>
  </Modal>
</template>

<style scoped>
.path-input {
  display: flex;
  gap: 8px;
}
.current {
  padding: 8px 12px;
  background: var(--surface-2);
  border-radius: 8px;
  margin-bottom: 12px;
  word-break: break-all;
}
.list {
  display: flex;
  flex-direction: column;
  max-height: 380px;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
}
.list.loading {
  opacity: 0.6;
}
.item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  text-align: left;
  padding: 9px 12px;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
  min-width: 0;
}
.item:last-child {
  border-bottom: 0;
}
.item:hover {
  background: var(--surface-2);
}
.item svg {
  color: var(--text-3);
  flex: none;
}
.chev {
  margin-left: auto;
}
</style>
