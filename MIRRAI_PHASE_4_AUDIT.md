# Mirrai 阶段 4 社交 Runtime 统一记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>)

## 本轮完成

### QQ channel 正式进入统一 runtime

- 更新消息 channel 枚举：[schema.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/schema.ts>)
  - `channel` 现在支持 `web`、`wechat`、`qq`。
- 新增迁移：[0005_qq_message_channel.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0005_qq_message_channel.sql>)
  - 向 PostgreSQL enum `channel` 追加 `qq`。
- 更新 QQ 桥接：[persona-bridge.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/persona-bridge.ts>)
  - QQ 文本进入 `handleSocialPersonaTextChatDetailed` 时写入 `channel: "qq"`。
  - QQ 图片 / 表情进入 `handleSocialPersonaMediaChat` 时写入 `channel: "qq"`。
- 更新 shared social runtime 类型：
  - [persona-text-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.ts>)
  - [persona-media-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-media-chat.ts>)
  - `channel` 类型扩展为 `web | wechat | qq`，但平台 prompt / turn planner 仍由 `platform` 控制。
- 新增统一 runtime request 类型锚点：[runtime-request.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/runtime-request.ts>)
  - 明确 `platform`、`channel`、`binding`、`contactName`、`sceneOverlay` 和 `outputPreference` 的共享结构。
  - `resolveRuntimeChannel` 统一处理平台默认 channel：`web -> web`、`wechat -> wechat`、`qq -> qq`。
  - 文本 / 媒体 runtime 落库 channel 统一通过 `resolveRuntimeChannel`，不再各自手写默认值。
  - 新增 `defaultOutputPreferenceForPlatform` 和 `resolveRuntimeOutputPreference`，把三类入口的输出能力集中为 shared runtime contract：
    - Web：允许文本，不允许语音 / 表情 / 主动消息。
    - WeChat：允许文本和主动消息，不允许 QQ 专属语音输出 / 表情包输出。
    - QQ：允许文本、语音、表情和主动消息。
- 更新本轮规划器输出倾向：[persona-turn-planner.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-turn-planner.ts>)
  - `outputPreference.allowVoice=false` 时，语音输入不再规划为 `voice_candidate`，而是回到文本输出倾向。
  - `outputPreference.allowText=false` 时，输出倾向规划为 `silent`。
  - 文本 / 媒体 runtime 调用 `planPersonaTurn` 时都会传入 `outputPreference`。
- 更新入口层能力传入：
  - Web 聊天和图片入口：[routers.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/routers.ts>)
    - 显式传入 `defaultOutputPreferenceForPlatform("web")`。
  - QQ 文本和媒体桥接：[persona-bridge.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/persona-bridge.ts>)
    - 显式传入 `defaultOutputPreferenceForPlatform("qq")`。
  - WeChat 文本和媒体桥接：[persona-bridge.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/persona-bridge.ts>)
    - 显式传入 `defaultOutputPreferenceForPlatform("wechat")`。
- 更新文本 runtime 指令生成：[persona-text-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.ts>)
  - `outputPreference.allowVoice=false` 时，不再向 LLM 写入“本轮回复会被合成一条语音”的语音合成提示。
  - 禁用语音输出的平台不再触发语音意图判断，runtime diagnostic 中记录 `voice_output_disabled_by_platform`。
  - Web / WeChat / QQ 入口共用 `handleSocialPersonaTextChatDetailed` 的核心执行路径；平台差异收敛到 `platform`、`channel` 和 `outputPreference`。
- 更新媒体 runtime 验证：[persona-media-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-media-chat.ts>)
  - Web 图片、WeChat 图片、QQ 表情包共用 `handleSocialPersonaMediaChatDetailed` 的核心执行路径。
  - 媒体 runtime 落库 channel 统一通过 `resolveRuntimeChannel`。
  - 媒体 turn planner 统一规划为 `intent=media`、`outputMode=media_reply`。
