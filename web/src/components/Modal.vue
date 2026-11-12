<script setup lang="ts">
import { X } from 'lucide-vue-next';
import { onBeforeUnmount, onMounted } from 'vue';

defineProps<{ title: string; width?: string }>();
const emit = defineEmits<{ close: [] }>();
const onKey = (e: KeyboardEvent) => e.key === 'Escape' && emit('close');
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <Teleport to="body">
    <div class="overlay" @mousedown.self="emit('close')">
      <div class="modal" :style="{ maxWidth: width ?? '560px' }" role="dialog" :aria-label="title">
        <header>
          <h2>{{ title }}</h2>
          <button class="btn ghost sm icon" aria-label="关闭" @click="emit('close')"><X :size="18" /></button>
        </header>
        <div class="body"><slot /></div>
        <footer v-if="$slots.footer"><slot name="footer" /></footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgb(10 12 18 / 0.45);
  display: grid;
  place-items: center;
  padding: 16px;
  z-index: 50;
}
.modal {
  width: 100%;
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 14px;
}
header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--border);
}
.body {
  padding: 20px;
  overflow: auto;
}
footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 20px;
  border-top: 1px solid var(--border);
}
</style>
