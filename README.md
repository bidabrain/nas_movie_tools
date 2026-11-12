<p align="center">
  <img src="icon.svg" alt="NAS Movie Tools" width="128" height="128" />
</p>

<h1 align="center">NAS Movie Tools</h1>

一个精简、现代化的 NAS 影视整理工具：**监控下载目录 → 通过 TMDB 识别影片 → 按分类整理进 Jellyfin 媒体库（附带 NFO 和海报）→ 通知 Jellyfin 扫描 → 推送 Telegram / Gotify 通知**。

参考 [NAStool](https://github.com/NAStool/nas-tools) 的整理思路重新编写，只保留「整理入库」这一条链路，不包含下载、搜索、订阅、站点、刷流等功能。

## 功能

- **目录监控**：实时监听多个下载目录（支持 SMB/NFS 的轮询模式），文件写入完成后再处理；另有定时全量扫描兜底。每个目录可选「只处理新文件」，忽略添加目录前就已存在的文件
- **智能识别**：解析中英文文件名、`S01E02` / `第二季 第3集` / 动漫 `[组] 标题 - 05` 等格式，可结合上级文件夹名识别；通过 TMDB 匹配影片或剧集
- **自动分类**：按 TMDB 的类型、原始语言、出品国家分类（华语电影、动画电影、日韩剧、欧美剧……规则可在界面中编辑）
- **整理入库**：硬链接 / 复制 / 移动 / 软链接，可自定义命名模板，默认符合 Jellyfin 命名规范（文件夹名带 `[tmdbid-xxx]`，可精确匹配）；同名字幕一并整理
- **元数据**：生成 `movie.nfo` / `tvshow.nfo` / 单集 NFO，下载海报、背景图、季海报和单集截图
- **Jellyfin**：查看媒体库，整理后只扫描新增的目录（支持路径映射）
- **通知**：Telegram（带海报）、Gotify（Markdown + 大图）；同一季多集会合并为一条通知
- **管理界面**：概览、整理记录（识别失败或识别错误时可手动指定 TMDB 条目重新整理，之前整理错的文件会被自动清理）、目录管理（带目录浏览器）、设置、实时日志；支持深色模式和手机访问

## 快速开始（Docker）

```yaml
services:
  nas-movie-tools:
    image: ghcr.io/bidabrain/nas_movie_tools:latest
    container_name: nas-movie-tools
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=Asia/Shanghai
    volumes:
      - ./config:/config
      - /volume1/data:/data   # 同时包含下载目录和媒体库目录的上级目录
    mem_limit: 512m
```

启动后访问 `http://NAS地址:3000`，首次打开会要求创建管理员账号。为防止他人抢先注册，创建时需要填写**初始化验证码**，它打印在容器日志里：

```bash
docker logs nas-movie-tools 2>&1 | grep 初始化验证码
```

也可以设置 `ADMIN_USER` / `ADMIN_PASSWORD` 环境变量，在启动时直接创建管理员。然后：

1. **设置 → TMDB**：填写 API Key（v3 Key 或 v4 读访问令牌均可），网络不通时可填 HTTP 代理
2. **监控目录 → 添加目录**：例如 `/data/downloads` → `/data/media`
3. **设置 → Jellyfin**：填写地址和 API Key；如果 Jellyfin 容器里看到的路径不同，添加路径映射
4. **设置 → 通知**：按需启用 Telegram 或 Gotify，点击「测试」验证

> **关于硬链接**：硬链接要求下载目录和媒体库目录在同一个分区，并且在容器里属于同一个挂载点。请像上面那样挂载它们共同的上级目录（如 `/volume1/data:/data`），不要分别挂载 `/downloads` 和 `/media`。

### 什么文件会被整理

- 添加监控目录、容器启动时以及定时扫描时，会扫描目录里**所有**尚未整理过的视频；之后新下载的文件由实时监控处理
- 开启目录的「只处理新文件」后，开启那一刻已存在的文件会被忽略（按文件的修改/移入时间判断），之后新出现的文件照常整理
- 小于最小文件大小（默认 50 MB）、文件名含 sample / trailer / 预告 的文件会被忽略
- 已成功整理过的文件不会重复处理；识别失败的文件需要在「整理记录」中手动处理

### 识别错误怎么办

在「整理记录」中点「手动识别」，搜索并选择正确的 TMDB 条目。整理到新位置成功后，之前整理错的那份会被清理：媒体库中的视频（硬链接/复制/软链接模式下删除那一份，移动模式下直接把文件移到新位置）、它的 NFO、截图和字幕，以及因此变空（只剩海报等元数据）的影片目录。下载目录里的源文件不受影响；如果旧目录里还有其他视频，或旧文件同时属于别的记录，则不会被删除。

### 整理结果示例

```
/data/media
├── 电影/华语电影/流浪地球2 (2023) [tmdbid-842675]/
│   ├── 流浪地球2 (2023).mkv
│   ├── 流浪地球2 (2023).chs.srt
│   ├── 流浪地球2 (2023).nfo
│   ├── poster.jpg
│   └── fanart.jpg
└── 剧集/欧美剧/最后生还者 (2023) [tmdbid-100088]/
    ├── tvshow.nfo  poster.jpg  fanart.jpg  season01-poster.jpg
    └── Season 1/
        ├── 最后生还者 - S01E01.mkv
        ├── 最后生还者 - S01E01.nfo
        └── 最后生还者 - S01E01-thumb.jpg
```

## 公网访问

通过 Cloudflare Tunnel 等方式暴露到公网时：

- 应用内置了登录失败限流（单个来源 15 分钟内 5 次、全部来源合计 20 次），按 Cloudflare 提供的 `CF-Connecting-IP` 识别访客，不信任可伪造的 `X-Forwarded-For`；使用其他反向代理时，用 `CLIENT_IP_HEADER` 指定代理会覆盖的请求头（如 `x-real-ip`）
- 响应带有 CSP、`X-Frame-Options` 等安全头
- **强烈建议**再在 Cloudflare Zero Trust 中为该域名添加 Access 策略（如仅允许自己的邮箱验证登录），让应用登录成为第二道防线
- 管理员密码请设置得足够长

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 监听端口 |
| `DATA_DIR` | `/config`（Docker） | 数据库和配置存放目录 |
| `PUID` / `PGID` | `1000` | 运行用户，整理出的文件归属此用户 |
| `UMASK` | `022` | 新建文件权限掩码 |
| `ADMIN_USER` / `ADMIN_PASSWORD` | – | 可选，首次启动时直接创建管理员 |
| `CLIENT_IP_HEADER` | `cf-connecting-ip` | 登录限流用来识别访客 IP 的请求头 |
| `TZ` | `Asia/Shanghai` | 时区 |

## 本地开发

需要 Node.js 22.13 或更高版本（使用内置的 `node:sqlite`）。

```bash
npm install
npm run dev:server   # API，http://localhost:3000
npm run dev:web      # 界面，http://localhost:5173（已代理 /api）
npm test             # 单元测试
npm run build        # 构建界面到 server/public 并编译服务端
npm start            # 运行构建结果
```

### 项目结构

```
server/                 Fastify + TypeScript 后端
  src/media/            文件名解析、TMDB、分类、命名、NFO、文件转移
  src/integrations/     Jellyfin、Telegram、Gotify
  src/organizer.ts      单个文件的整理流程
  src/watcher.ts        目录监控与整理队列
  src/routes.ts         REST API
web/                    Vue 3 + Vite 前端（扁平化设计，无 UI 框架）
```

## 许可

[AGPL-3.0](LICENSE)，与参考项目 NAStool 保持一致。
