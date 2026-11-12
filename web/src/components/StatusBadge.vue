<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();
const map: Record<string, [string, string]> = {
  success: ['success', '已入库'],
  failed: ['danger', '失败'],
  skipped: ['warn', '已跳过'],
  pending: ['info', '处理中'],
};
const v = computed(() => map[props.status] ?? ['', props.status]);
</script>

<template>
  <span class="badge" :class="v[0]">{{ v[1] }}</span>
</template>