- 更新主动消息平台投递：[proactive-delivery.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/proactive-delivery.ts>)
  - QQ 绑定存在时，主动消息投递结果使用 `channel: "qq"`，不再落成 `web`。
  - QQ 离线失败结果也保留 `channel: "qq"`，方便诊断知道失败发生在 QQ 平台。
  - 新增 `resolveProactivePreferredTarget`，在生成主动消息前即可解析计划投递的 platform / channel。
- 新增主动消息 runtime planning：[proactive-runtime.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/proactive-runtime.ts>)
  - 主动消息使用统一 `planPersonaTurn({ mode: "proactive" })`。
  - 主动消息根据计划投递目标套用同一份 platform output capability。
  - 无外部绑定时回落到 web runtime contract，`allowProactive=false` 会规划为 `silent`。
- 更新主动消息生成：
  - 定时主动消息：[proactive-scheduler.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/proactive-scheduler.ts>)
  - 环境存在感主动消息：[ambient-proactive.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/ambient-proactive.ts>)
  - 生成 prompt 的 system 部分现在包含主动消息 turn planner 指令。
  - 用户 prompt 标明计划投递入口，例如 `qq / qq` 或 `wechat / wechat`。
- 更新聊天页徽标：[Chat.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Chat.tsx>)
  - 历史消息中 `channel === "qq"` 时显示 QQ 徽标。

### Runtime diagnostics 补齐

- 更新媒体 runtime：[persona-media-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-media-chat.ts>)
  - 图片 / 表情回复成功后，写入 `personaRuntime.runtimeDiagnostics`。
  - diagnostics 包含 `platform`、`channel`、`mode`、`inputPreview`、`replyPreview`、`mediaKind`、`mediaUrl`、`turnPlan`、`memoryRecallUsed` 和 `visionUsed`。
  - 保留原有 `chatCount`、`lastChatAt`、`emotionalState` 更新。
- 更新主动消息 runtime：[proactive-runtime.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/proactive-runtime.ts>)
  - 新增 `buildProactiveRuntimeDiagnostics`，统一 scheduled / ambient 主动消息的诊断结构。
  - diagnostics 使用 `mode: "proactive"`，通过 `trigger: "scheduled" | "ambient"` 区分触发来源。
  - 记录计划投递 `platform` / `channel`、`outputPreference`、`turnPlan`、`delivery` 和回复摘要。
- 更新定时主动消息：[proactive-scheduler.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/proactive-scheduler.ts>)
  - 新增 `generateProactiveMessageDetailed`，保留原 `generateProactiveMessage` 字符串返回契约。
  - 主动消息成功投递后，把 scheduled slot、delivery 和 proactive turn plan 写入 runtime diagnostics。
  - 导出 `runProactiveTick` 作为 focused 测试入口，不改变 scheduler 启动逻辑。
- 更新环境主动消息：[ambient-proactive.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/ambient-proactive.ts>)
  - 新增 `generateAmbientMessageDetailed`，保留原 `generateAmbientMessage` 字符串返回契约。
  - 环境存在感主动消息成功投递后，把 event、period、ambientPresence、delivery 和 proactive turn plan 写入 runtime diagnostics。

### 回归测试

- 新增 [persona-bridge.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/persona-bridge.test.ts>)
  - 断言 QQ 文本桥接调用 shared text runtime 时传入 `platform: "qq"` 和 `channel: "qq"`。
  - 断言 QQ 媒体桥接调用 shared media runtime 时传入 `platform: "qq"` 和 `channel: "qq"`。
- 新增 [persona-bridge.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/persona-bridge.test.ts>)
  - 断言 WeChat 文本桥接调用 shared text runtime 时传入 `platform: "wechat"`、`channel: "wechat"` 和 WeChat 输出能力。
  - 断言 WeChat 媒体桥接调用 shared media runtime 时传入 `platform: "wechat"`、`channel: "wechat"` 和 WeChat 输出能力。
- 新增 [proactive-delivery.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/proactive-delivery.test.ts>)
  - 断言 QQ 主动消息发送成功时返回 `channel: "qq"`。
  - 断言 QQ 离线失败时仍返回 `channel: "qq"`，并不回退成网页 channel。
  - 断言主动消息生成前的首选目标解析会按 QQ / WeChat / 无绑定返回对应 runtime target。
