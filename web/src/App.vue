<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Clapperboard, FolderSearch, History, LayoutDashboard, LogOut, Moon, ScrollText, Settings, Sun, Tv } from 'lucide-vue-next';
import { api, session } from './api';
import { toasts } from './toast';

const route = useRoute();
const router = useRouter();
const showShell = computed(() => !route.meta.public && session.authenticated);

const nav = [
  { to: '/', label: '概览', icon: LayoutDashboard },
  { to: '/history', label: '整理记录', icon: History },
  { to: '/folders', label: '监控目录', icon: FolderSearch },
  { to: '/library', label: 'Jellyfin', icon: Tv },
  { to: '/settings', label: '设置', icon: Settings },
  { to: '/logs', label: '日志', icon: ScrollText },
];

const isDark = ref(false);
function detectTheme() {
  const t = document.documentElement.dataset.theme;
  isDark.value = t ? t === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
}
detectTheme();
function toggleTheme() {
  const next = isDark.value ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('nmt-theme', next);
  } catch {
    /* ignore */
  }
  detectTheme();
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  session.authenticated = false;
  router.push('/login');
}

watch(
  () => session.authenticated,
  (v) => {
    if (!v && session.ready && !route.meta.public) router.push({ path: '/login', query: { next: route.fullPath } });
  },
);

const isActive = (to: string) => (to === '/' ? route.path === '/' : route.path.startsWith(to));
</script>

<template>
  <div v-if="showShell" class="shell">
    <aside class="sidebar">
      <div class="brand">
        <span class="logo"><Clapperboard :size="18" /></span>
        <div>
          <div class="brand-name">NAS Movie Tools</div>
          <div class="brand-ver">v{{ session.version }}</div>
        </div>
      </div>
      <nav>
        <RouterLink v-for="n in nav" :key="n.to" :to="n.to" class="nav-item" :class="{ active: isActive(n.to) }">
          <component :is="n.icon" :size="18" />
          <span>{{ n.label }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-foot">
        <div class="user ellipsis">{{ session.username }}</div>
        <button class="btn ghost sm icon" :title="isDark ? '切换到浅色' : '切换到深色'" @click="toggleTheme">
          <Sun v-if="isDark" :size="16" />
          <Moon v-else :size="16" />
        </button>
        <button class="btn ghost sm icon" title="退出登录" @click="logout"><LogOut :size="16" /></button>
      </div>
    </aside>
    <main class="main">
      <RouterView />
    </main>
  </div>
  <RouterView v-else />

  <div class="toasts">
    <TransitionGroup name="toast">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">{{ t.text }}</div>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: var(--sidebar);
  background: var(--surface);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
  z-index: 10;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 22px;
}
.logo {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  background: var(--accent);
  color: var(--on-accent);
  display: grid;
  place-items: center;
}
.brand-name {
  font-weight: 700;
  font-size: 14.5px;
}
.brand-ver {
  font-size: 11.5px;
  color: var(--text-3);
}
nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 12px;
  border-radius: 9px;
  color: var(--text-2);
  font-weight: 550;
  transition:
    background 0.15s,
    color 0.15s;
}
.nav-item:hover {
  background: var(--surface-2);
  color: var(--text);
}
.nav-item.active {
  background: var(--accent-soft);
  color: var(--accent);
}
.sidebar-foot {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 4px 0 8px;
  border-top: 1px solid var(--border);
}
.user {
  flex: 1;
  font-weight: 550;
  color: var(--text-2);
}
.main {
  flex: 1;
  margin-left: var(--sidebar);
  min-width: 0;
}

.toasts {
  position: fixed;
  right: 20px;
  bottom: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  z-index: 100;
  max-width: calc(100vw - 40px);
}
.toast {
  padding: 10px 16px;
  border-radius: 10px;
  background: var(--text);
  color: var(--bg);
  font-weight: 550;
  max-width: 420px;
}
.toast.success {
  background: var(--success);
  color: #fff;
}
.toast.error {
  background: var(--danger);
  color: #fff;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

@media (max-width: 860px) {
  .sidebar {
    inset: auto 0 0 0;
    width: auto;
    height: 64px;
    flex-direction: row;
    padding: 6px 8px;
    border-right: 0;
    border-top: 1px solid var(--border);
  }
  .brand,
  .sidebar-foot {
    display: none;
  }
  nav {
    flex-direction: row;
    width: 100%;
    justify-content: space-around;
  }
  .nav-item {
    flex-direction: column;
    height: auto;
    gap: 2px;
    padding: 6px 4px;
    font-size: 11px;
    flex: 1;
    justify-content: center;
  }
  .main {
    margin-left: 0;
  }
  .toasts {
    bottom: 80px;
  }
}
</style>
