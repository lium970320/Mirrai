# Mirrai Plan2 阶段 0 收口与提交基线记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)

## 进入 Plan2 的判定

Plan1 已满足进入 Plan2 的条件：

- [MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>) 已记录阶段 1-5 的当前基线完成情况。
- 阶段审计文件已齐备：
  - [MIRRAI_PHASE_1_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_1_AUDIT.md>)
  - [MIRRAI_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_2_AUDIT.md>)
  - [MIRRAI_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_3_AUDIT.md>)
  - [MIRRAI_PHASE_4_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_4_AUDIT.md>)
  - [MIRRAI_PHASE_5_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_5_AUDIT.md>)
- [docs/todo.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/todo.md>) 已同步 Plan1 的 P0 / P1 基线完成状态。
- 同步盘源码目录检查未发现 `.env`、`node_modules`、`dist`、`.vite`、`uploads`。
- 原自动心跳 `plan1-plan2` 已删除，避免重复检查 Plan1；当前线程已创建目标模式，持续推进 Plan2。

## Plan2 范围再校准

Plan1 后半段已经提前完成了 Plan2 原设的部分内容，因此 Plan2 后续执行顺序需要重排：

- Plan2 阶段 2“运行态与 LLM 用量持久化”已部分完成：
  - `llm_usage_records` 已存在。
  - LLM usage 已支持数据库持久化、内存 fallback、今日 / 本周 / 本月汇总。
  - 已增加 `userId` / `personaId` / `route` 成本归属。
  - 运行态仍主要通过 `personaData.personaRuntime` 兼容层保存，尚未独立表化。
- Plan2 阶段 3“额度、成本与省额度模式”已完成第一版：
  - 已有每日 / 月度软额度诊断。
  - 已有 `off` / `conservative` / `strict` economy policy。
  - 已接入语音智能判断、TTS 润色、主动消息、原著证据改写 token 上限等低价值链路降级。
- Plan2 阶段 4“社交适配层正式统一”已完成基线：
  - 已有 `runtime-request` contract。
  - Web / WeChat / QQ 文本与媒体入口共用 shared runtime。
  - 主动消息接入 proactive turn planner 和 runtime diagnostics。
- Plan2 阶段 8“设置页与诊断体验整理”已完成一部分：
  - 设置页已有“运维诊断”页签。
  - 聊天页入口已改为“运行诊断”。
  - 桌面和移动视口已做浏览器验证。

Plan2 后续应优先推进这些仍未真正完成的部分：

1. 发布候选基线与回归矩阵。
2. 真实 QQ / NapCat 端到端验证。
3. runtime 独立持久化是否值得做的设计决策。
4. 长期记忆治理与资料库产品化。
5. Roleplay Beta 收束。
6. 备份、导出、删除与数据安全。

## 当前工作区分组

当前工作区仍是一个大改集合，不建议一次性提交。建议按下面分组审查与提交。

### A. 计划、审计和路线图

- [MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>)
- [MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)
- [MIRRAI_PLAN2_PHASE_0_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_0_AUDIT.md>)
- [MIRRAI_PHASE_1_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_1_AUDIT.md>)
- [MIRRAI_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_2_AUDIT.md>)
- [MIRRAI_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_3_AUDIT.md>)
- [MIRRAI_PHASE_4_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_4_AUDIT.md>)
- [MIRRAI_PHASE_5_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_5_AUDIT.md>)
- [docs/todo.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/todo.md>)
- [docs/release-candidate-checklist.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/release-candidate-checklist.md>)

建议作为第一批提交，方便后续代码提交都有文档坐标。

### B. 同步盘与本机运行脚本

- [.gitignore](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/.gitignore>)
- [AGENTS.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/AGENTS.md>)
- [README.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/README.md>)
- [docs/windows-google-drive-workflow.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/windows-google-drive-workflow.md>)
- [scripts/sync-local-worktree.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/sync-local-worktree.ps1>)
- [scripts/dev-local.mjs](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/dev-local.mjs>)
- [scripts/start-mirrai.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/start-mirrai.ps1>)
- [scripts/stop-mirrai.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/stop-mirrai.ps1>)
- [scripts/status-mirrai.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/status-mirrai.ps1>)
- [scripts/start-all.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/start-all.ps1>)
- [scripts/start-qq.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/start-qq.ps1>)

重点审查：是否继续严格排除运行产物；是否会误删源码；是否要求从 [F:/Code/Mirrai](<F:/Code/Mirrai>) 运行。

### C. 数据库与迁移

