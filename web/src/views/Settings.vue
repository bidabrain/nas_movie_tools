<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown, ArrowUp, LogOut, Plus, Save, Send, Trash2, Zap } from 'lucide-vue-next';
import { api, session, type Settings } from '../api';
import Toggle from '../components/Toggle.vue';
import { toast } from '../toast';

const route = useRoute();
const router = useRouter();
const tabs = [
  ['tmdb', 'TMDB'],
  ['organize', '整理规则'],
  ['categories', '分类'],
  ['jellyfin', 'Jellyfin'],
  ['notify', '通知'],
  ['account', '账号'],
] as const;
type Tab = (typeof tabs)[number][0];
const tab = ref<Tab>((route.query.tab as Tab) || 'tmdb');
watch(tab, (t) => router.replace({ query: { tab: t } }));

const s = ref<Settings | null>(null);
const saving = ref(false);
const dirty = ref(false);

async function load() {
  s.value = await api<Settings>('/settings');
  setTimeout(() => (dirty.value = false));
}
onMounted(() => load().catch(toast.error));
watch(s, () => (dirty.value = true), { deep: true });

async function save(quiet = false) {
  if (!s.value) return;
  saving.value = true;
  try {
    const { watchFolders: _wf, ...rest } = s.value;
    s.value = await api<Settings>('/settings', { method: 'PUT', body: rest });
    setTimeout(() => (dirty.value = false));
    if (!quiet) toast.success('设置已保存');
  } catch (e) {
    toast.error(e);
    throw e;
  } finally {
    saving.value = false;
  }
}

// ---- naming preview
const sample = ref('The.Last.of.Us.S01E03.2160p.WEB-DL.H265.mkv');
const preview = ref<{ parsed: Record<string, unknown>; preview: { movie: string; tv: string } } | null>(null);
async function runPreview() {
  try {
    if (dirty.value) await save(true);
    preview.value = await api(`/parse?name=${encodeURIComponent(sample.value)}`);
  } catch (e) {
    toast.error(e);
  }
}
const parsedPairs = computed(() =>
  Object.entries(preview.value?.parsed ?? {}).filter(([, v]) => v !== undefined && v !== ''),
);
const parsedLabel: Record<string, string> = {
  title: '标题',
  cnTitle: '中文名',
  enTitle: '英文名',
  year: '年份',
  season: '季',
  episode: '集',
  episodeEnd: '结束集',
  part: '分段',
  resolution: '分辨率',
  kind: '类型',
};

// ---- categories
function addRule(kind: 'movie' | 'tv') {
  s.value!.categories[kind].push({ name: '新分类' });
}
function moveRule(kind: 'movie' | 'tv', i: number, d: number) {
  const list = s.value!.categories[kind];
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

// ---- tests
const testing = ref('');
async function testJellyfin() {
  testing.value = 'jellyfin';
  try {
    const r = await api<{ name: string; version: string }>('/jellyfin/test', {
      body: { url: s.value!.jellyfin.url, apiKey: s.value!.jellyfin.apiKey },
    });
    toast.success(`连接成功：${r.name} v${r.version}`);
  } catch (e) {
    toast.error(e);
  } finally {
    testing.value = '';
  }
}
async function testNotify(channel: 'telegram' | 'gotify') {
  testing.value = channel;
  try {
    await save(true);
    await api('/notify/test', { body: { channel } });
    toast.success('测试消息已发送');
  } catch (e) {
    toast.error(e);
  } finally {
    testing.value = '';
  }
}

// ---- account
const pw = ref({ current: '', username: session.username ?? '', password: '', confirm: '' });
async function changePassword() {
  if (pw.value.password !== pw.value.confirm) return toast.error('两次输入的新密码不一致');
  try {
    await api('/auth/password', { body: pw.value });
    session.username = pw.value.username;
    pw.value = { current: '', username: pw.value.username, password: '', confirm: '' };
    toast.success('账号已更新');
  } catch (e) {
    toast.error(e);
  }
}
async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  session.authenticated = false;
  router.push('/login');
}
</script>

