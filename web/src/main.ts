import { createApp } from 'vue';
import App from './App.vue';
import { router } from './router';
import './styles.css';

try {
  const theme = localStorage.getItem('nmt-theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {
  /* storage unavailable */
}

createApp(App).use(router).mount('#app');
