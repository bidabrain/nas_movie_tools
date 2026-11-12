<script setup lang="ts">
const model = defineModel<boolean>({ required: true });
defineProps<{ label?: string; hint?: string }>();
</script>

<template>
  <label class="toggle">
    <button type="button" role="switch" :aria-checked="model" class="sw" :class="{ on: model }" @click="model = !model">
      <span />
    </button>
    <span v-if="label || hint" class="text">
      <span class="lbl">{{ label }}</span>
      <span v-if="hint" class="hint">{{ hint }}</span>
    </span>
  </label>
</template>

<style scoped>
.toggle {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  cursor: pointer;
}
.sw {
  flex: none;
  width: 38px;
  height: 22px;
  border-radius: 999px;
  border: 0;
  padding: 0;
  background: var(--border);
  position: relative;
  cursor: pointer;
  transition: background 0.15s;
  margin-top: 1px;
}
.sw span {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  transition: transform 0.15s;
}
.sw.on {
  background: var(--accent);
}
.sw.on span {
  transform: translateX(16px);
}
.text {
  display: flex;
  flex-direction: column;
}
.lbl {
  font-weight: 550;
}
</style>
