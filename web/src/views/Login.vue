<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { Clapperboard } from 'lucide-vue-next';
import { api, loadSession, session } from '../api';

const router = useRouter();
const route = useRoute();
const username = ref('admin');
const password = ref('');
const confirm = ref('');
const code = ref('');
const error = ref('');
const busy = ref(false);
const setup = computed(() => session.setupRequired);

async function submit() {
  error.value = '';
  if (setup.value && password.value !== confirm.value) {
    error.value = '两次输入的密码不一致';
    return;
  }
  busy.value = true;
  try {
    await api(setup.value ? '/auth/setup' : '/auth/login', { body: { username: username.value, password: password.value, code: code.value } });
    await loadSession();
    router.replace((route.query.next as string) || '/');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="wrap">
    <form class="panel" @submit.prevent="submit">
      <div class="logo"><Clapperboard :size="22" /></div>
      <h1>{{ setup ? '创建管理员账号' : '登录' }}</h1>
      <p class="muted">{{ setup ? '首次使用，请设置用于登录管理界面的账号。' : 'NAS Movie Tools · 媒体自动整理' }}</p>
      <div v-if="setup" class="field">
        <label for="k">初始化验证码</label>
        <input id="k" v-model="code" class="input mono" autocomplete="off" spellcheck="false" required placeholder="8 位验证码" />
        <span class="hint">在容器日志中查看（docker logs nas-movie-tools），每次重启会重新生成</span>
      </div>
      <div class="field">
        <label for="u">用户名</label>
        <input id="u" v-model="username" class="input" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="p">密码</label>
        <input id="p" v-model="password" class="input" type="password" :autocomplete="setup ? 'new-password' : 'current-password'" required />
      </div>
      <div v-if="setup" class="field">
        <label for="c">确认密码</label>
        <input id="c" v-model="confirm" class="input" type="password" autocomplete="new-password" required />
        <span class="hint">至少 6 位</span>
      </div>
      <div v-if="error" class="err">{{ error }}</div>
      <button class="btn primary submit" :disabled="busy">{{ busy ? '请稍候…' : setup ? '创建并进入' : '登录' }}</button>
    </form>
  </div>
</template>

<style scoped>
.wrap {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 16px;
}
.panel {
  width: 100%;
  max-width: 380px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
  padding: 32px 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.logo {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--accent);
  color: var(--on-accent);
  display: grid;
  place-items: center;
}
.panel p {
  margin: -8px 0 4px;
}
.err {
  background: var(--danger-soft);
  color: var(--danger);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 13px;
}
.submit {
  height: 40px;
  margin-top: 4px;
}
</style>
