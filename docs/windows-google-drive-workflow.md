# Windows + Google Drive 开发工作流

这个项目目录在 Google Drive 同步盘里。同步盘只适合保存源码和文档，不适合保存 Node 依赖、构建产物、上传文件、数据库数据、日志和机器本地配置。

## 当前约定

| 类型 | 放置位置 | 是否同步 |
| --- | --- | --- |
| 源码同步目录 | `F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai` | 是 |
| 本机运行目录 | `F:/Code/Mirrai` | 否 |
| 本机运行数据 | `F:/.mirrai-local/Mirrai` | 否 |
| Node 依赖 | `F:/Code/Mirrai/node_modules` | 否 |
| 构建产物 | `F:/Code/Mirrai/dist` | 否 |
| 上传文件 | 默认 `F:/Code/Mirrai/uploads`，也可设置到 `F:/.mirrai-local/Mirrai/uploads` | 否 |
| `.env` | 每台电脑自己的 `F:/Code/Mirrai/.env` | 否 |

Google Drive 目录里的 `.env` 只应作为迁移期临时文件。等两台电脑都把 `.env` 复制到各自的本机运行目录后，应从同步盘目录删除 `.env`，避免密钥和机器配置继续同步。

## 第一次在这台电脑运行

在同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1 -CopyEnv -Install
```

然后进入本机运行目录：

```powershell
cd F:\Code\Mirrai
corepack pnpm run dev
```

这台电脑默认走 Neon + DeepSeek：使用 `corepack pnpm run dev`。不要使用 `corepack pnpm run dev:local`，除非明确要启用本机嵌入式 PostgreSQL。

## 日常使用顺序

1. 等 Google Drive 完成源码同步。
2. 在同步盘源码目录运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
   ```

3. 到本机运行目录启动：

   ```powershell
   cd F:\Code\Mirrai
   corepack pnpm run dev
   ```

4. 如果依赖变了，再安装一次：

   ```powershell
   cd F:\Code\Mirrai
   corepack pnpm install --no-frozen-lockfile
   ```

## 启动、查看状态、停止

日常可以直接用脚本，不需要手动记 `pnpm` 命令。

启动 Mirrai：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/start-mirrai.ps1
```

查看 Mirrai 是否正在运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/status-mirrai.ps1
```

停止 Mirrai：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/stop-mirrai.ps1
```

也可以双击 `scripts/start-mirrai.cmd`、`scripts/status-mirrai.cmd`、`scripts/stop-mirrai.cmd`。这些脚本默认都会操作本机运行目录 `F:/Code/Mirrai`，不会在 Google Drive 源码目录里安装依赖或启动服务。

判断是否在线看三件事：

- 状态脚本显示 `Process: RUNNING`。
- 状态脚本显示 `Web: OK (200)`，或浏览器能打开 `http://localhost:3000/`。
- 日志里显示 `[WeChat] ... logged in`，表示微信机器人已登录。系统会优先复用本机保存的微信登录态；如果显示 `Scan QR` 且长时间没有自动登录，才需要重新扫码。

## 哪些东西不能放进 Google Drive 同步目录

- `node_modules/`
- `dist/`
- `uploads/`
- `.vite/`
- `build-macos/`
- `*.log`
- `*.memory-card.json`
- `*.tsbuildinfo`
- PostgreSQL 数据目录
- 每台电脑自己的 `.env`
- 微信登录态目录，默认在每台电脑自己的 `F:/.mirrai-local/Mirrai/wechat`

原因是这些内容和电脑环境强相关。尤其是 `node_modules` 里有大量小文件、Windows 命令包装器和本机路径，放在 Google Drive 里会导致长时间同步、`(1)` 冲突文件、另一台电脑路径不匹配等问题。

## 数据库选择

默认方案是两台电脑都连接同一个 Neon 数据库，所以账号、对话、角色等数据库内容会共享。`.env` 里需要有：

```dotenv
DATABASE_URL=你的 Neon PostgreSQL 连接串
DEFAULT_LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=你的 DeepSeek Key
```

本机 PostgreSQL 只是备用方案。只有运行 `corepack pnpm run dev:local` 时，项目才会使用嵌入式 PostgreSQL，并把数据放到 `F:/.mirrai-local/Mirrai/postgres`。

## 如果又出现 `(1)` 冲突文件

先看冲突是否集中在生成物目录。如果都在 `node_modules`、`dist`、`uploads` 或日志里，可以停止项目后删除这些生成物，再从本机运行目录重新安装或构建。不要删除源码、`drizzle/` 迁移文件、`package.json`、`pnpm-lock.yaml` 或还没备份的 `.env`。

## 本地登录跳回首页

本地开发地址是 `http://localhost:3000`。这个场景下 session cookie 必须使用 `SameSite=Lax` 且 `secure=false`；只有 HTTPS 或 `x-forwarded-proto=https` 时才使用 `SameSite=None` 和 `secure=true`。

如果登录接口返回成功但页面又回到“开始使用”，优先检查 `server/_core/cookies.ts`，确认本地 HTTP 没有发出 `SameSite=None; Secure=false` 这种会被浏览器拒收的 cookie。

## 微信已登录但不回复

微信机器人登录成功只代表 Wechaty 已经连上微信。真正回复前还需要把“微信联系人”绑定到“数字分身”。

当前项目支持一个保守的自动绑定：当数据库里只有一个 `analysisStatus=ready` 的分身时，第一个发来私聊消息的未绑定联系人会自动绑定到这个分身。这个开关由 `.env` 控制：

```dotenv
WECHAT_AUTO_BIND_SINGLE_READY_PERSONA=true
```

如果有多个 ready 分身，机器人不会自动猜测，会在日志里输出 `No active binding`，需要后续补绑定界面或手动调用绑定接口。
