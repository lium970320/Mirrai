# Mirrai 阶段 1 工程卫生盘点记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>)

## 已完成处理

- 修复同步盘源码目录的 Git 元数据损坏：
  - 问题表现：`git log --oneline -n 5` 失败，报缺失父提交 `785ce044b69f0759a9d7b1936416d65dde9e0d9e`。
  - 问题表现：`git diff --stat` 失败，报缺失对象 `636a9119914d82c493234f40eca46856ad78c9dc`。
  - 问题表现：`git fsck --full --no-reflogs` 报大量 missing commit / tree / blob，以及坏 tag `snapshot-2026-05-08-mirrai-runtime`。
- 从 `origin/main` 克隆健康副本到本机运行数据区：
  - `[Mirrai-origin](<F:/.mirrai-local/Mirrai/git-repair/Mirrai-origin>)`
  - 该副本 HEAD 为 `7506ed1fbbb644d49770db430755aa46ae01f837`，与同步盘当前 HEAD 一致。
- 用健康 clone 的 `.git` 替换同步盘损坏 `.git`，保留损坏备份：
  - 损坏备份已移出同步盘根目录。
  - 备份位置：[.git.corrupt-20260608-032719](<F:/.mirrai-local/Mirrai/git-repair/.git.corrupt-20260608-032719>)
- 移出同步盘根目录残留的 `.env`：
  - 同步盘 `.env` 已备份到：[sync-source-env-20260608-033256.env](<F:/.mirrai-local/Mirrai/source-sync-backups/sync-source-env-20260608-033256.env>)
  - 本机运行目录仍保留独立 `.env`：[.env](<F:/Code/Mirrai/.env>)
- 移出运行态 memory-card 文件：
  - `Girlfriend.memory-card.json` 内容为 `{}`，属于 `*.memory-card.json` 运行态文件。
  - 已备份到：[Girlfriend.memory-card-20260608-033633.json](<F:/.mirrai-local/Mirrai/source-sync-backups/Girlfriend.memory-card-20260608-033633.json>)
  - 已用 `git rm` 从版本控制中移除；`.gitignore` 已覆盖后续同类文件。
- 移出未跟踪 UI 备份文件：
  - 三个 `.bak` 文件已迁移到：[ui-bak-20260608-0336](<F:/.mirrai-local/Mirrai/source-sync-backups/ui-bak-20260608-0336>)
  - 源码树中不再保留这些未跟踪备份文件。

## 当前验证结果

这些命令已经恢复可用：

```powershell
git status --short --branch
git log --oneline -n 5
git diff --stat
```

当前 `git log --oneline -n 5` 结果：

```text
7506ed1 snapshot qq voice and persona updates
785ce04 add local VoxCPM QQ voice TTS
20b5abc add qq voice reply tts policy
4a1418e fix qq voice amr url transcoding
13786cb fix qq voice silk asr decoding
```

`git diff --stat` 当前可正常生成，粗略显示 47 个已跟踪文件有改动，约 `3287 insertions / 868 deletions`。

## 当前工作区改动分组

### A. 阶段计划与盘点记录

- `MIRRAI_WORK_PLAN.md`
- `MIRRAI_PHASE_1_AUDIT.md`

### B. P0 / 人物运行时与诊断相关

- `client/src/components/PersonaStatePanel.tsx`
- `docs/antigravity-ui-handoff.md`
- `server/llm/deepseek-routing.ts`
- `server/llm/usage.ts`
- `server/_core/persona-profile.ts`
- `server/social/persona-turn-planner.ts`
- `server/social/persona-reflection.ts`
- `server/social/memory-card.ts`
- `server/social/memory-consolidation.ts`
- `server/social/memory-governance.ts`
- `server/social/memory-recall.ts`
- `server/social/daily-memory.ts`
- 以及对应 `.test.ts` 文件。

### C. Roleplay / 多角色频道相关

- `client/src/pages/Roleplay.tsx`
- `drizzle/0003_roleplay_channels.sql`
- `server/social/roleplay-channel.ts`
- `server/social/roleplay-channel.test.ts`
- `server/routers.ts`
- `server/db.ts`
- `drizzle/schema.ts`

### D. QQ / 语音 / 主动消息相关

- `server/qq/message-handler.ts`
- `server/qq/persona-bridge.ts`
- `server/voice/voice-reply-policy.ts`
- `server/_core/tts.ts`
- `server/wechat/proactive-scheduler.ts`
- `server/wechat/ambient-proactive.ts`
- `scripts/start-qq.ps1`
- `scripts/start-all.ps1`
- `scripts/status-mirrai.ps1`
- `scripts/stop-mirrai.ps1`

### E. UI 调整

- `client/src/App.tsx`
- `client/src/index.css`
- `client/src/pages/Chat.tsx`
- `client/src/pages/Lobby.tsx`
- `client/src/pages/PersonaEdit.tsx`
- `client/src/pages/Settings.tsx`
- `client/src/pages/Diary.tsx`

### F. 文档 / 人设材料 / 漫画生产线

- `docs/todo.md`
- `docs/persona-long-memory-proactive.md`
- `docs/windows-google-drive-workflow.md`
- `docs/wang-pengze-persona-profile.md`
- `persona_material/wang-pengze-agent-card.json`
- `persona_material/wang-pengze-agent-card.md`
- `persona_material/wang-pengze-hanako-card/`
- `persona_material/zhuzi-hanako-card/`
- `live-action-comic/`

## 仍需处理

- 当前仍有大量未提交源码改动：
  - 不应一次性提交。
  - 建议按阶段 / 子系统拆分检查与提交。
- `Girlfriend.memory-card.json` 已从版本控制移除，但删除状态仍需在后续提交中记录。
- `git fsck --full --no-reflogs` 仍输出大量 dangling blob：
  - 当前没有 missing commit / missing tree / missing blob 破坏主线命令。
  - dangling 对象多数来自替换 Git 元数据和工作区历史残留，不阻止 `git log` / `git diff` / `git status`。
  - 后续可在确认不需要恢复旧对象后再考虑 `git gc`，不要在当前大量未归类改动状态下贸然清理。

## 下一步建议

1. 用 `git status --short --ignored` 确认同步盘根目录不再残留 `.env`、运行日志、构建产物和本地数据库。
2. 按 A-F 分组逐块检查改动，优先提交阶段计划 / 盘点记录，再处理 P0 相关源码。
3. 每次进入功能阶段前，先运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
cd F:\Code\Mirrai
corepack pnpm run check
```