- 新增 [proactive-runtime.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/proactive-runtime.test.ts>)
  - 断言主动消息 runtime plan 使用目标平台的输出能力。
  - 断言无外部目标时回到 web contract，并规划为静默。
- 新增 [proactive-runtime-generation.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/proactive-runtime-generation.test.ts>)
  - 断言定时主动消息生成 prompt 包含 proactive turn planner 指令。
  - 断言环境主动消息生成 prompt 包含 proactive turn planner 指令。
  - 断言 scheduled 主动消息成功投递后写入 runtime diagnostics。
  - 断言 ambient 主动消息成功投递后写入 runtime diagnostics。
  - 断言 diagnostics 中保留 trigger、planned platform / channel、delivery 和 proactive turn plan。
- 新增 [runtime-request.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/runtime-request.test.ts>)
  - 断言平台默认 channel 映射正确。
  - 断言显式 channel override 会被保留。
  - 断言 Web / WeChat / QQ 的默认输出能力正确。
  - 断言调用方可以按请求覆盖单项输出能力。
- 更新 [persona-turn-planner.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-turn-planner.test.ts>)
  - 断言 `allowVoice=false` 会阻止语音候选输出。
  - 断言 `allowText=false` 会规划为静默输出。
  - 断言 `mode: "proactive"` 会规划为短消息，并尊重 `allowProactive=false`。
- 更新 [persona-text-chat.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.test.ts>)
  - 断言平台禁用语音输出时，即使用户说“用语音回我”，也不会注入语音合成提示。
- 新增 [persona-text-runtime-platform.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-runtime-platform.test.ts>)
  - 运行真实 `handleSocialPersonaTextChatDetailed` 主体，mock DB / LLM / 外部召回边界。
  - 断言 Web / WeChat / QQ 同一句输入都写入各自 channel。
  - 断言三入口都生成同一套 turn planner、长期记忆上下文、平台一致性提示和 runtime diagnostics。
  - 断言平台差异只体现在 `platform` 标签和语音输出能力：Web / WeChat 记录 `voice_output_disabled_by_platform`，QQ 走语音意图判断结果。
- 新增 [persona-media-runtime-platform.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-media-runtime-platform.test.ts>)
  - 运行真实 `handleSocialPersonaMediaChatDetailed` 主体，mock DB / LLM / vision / storage 边界。
  - 断言 Web 图片、WeChat 图片、QQ 表情包都会写入各自 channel。
  - 断言三入口都生成 media turn planner、长期记忆上下文和平台一致性 prompt。
  - 断言平台差异体现在 storage prefix、媒体标签和当前用户媒体指令：`网页图片`、`微信图片`、`QQ表情包`。
  - 断言媒体回复会写入 `personaRuntime.runtimeDiagnostics.turnPlan`。

## 验证结果

已先同步源码到本机运行目录：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

在本机运行目录 `F:/Code/Mirrai` 通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

在本机运行目录 `F:/Code/Mirrai` 通过 Phase 4 focused 测试：

```powershell
corepack pnpm exec vitest run server/social/runtime-request.test.ts server/social/persona-turn-planner.test.ts server/qq/persona-bridge.test.ts server/social/proactive-delivery.test.ts server/social/persona-text-chat.test.ts server/social/source-grounding.test.ts server/social/source-recall.test.ts
```

结果：7 个测试文件、28 个测试全部通过。

本轮继续推进平台能力显式传入后，已再次同步源码到本机运行目录，并在 `F:/Code/Mirrai` 通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

本轮 Phase 4 focused 测试命令：

```powershell
corepack pnpm exec vitest run server/social/runtime-request.test.ts server/social/persona-turn-planner.test.ts server/qq/persona-bridge.test.ts server/wechat/persona-bridge.test.ts server/social/proactive-delivery.test.ts server/social/persona-text-chat.test.ts server/social/source-grounding.test.ts server/social/source-recall.test.ts
```

结果：8 个测试文件、33 个测试全部通过。