- [drizzle/schema.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/schema.ts>)
- [drizzle/0003_roleplay_channels.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0003_roleplay_channels.sql>)
- [drizzle/0004_structured_memory_cards.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0004_structured_memory_cards.sql>)
- [drizzle/0005_qq_message_channel.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0005_qq_message_channel.sql>)
- [drizzle/0006_llm_usage_records.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0006_llm_usage_records.sql>)
- [drizzle/0007_llm_usage_attribution.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0007_llm_usage_attribution.sql>)
- [server/db.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/db.ts>)

重点审查：

- `drizzle/meta/` 当前被 `.gitignore` 忽略，且工作区显示为 ignored；现有迁移沿用手写 SQL 风格。
- 正式 Neon 需要显式执行迁移；本机自动补表 / 补列只用于旧本机库兼容。
- `llm_usage_records` 只保存统计元数据，不保存完整 prompt、用户消息和回复全文。

### D. LLM 用量、路由、省额度与诊断

- [.env.example](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/.env.example>)
- [server/llm/usage.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/usage.ts>)
- [server/llm/usage.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/usage.test.ts>)
- [server/llm/deepseek-routing.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/deepseek-routing.ts>)
- [server/llm/deepseek-routing.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/deepseek-routing.test.ts>)
- [server/llm/economy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/economy.ts>)
- [server/llm/economy.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/economy.test.ts>)
- [server/llm/index.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/index.ts>)
- [server/llm/types.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/types.ts>)
- [server/_core/systemRouter.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/systemRouter.ts>)
- [server/social/output-diagnostics.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.ts>)
- [server/social/output-diagnostics.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.test.ts>)

建议作为一批独立提交，因为它跨 DB、server 和 UI 诊断。

### E. Persona runtime、长期记忆与原著资料库

- [server/_core/persona-runtime.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/persona-runtime.ts>)
- [server/_core/persona-runtime.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/persona-runtime.test.ts>)
- [server/_core/persona-profile.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/persona-profile.ts>)
- [server/_core/persona-profile.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/persona-profile.test.ts>)
- [server/social/memory-card.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/memory-card.ts>)
- [server/social/memory-card.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/memory-card.test.ts>)
- [server/social/memory-consolidation.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/memory-consolidation.ts>)
- [server/social/memory-governance.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/memory-governance.ts>)
- [server/social/memory-recall.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/memory-recall.ts>)
- [server/social/source-grounding.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/source-grounding.ts>)
- [server/social/source-recall.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/source-recall.ts>)
- [docs/persona-long-memory-proactive.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/persona-long-memory-proactive.md>)

Plan2 后续阶段 6 会继续接这部分，重点从“能运行”推进到“可编辑、可解释、可治理”。

### F. 社交 runtime、QQ / WeChat 适配与主动消息

- [server/social/runtime-request.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/runtime-request.ts>)
- [server/social/runtime-request.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/runtime-request.test.ts>)
- [server/social/persona-text-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-chat.ts>)
- [server/social/persona-text-runtime-platform.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-text-runtime-platform.test.ts>)
- [server/social/persona-media-chat.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-media-chat.ts>)
- [server/social/persona-media-runtime-platform.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/persona-media-runtime-platform.test.ts>)
- [server/social/proactive-runtime.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/proactive-runtime.ts>)
- [server/social/proactive-delivery.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/proactive-delivery.ts>)
- [server/qq/message-handler.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/message-handler.ts>)
- [server/qq/message-handler.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/message-handler.test.ts>)
- [server/qq/persona-bridge.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/persona-bridge.ts>)
- [server/qq/persona-bridge.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/qq/persona-bridge.test.ts>)
- [server/wechat/persona-bridge.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/persona-bridge.ts>)
- [server/wechat/persona-bridge.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/persona-bridge.test.ts>)
- [server/wechat/proactive-scheduler.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/proactive-scheduler.ts>)
- [server/wechat/ambient-proactive.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/wechat/ambient-proactive.ts>)

Plan2 阶段 5 的真实 QQ / NapCat 端到端验证应从这里继续。

### G. 语音、TTS、表情包

- [server/_core/tts.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/_core/tts.ts>)
- [server/voice/voice-reply-policy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/voice-reply-policy.ts>)
- [server/voice/voice-reply-policy.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/voice-reply-policy.test.ts>)
- [server/voice/audio-normalizer.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/audio-normalizer.ts>)
- [server/voice/zhipu-asr.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/zhipu-asr.ts>)
- [server/voice/voxcpm-voice-profile.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/voice/voxcpm-voice-profile.ts>)
- [server/stickers/sticker-policy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/stickers/sticker-policy.ts>)
- [server/stickers/sticker-selector.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/stickers/sticker-selector.ts>)
- [server/stickers/sticker-sender.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/stickers/sticker-sender.ts>)