<template>
  <div class="page">
    <div class="page-head">
      <div>
        <h1>设置</h1>
        <p>修改后点击保存，监控目录会自动按新设置重启</p>
      </div>
      <button v-if="tab !== 'account'" class="btn primary" :disabled="saving || !dirty" @click="save()">
        <Save :size="16" /> {{ dirty ? '保存设置' : '已保存' }}
      </button>
    </div>

    <div class="tabs" style="margin-bottom: 16px">
      <button v-for="t in tabs" :key="t[0]" :class="{ active: tab === t[0] }" @click="tab = t[0]">{{ t[1] }}</button>
    </div>

    <template v-if="s">
      <!-- TMDB -->
      <div v-if="tab === 'tmdb'" class="card">
        <div class="card-head">
          <div>
            <h2>TMDB</h2>
            <p>用于识别影片、获取中文信息和海报。在 themoviedb.org 账号设置 → API 中申请</p>
          </div>
        </div>
        <div class="form-grid">
          <div class="field full">
            <label>API Key 或 API 读访问令牌</label>
            <input v-model="s.tmdb.apiKey" class="input mono" type="password" autocomplete="off" placeholder="v3 API Key 或 v4 Read Access Token" />
          </div>
          <div class="field">
            <label>语言</label>
            <select v-model="s.tmdb.language" class="input">
              <option value="zh-CN">简体中文 (zh-CN)</option>
              <option value="zh-TW">繁體中文 (zh-TW)</option>
              <option value="zh-HK">繁體中文 (zh-HK)</option>
              <option value="en-US">English (en-US)</option>
              <option value="ja-JP">日本語 (ja-JP)</option>
            </select>
          </div>
          <div class="field">
            <label>HTTP 代理</label>
            <input v-model="s.tmdb.proxy" class="input mono" placeholder="http://192.168.1.2:7890（可选）" />
            <span class="hint">访问 TMDB、下载图片和 Telegram 时使用</span>
          </div>
          <div class="field full">
            <label>图片地址</label>
            <input v-model="s.tmdb.imageBase" class="input mono" />
            <span class="hint">默认 https://image.tmdb.org/t/p，可替换为镜像地址</span>
          </div>
        </div>
      </div>

      <!-- Organize -->
      <div v-if="tab === 'organize'" class="stack">
        <div class="card">
          <div class="card-head"><h2>整理方式</h2></div>
          <div class="form-grid">
            <div class="field">
              <label>默认整理方式</label>
              <select v-model="s.organize.mode" class="input">
                <option value="hardlink">硬链接（推荐）</option>
                <option value="copy">复制</option>
                <option value="move">移动</option>
                <option value="symlink">软链接</option>
              </select>
              <span class="hint">硬链接不占用额外空间，源文件可继续做种；要求两个目录在同一分区</span>
            </div>
            <div class="field">
              <label>目标已存在时</label>
              <select v-model="s.organize.overwrite" class="input">
                <option value="larger">新文件更大时覆盖</option>
                <option value="never">跳过</option>
                <option value="always">总是覆盖</option>
              </select>
            </div>
            <div class="field">
              <label>电影目录名</label>
              <input v-model="s.organize.movieDir" class="input" />
            </div>
            <div class="field">
              <label>剧集目录名</label>
              <input v-model="s.organize.tvDir" class="input" />
            </div>
            <div class="field">
              <label>最小文件大小 (MB)</label>
              <input v-model.number="s.organize.minFileSizeMB" type="number" min="0" class="input" />
              <span class="hint">小于此大小的视频（如花絮、样片）会被忽略</span>
            </div>
            <div class="field">
              <label>写入稳定等待 (秒)</label>
              <input v-model.number="s.organize.stableSeconds" type="number" min="2" class="input" />
              <span class="hint">文件大小持续不变这么久后才开始整理</span>
            </div>
            <div class="field">
              <label>定时全量扫描 (分钟)</label>
              <input v-model.number="s.organize.scanIntervalMinutes" type="number" min="0" class="input" />
              <span class="hint">作为实时监控的补充，0 表示关闭</span>
            </div>
          </div>
          <div class="stack" style="margin-top: 20px">
            <Toggle v-model="s.organize.useCategories" label="按分类建立子目录" hint="例如 电影/华语电影/…，分类规则在「分类」中设置" />
            <Toggle v-model="s.organize.writeNfo" label="生成 NFO 元数据" hint="写入 TMDB 的标题、简介、评分、类型等，Jellyfin 可直接读取" />
            <Toggle v-model="s.organize.downloadArtwork" label="下载海报和背景图" hint="poster.jpg、fanart.jpg、季海报和单集截图" />
          </div>
        </div>

        <div class="card">
          <div class="card-head">
            <div>
              <h2>命名模板</h2>
              <p>用 / 分隔目录层级，文件扩展名自动保留</p>
            </div>
          </div>
          <div class="stack">
            <div class="field">
              <label>电影</label>
              <input v-model="s.organize.movieTemplate" class="input mono" />
            </div>
            <div class="field">
              <label>剧集</label>
              <input v-model="s.organize.tvTemplate" class="input mono" />
            </div>
            <div class="vars small">
              可用变量：
              <code v-for="v in ['title', 'original_title', 'en_title', 'year', 'tmdbid', 'season', 'episode', 'resolution', 'part']" :key="v">{{ '{' + v + '}' }}</code>
              ，数字补零写作 <code>{season:02}</code>。文件夹名中保留 <code>[tmdbid-…]</code> 可让 Jellyfin 精确匹配。
            </div>
            <div class="preview">
              <div class="row">
                <input v-model="sample" class="input mono" placeholder="输入一个文件名试试" @keyup.enter="runPreview" />
                <button class="btn" @click="runPreview"><Zap :size="15" /> 预览</button>
              </div>
              <div v-if="preview" class="pv">
                <div class="row wrap">
                  <span v-for="[k, v] in parsedPairs" :key="k" class="badge">{{ parsedLabel[k] ?? k }}：{{ v }}</span>
                </div>
                <div class="small"><span class="muted">按电影：</span><span class="mono">{{ preview.preview.movie }}</span></div>
                <div class="small"><span class="muted">按剧集：</span><span class="mono">{{ preview.preview.tv }}</span></div>
                <div class="hint">预览只解析文件名，实际标题和年份以 TMDB 结果为准</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Categories -->
      <div v-if="tab === 'categories'" class="stack">
        <div v-for="kind in ['movie', 'tv'] as const" :key="kind" class="card">
          <div class="card-head">
            <div>
              <h2>{{ kind === 'movie' ? '电影分类' : '剧集分类' }}</h2>
              <p>从上到下匹配，第一条满足全部条件的规则生效；条件留空表示不限</p>
            </div>
            <button class="btn sm" @click="addRule(kind)"><Plus :size="14" /> 添加</button>
          </div>
          <div class="rules">
            <div class="rule head hide-sm">
              <span>名称</span><span>类型 ID</span><span>原始语言</span><span>出品国家</span><span />
            </div>
            <div v-for="(r, i) in s.categories[kind]" :key="i" class="rule">
              <input v-model="r.name" class="input" placeholder="分类名称" />
              <input v-model="r.genreIds" class="input mono" placeholder="如 16,99" />
              <input v-model="r.originalLanguage" class="input mono" placeholder="如 zh,cn" />
              <input v-model="r.originCountry" class="input mono" placeholder="如 CN,HK,TW" />
              <div class="row rule-actions">
                <button class="btn sm icon ghost" title="上移" @click="moveRule(kind, i, -1)"><ArrowUp :size="14" /></button>
                <button class="btn sm icon ghost" title="下移" @click="moveRule(kind, i, 1)"><ArrowDown :size="14" /></button>
                <button class="btn sm icon danger" title="删除" @click="s.categories[kind].splice(i, 1)"><Trash2 :size="14" /></button>
              </div>
            </div>
          </div>
        </div>
        <div class="card small muted">
          常用类型 ID：动画 16 · 纪录 99 · 喜剧 35 · 剧情 18 · 动作 28 · 科幻 878 · 恐怖 27 · 儿童 10762 · 真人秀 10764 · 脱口秀 10767。
          国家使用 ISO 3166-1 代码（CN、US、JP），语言使用 ISO 639-1 代码（zh、en、ja）。
        </div>
      </div>

      <!-- Jellyfin -->
      <div v-if="tab === 'jellyfin'" class="stack">
        <div class="card">
          <div class="card-head">
            <div>
              <h2>Jellyfin 服务器</h2>
              <p>在 Jellyfin 控制台 → API 密钥 中创建一个密钥</p>
            </div>
            <button class="btn sm" :disabled="testing === 'jellyfin'" @click="testJellyfin"><Zap :size="14" /> 测试连接</button>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>服务器地址</label>
              <input v-model="s.jellyfin.url" class="input mono" placeholder="http://192.168.1.10:8096" />
            </div>
            <div class="field">
              <label>API Key</label>
              <input v-model="s.jellyfin.apiKey" class="input mono" type="password" autocomplete="off" />
            </div>
          </div>
          <div style="margin-top: 20px">
            <Toggle v-model="s.jellyfin.refreshAfterOrganize" label="整理后自动通知 Jellyfin 扫描" hint="只扫描新增的目录，多个文件会合并为一次请求" />
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h2>路径映射</h2>
              <p>本工具与 Jellyfin 运行在不同容器、看到的路径不同时填写，例如 /media → /data/media</p>
            </div>
            <button class="btn sm" @click="s.jellyfin.pathMappings.push({ from: '', to: '' })"><Plus :size="14" /> 添加</button>
          </div>
          <div v-for="(m, i) in s.jellyfin.pathMappings" :key="i" class="row map">
            <input v-model="m.from" class="input mono" placeholder="本工具中的路径" />
            <span class="muted">→</span>
            <input v-model="m.to" class="input mono" placeholder="Jellyfin 中的路径" />
            <button class="btn sm icon danger" @click="s.jellyfin.pathMappings.splice(i, 1)"><Trash2 :size="14" /></button>
          </div>
          <div v-if="!s.jellyfin.pathMappings.length" class="muted small">未设置，路径相同时无需设置</div>
        </div>
      </div>

      <!-- Notify -->
      <div v-if="tab === 'notify'" class="stack">
        <div class="card">
          <div class="card-head"><h2>通知时机</h2></div>
          <div class="stack">
            <Toggle v-model="s.notify.onSuccess" label="入库成功" hint="同一剧集同一季 30 秒内的多集会合并为一条通知" />
            <Toggle v-model="s.notify.onFailure" label="整理失败" />
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h2>Telegram</h2>
              <p>通过 @BotFather 创建机器人，向它发送一条消息后获取 Chat ID</p>
            </div>
            <div class="row">
              <button class="btn sm" :disabled="!s.notify.telegram.enabled || testing === 'telegram'" @click="testNotify('telegram')"><Send :size="14" /> 测试</button>
              <Toggle v-model="s.notify.telegram.enabled" />
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>Bot Token</label>
              <input v-model="s.notify.telegram.botToken" class="input mono" type="password" autocomplete="off" placeholder="123456:ABC-DEF…" />
            </div>
            <div class="field">
              <label>Chat ID</label>
              <input v-model="s.notify.telegram.chatId" class="input mono" placeholder="用户、群组或频道 ID" />
            </div>
            <div class="field full">
              <label>API 地址</label>
              <input v-model="s.notify.telegram.apiBase" class="input mono" />
              <span class="hint">可替换为自建反代地址；也会使用 TMDB 设置中的代理</span>
            </div>
          </div>
        </div>
        <div class="card">
          <div class="card-head">
            <div>
              <h2>Gotify</h2>
              <p>在 Gotify 中创建一个应用，复制它的 Token</p>
            </div>
            <div class="row">
              <button class="btn sm" :disabled="!s.notify.gotify.enabled || testing === 'gotify'" @click="testNotify('gotify')"><Send :size="14" /> 测试</button>
              <Toggle v-model="s.notify.gotify.enabled" />
            </div>
          </div>
          <div class="form-grid">
            <div class="field">
              <label>服务器地址</label>
              <input v-model="s.notify.gotify.url" class="input mono" placeholder="https://gotify.example.com" />
            </div>
            <div class="field">
              <label>应用 Token</label>
              <input v-model="s.notify.gotify.token" class="input mono" type="password" autocomplete="off" />
            </div>
            <div class="field">
              <label>优先级</label>
              <input v-model.number="s.notify.gotify.priority" type="number" min="0" max="10" class="input" />
            </div>
          </div>
        </div>
      </div>

      <!-- Account -->
      <div v-if="tab === 'account'" class="card">
        <div class="card-head">
          <div>
            <h2>管理员账号</h2>
            <p>修改后其他设备上的登录会失效</p>
          </div>
          <button class="btn sm" @click="logout"><LogOut :size="14" /> 退出登录</button>
        </div>
        <form class="form-grid" @submit.prevent="changePassword">
          <div class="field">
            <label>用户名</label>
            <input v-model="pw.username" class="input" autocomplete="username" />
          </div>
          <div class="field">
            <label>当前密码</label>
            <input v-model="pw.current" type="password" class="input" autocomplete="current-password" required />
          </div>
          <div class="field">
            <label>新密码</label>
            <input v-model="pw.password" type="password" class="input" autocomplete="new-password" required minlength="6" />
          </div>
          <div class="field">
            <label>确认新密码</label>
            <input v-model="pw.confirm" type="password" class="input" autocomplete="new-password" required />
          </div>
          <div class="full"><button class="btn primary">更新账号</button></div>
        </form>
      </div>
    </template>
  </div>
</template>

<style scoped>
.vars {
  color: var(--text-2);
  line-height: 2;
}
.vars code {
  background: var(--surface-2);
  padding: 2px 6px;
  border-radius: 5px;
  margin: 0 3px;
}
.preview {
  border-top: 1px solid var(--border);
  padding-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.pv {
  background: var(--surface-2);
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.pv .badge {
  background: var(--surface);
}
.rules {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.rule {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr 1.4fr auto;
  gap: 8px;
  align-items: center;
}
.rule.head {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-3);
}
.rule-actions {
  gap: 2px;
}
.map {
  margin-bottom: 8px;
}
@media (max-width: 860px) {
  .rule {
    grid-template-columns: 1fr 1fr;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border);
  }
}
</style>