本轮继续把主动消息生成接入 proactive turn planner 后，已再次同步源码到本机运行目录，并在 `F:/Code/Mirrai` 通过 focused 测试：

```powershell
corepack pnpm exec vitest run server/social/persona-turn-planner.test.ts server/social/proactive-runtime.test.ts server/social/proactive-delivery.test.ts server/wechat/proactive-scheduler.test.ts server/wechat/proactive-runtime-generation.test.ts server/social/runtime-request.test.ts server/qq/persona-bridge.test.ts server/wechat/persona-bridge.test.ts server/social/persona-text-chat.test.ts
```

结果：9 个测试文件、35 个测试全部通过。

随后通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

本轮继续补 Web / WeChat / QQ shared runtime 集成式测试后，已再次同步源码到本机运行目录，并在 `F:/Code/Mirrai` 通过 focused 测试：

```powershell
corepack pnpm exec vitest run server/social/persona-text-runtime-platform.test.ts server/social/persona-text-chat.test.ts server/social/runtime-request.test.ts server/social/persona-turn-planner.test.ts server/qq/persona-bridge.test.ts server/wechat/persona-bridge.test.ts server/social/proactive-runtime.test.ts server/social/proactive-delivery.test.ts server/wechat/proactive-runtime-generation.test.ts
```

结果：9 个测试文件、33 个测试全部通过。

随后通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

本轮继续补 Web / WeChat / QQ media runtime 集成式测试后，已再次同步源码到本机运行目录，并在 `F:/Code/Mirrai` 通过 focused 测试：

```powershell
corepack pnpm exec vitest run server/social/persona-media-runtime-platform.test.ts server/social/persona-text-runtime-platform.test.ts server/social/persona-text-chat.test.ts server/social/runtime-request.test.ts server/social/persona-turn-planner.test.ts server/qq/persona-bridge.test.ts server/wechat/persona-bridge.test.ts server/social/proactive-runtime.test.ts server/social/proactive-delivery.test.ts server/wechat/proactive-runtime-generation.test.ts
```

结果：10 个测试文件、34 个测试全部通过。

随后通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

本轮继续补媒体 / 主动消息 runtime diagnostics 后，已再次同步源码到本机运行目录，并在 `F:/Code/Mirrai` 通过 focused 测试：

```powershell
corepack pnpm exec vitest run server/social/persona-media-runtime-platform.test.ts server/wechat/proactive-runtime-generation.test.ts server/social/proactive-runtime.test.ts server/social/proactive-delivery.test.ts server/wechat/proactive-scheduler.test.ts server/social/runtime-request.test.ts server/social/persona-turn-planner.test.ts
```

结果：7 个测试文件、26 个测试全部通过。

随后通过类型检查：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

同步盘源码目录卫生检查通过：

```powershell
node_modules、.env、dist、.vite、uploads 均不存在
```

## 注意事项

- 本轮没有启动真实网页或 QQ 服务；前端 QQ 徽标只通过类型检查覆盖，尚未做浏览器截图验证。
- 本轮没有迁移真实 Neon / 本机 PostgreSQL；迁移文件已写入，后续部署或本机 DB 准备时需要执行 `corepack pnpm run db:migrate` 或对应本机数据库准备流程。
- `drizzle/meta/_journal.json` 当前仓库只登记了初始迁移，已有后续迁移也是手写 SQL 文件；本轮沿用现有目录风格，没有改 journal。
- 历史中已经落成 `web` 的 QQ 消息不会自动回填为 `qq`；本轮只保证新写入的 QQ 文本、媒体和主动消息使用正确 channel。

## 下一步建议

1. 进入 Phase 5，梳理现有调试面板读取 `personaRuntime.runtimeDiagnostics` 的字段覆盖情况。
2. 把最近一次文本 / 媒体 / 主动消息的 `platform`、`channel`、`mode`、`trigger`、`turnPlan` 和 `delivery` 做成可扫描的诊断分区。
3. 同步到 `F:/Code/Mirrai` 后启动本机服务，做一次浏览器验证：调试面板字段可读，聊天历史 QQ / 微信徽标不会造成移动端文本挤压。