重点审查：失败不能中断主文字回复；省额度模式不应阻断用户显式要求的语音。

### H. UI 与设置页

- [client/src/pages/Chat.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Chat.tsx>)
- [client/src/components/PersonaStatePanel.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/components/PersonaStatePanel.tsx>)
- [client/src/pages/Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
- [client/src/pages/PersonaEdit.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/PersonaEdit.tsx>)
- [client/src/pages/Lobby.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Lobby.tsx>)
- [client/src/index.css](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/index.css>)
- [docs/antigravity-ui-handoff.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/antigravity-ui-handoff.md>)

重点审查：桌面和移动视口无页面级横向溢出；诊断文案保持工具化。

### I. Roleplay

- [client/src/pages/Roleplay.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Roleplay.tsx>)
- [server/social/roleplay-channel.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/roleplay-channel.ts>)
- [server/social/roleplay-channel.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/roleplay-channel.test.ts>)
- [drizzle/0003_roleplay_channels.sql](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/drizzle/0003_roleplay_channels.sql>)

Plan2 阶段 7 会继续收束为 Beta；当前不要让 Roleplay 影响一对一聊天主链路。

### J. 人设材料与漫画生产线

- [persona_material](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/persona_material>)
- [live-action-comic](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/live-action-comic>)

这部分属于素材和独立生产线，不建议混入 Mirrai 应用内核提交。需要单独审查、单独提交或单独归档。

## 第一批提交建议

建议最小提交顺序：

1. `docs(plan): capture Plan1 audits and Plan2 baseline`
   - 包含 Plan1 / Plan2 / Phase 0 / release checklist / todo。
2. `chore(workflow): protect sync source and local runtime scripts`
   - 包含 `.gitignore`、sync / start / stop / status 脚本和本机运行文档。
3. `feat(observability): persist llm usage and economy policy`
   - 包含 DB、LLM usage、economy、operations diagnostics、Settings 相关 UI。
4. `feat(runtime): unify social runtime platform contract`
   - 包含 runtime-request、text/media runtime、QQ / WeChat bridge、proactive runtime。
5. `feat(memory): add structured memory and source grounding baseline`
   - 包含长期记忆、资料库召回、治理测试。
6. `feat(qq): stabilize onebot voice and sticker fallback`
   - 包含 QQ handler、语音、表情包策略。
7. `feat(ui): add runtime diagnostics surfaces`
   - 包含 Chat、PersonaStatePanel、Settings、CSS。
8. `feat(roleplay): add roleplay channel beta`
   - 独立提交，避免和主社交 runtime 混在一起。
9. `docs/assets): add persona and comic production materials`
   - 人设材料和 `live-action-comic` 独立提交；如果文件过多，建议再拆。

## 当前风险

- 工作区仍有大量未提交改动，必须避免一次性提交。
- `drizzle/meta/` 当前被忽略；如果后续决定改用 drizzle-kit 标准 journal，需要单独计划，不能和手写迁移混改。
- 正式数据库迁移尚需执行确认，本机自动补表不能替代 Neon 部署迁移。
- 真实 QQ / NapCat 端到端验证仍未完成，这是 Plan2 P1。
- `Girlfriend.memory-card.json` 已删除，后续提交时需要明确这是运行态文件移出源码树。
- `live-action-comic` 是独立生产线，不应阻塞 Mirrai 应用内核提交。

## 阶段 0 验收项

- [x] 确认 Plan1 阶段 1-5 完成信号。
- [x] 删除 Plan1 检查心跳，避免重复触发。
- [x] 启动 Plan2 目标模式。
- [x] 同步盘源码目录无 `.env`、`node_modules`、`dist`、`.vite`、`uploads`。
- [x] 创建当前工作区分组与提交建议。
- [x] 创建发布候选回归清单。
- [x] 同步到 [F:/Code/Mirrai](<F:/Code/Mirrai>) 并运行 `corepack pnpm run check`。
- [x] 根据验证结果更新本记录。

## 阶段 0 验证结果

已从同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

结果：同步到 [F:/Code/Mirrai](<F:/Code/Mirrai>) 成功，未复制 `.env`、`node_modules`、`dist`、`.vite`、`uploads` 等运行产物。

已从本机运行目录执行：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

## 阶段 0 结论

Plan2 阶段 0 已完成：当前工作区已经按主题分组，发布候选回归清单已创建，同步盘卫生和本机类型检查通过。下一步应进入 Plan2 阶段 1，把回归矩阵从文档推进到一次实际 focused test 基线，并决定第一批提交拆分。
