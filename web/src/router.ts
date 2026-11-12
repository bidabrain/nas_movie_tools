import { createRouter, createWebHistory } from 'vue-router';
import { loadSession, session } from './api';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', component: () => import('./views/Login.vue'), meta: { public: true } },
    { path: '/', component: () => import('./views/Dashboard.vue'), meta: { title: '概览' } },
    { path: '/history', component: () => import('./views/History.vue'), meta: { title: '整理记录' } },
    { path: '/folders', component: () => import('./views/Folders.vue'), meta: { title: '监控目录' } },
    { path: '/library', component: () => import('./views/Library.vue'), meta: { title: 'Jellyfin' } },
    { path: '/settings', component: () => import('./views/Settings.vue'), meta: { title: '设置' } },
    { path: '/logs', component: () => import('./views/Logs.vue'), meta: { title: '日志' } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
});

router.beforeEach(async (to) => {
  if (!session.ready) {
    try {
      await loadSession();
    } catch {
      session.ready = true;
    }
  }
  if (!to.meta.public && !session.authenticated) return { path: '/login', query: { next: to.fullPath } };
  if (to.path === '/login' && session.authenticated) return '/';
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title as string} · NAS Movie Tools` : 'NAS Movie Tools';
});
