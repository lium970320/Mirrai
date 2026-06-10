# Mirrai Plan2 阶段 9 数据安全、导出与删除记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)

## 阶段目标

阶段 9 的目标是把 Mirrai 的私密数据边界收口清楚：用户能导出自己的主要数据，删除账户或角色时不会留下新增表里的孤立私密记录，本机运行产物和同步盘源码继续分离。

## 本轮完成内容

### 账户删除补齐

修改位置：

- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)

变更：

- `deleteUserAccount` 新增清理：
  - `llm_usage_records`
  - `diary_entries`
  - `roleplay_messages`
  - `roleplay_channel_members`
  - `roleplay_channels`
  - `wechat_bot_state`
  - `skill_jobs`
  - 自定义 `scenes`
- 删除 LLM usage 时同时覆盖 `userId` 命中和该用户 personaId 命中的记录，减少早期未写 userId 的孤立 usage 风险。
- 新增 `USER_ACCOUNT_DELETE_SECTIONS`，把账户删除应覆盖的数据区块显式列出来，便于测试和后续维护。

### 角色删除补齐

修改位置：

- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
- [server/social/roleplay-channel-policy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/roleplay-channel-policy.ts>)
- [server/social/roleplay-channel.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/roleplay-channel.test.ts>)

变更：

- `deletePersona` 新增清理该角色关联的 `diary_entries`。
- 保持已有清理：消息、记忆、情绪快照、资料库 chunks/source、roleplay 消息和成员、微信 / QQ 绑定、skill jobs。
- `deletePersona` 在删除 roleplay 成员关系前记录受影响频道，并在删除后复核剩余成员数。
- 如果频道剩余成员少于 2 个，自动把 `roleplay_channels.isActive` 标记为 `false` 并刷新 `updatedAt`。
- 频道和历史消息不会被自动删除，用户仍可在历史壳里查看记录，但 runtime 已不会继续推进成员不足的频道。
- 新增 `shouldDeactivateRoleplayChannelAfterMemberRemoval` 纯函数测试，固定 0/1 成员停用、2 成员继续可用的策略。

### 用户导出补齐

修改位置：

- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)
- [server/data-export.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/data-export.test.ts>)

变更：

- `exportUserData` 从只导出 `user / personas / messages` 扩展为 schemaVersion 2：
  - personas
  - messages
  - personaFiles
  - personaSources
  - personaSourceChunks
  - memories
  - emotionSnapshots
  - diaryEntries
  - roleplayChannels
  - roleplayChannelMembers
  - roleplayMessages
  - wechatBindings，包括 QQ contact 前缀绑定
  - skillJobs
  - llmUsageRecords
  - personaRuntimeStates
  - llmConfigs 的非密钥配置
  - wechatBotState
  - 自定义 scenes
- 新增 `buildUserDataExportPayload` 纯函数，统一导出结构和敏感字段脱敏。
- 导出明确不包含：
  - `users.passwordHash`
  - `llm_configs.apiKey`
  - session cookie
  - 本机上传文件实体、TTS 缓存、NapCat 状态、本机数据库文件
- 新增 `USER_DATA_EXPORT_SECTIONS`，让导出 section 有测试约束。
- 后续 Phase 2 runtime 表化已把 `personaRuntimeStates` 纳入导出 / 删除清单；详见 [MIRRAI_PLAN2_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_2_AUDIT.md>)。

### 本机缓存清理入口

修改位置：

- [scripts/cleanup-local-runtime.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/cleanup-local-runtime.ps1>)

变更：

- 新增本机运行产物清理脚本，默认 dry run。
- 只允许清理 [F:/Code/Mirrai](<F:/Code/Mirrai>) 和 [Mirrai](<F:/.mirrai-local/Mirrai>) 下的已选择目录。
- 支持显式选择：
  - `-IncludeUploads`
  - `-IncludeTtsCache`
  - `-IncludeLogs`
  - `-IncludeTmp`
  - `-IncludePlaywright`
  - `-IncludeWechatSession`
  - `-IncludeScreenshots`
  - `-IncludeNapCatDownloads`
- 新增大型 / 登录态运行时清理入口，但必须二次确认：
  - `-IncludeNapCatRuntime`：NapCat 工具、QQ 登录态和下载目录。
  - `-IncludeVoxcpmRuntime`：VoxCPM runtime。
  - `-IncludeTorchRuntime`：本机 torch runtime。
  - `-IncludeModelCaches`：Hugging Face 和 ModelScope 模型缓存。
- 大型 / 登录态目标即使传入 `-Apply`，也必须同时传入 `-ConfirmLargeRuntimeCleanup 'DELETE LARGE MIRRAI RUNTIME'`，避免误删后需要重新登录 QQ、重装 VoxCPM 或重下载模型。
- 只有传入 `-Apply` 才会执行删除；删除前会解析绝对路径并确认目标位于允许的本机运行根目录下。
- 目标列表会去重并去掉已被父目录覆盖的子目录，避免同时选择 `uploads` 和 `uploads/tts` 时重复删除。

### 设置页数据管理说明

修改位置：

- [client/src/pages/Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)

变更：

- 存储概览增加记忆、资料、Roleplay 频道和 LLM 用量记录计数。
- 数据导出说明明确覆盖账户资料、分身、对话、记忆、资料库、日记、Roleplay、平台绑定和 LLM 用量。
- 数据导出说明明确不包含密码哈希、会话 Cookie、LLM API Key、本机上传文件实体、TTS 缓存和本机数据库文件。

## 验证命令与结果

同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

结果：同步到 [F:/Code/Mirrai](<F:/Code/Mirrai>) 成功。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/data-export.test.ts
```

结果：通过，`1 passed / 3 tests passed`。

本机运行目录执行：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/social/roleplay-channel.test.ts server/data-export.test.ts server/_core/persona-runtime.test.ts
```

结果：通过，`3 passed / 17 tests passed`。

本机运行目录执行：

```powershell
corepack pnpm run db:check
```

结果：通过，`Status: OK (0 missing)`。

本机运行目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/cleanup-local-runtime.ps1 -IncludeTtsCache -IncludeTmp -IncludePlaywright
powershell -ExecutionPolicy Bypass -File scripts/cleanup-local-runtime.ps1 -IncludeNapCatRuntime -IncludeVoxcpmRuntime -IncludeModelCaches
powershell -ExecutionPolicy Bypass -File scripts/cleanup-local-runtime.ps1 -IncludeNapCatRuntime -Apply
```

结果：

- 普通 dry run 通过，列出 `uploads/tts`、`tmp`、`screenshots` 和 `tools/napcat/downloads` 等本机目标；未删除文件。
- 大型 / 登录态运行时 dry run 通过，列出 `tools/napcat`、`voxcpm`、`torch`、`huggingface`、`modelscope`，并提示需要 `-ConfirmLargeRuntimeCleanup 'DELETE LARGE MIRRAI RUNTIME'` 才允许实际删除。
- `-IncludeNapCatRuntime -Apply` 但不传确认短语时，脚本拒绝删除并退出；复查 `tools/napcat`、`voxcpm`、`huggingface`、`modelscope` 均仍存在。

浏览器导出 smoke：

- 使用本机服务 [http://127.0.0.1:3000](http://127.0.0.1:3000)。
- 创建临时用户 `codex_export_smoke_*`，并写入：
  - ready persona
  - 一条消息
  - 一条长期记忆
  - 一个资料 source 和 chunk
  - 一个 Roleplay 频道和消息
  - 一条 LLM usage 记录
- 打开设置页“数据管理”，点击“导出全部数据”并读取下载 JSON。
- 验证：
  - `schemaVersion === 2`
  - 当前用户、persona、message、memory、source、source chunk、roleplay channel、roleplay message、LLM usage 均在导出中。
  - 导出 JSON 不包含 `passwordHash` 字段名。
  - 导出 JSON 不包含 `apiKey` 字段名。
  - 导出 JSON 不包含注册密码明文。
  - 建议文件名为 `mirrai-export-2026-06-08.json`。
- 临时用户和关联数据已通过 `deleteUserAccount` 清理。

## 当前缺口

- 导出 JSON 目前包含上传文件元数据和 URL，不内嵌文件内容；如果未来需要“完整备份包”，需要单独设计压缩包导出。
- 删除角色后如果 roleplay 频道只剩 0 或 1 个成员，当前会自动停用频道并保留历史壳；后续如需频道级归档 / 复制 / 导出，可进入 Roleplay 产品增强。
- NapCat 工具目录、VoxCPM runtime、torch runtime、Hugging Face / ModelScope 缓存已支持显式 dry-run 和二次确认删除；仍不应作为默认清理项。

## 阶段 9 当前结论

阶段 9 主要数据安全收口已完成：账户删除和用户导出已覆盖 Plan2 新增的 roleplay、memory、source library、LLM usage、persona runtime、diary、skill job 和平台绑定等主要私密数据；删除角色会清理关联私密数据，并自动停用成员不足的 roleplay 历史频道；数据管理页说明了导出范围和排除的敏感内容；本机运行产物有 dry-run 默认的安全清理脚本；真实页面导出 smoke 已确认下载 JSON 结构和敏感字段排除。未来如需“完整备份包”，还需要单独设计上传文件实体打包导出。
