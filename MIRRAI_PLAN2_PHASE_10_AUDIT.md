# Mirrai Plan2 阶段 10 后续分支决策与收尾记录

记录时间：2026-06-09  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)

## 阶段目标

阶段 10 的目标是把 Plan2 主线从“继续补一点”收束成可关闭状态：明确哪些能力已经进入日常稳定运行基线，哪些只依赖外部输入等待复验，哪些应进入后续计划或专项，不再把所有愿望挂在 Plan2 里。

## Plan2 主线完成范围

- 阶段 0：Plan1 收口与提交基线已完成，计划 / 审计 / 回归清单已建立。
- 阶段 1：发布候选基线与最小回归矩阵已完成，`docs/release-candidate-checklist.md` 持续记录验证命令和结果。
- 阶段 2：`persona_runtime_states` 表化、runtime 读写拆分、导出 / 删除覆盖和 focused tests 已完成。
- 阶段 3：省额度模式的上下文、记忆召回、资料库召回和证据改写上限已在诊断中可见。
- 阶段 4：本机库迁移确认工具已完成，`db:check` / `db:local:check` / `db:local:prepare` 形成闭环。
- 阶段 5：QQ / OneBot 文档、只读预检、日志证据脚本和 webhook smoke 已完成；2026-06-09 复核时 Mirrai Web、NapCat / QQ 和 OneBot 均在线，当前只等待测试联系人真实私聊。
- 阶段 6：长期记忆治理和资料库只读产品化第一版已完成，桌面 / 移动 smoke 已通过。
- 阶段 7：Roleplay Beta 核心收束已完成，频道导出 / 删除和孤立频道停用已在阶段 9 补齐。
- 阶段 8：设置页持久化与数据安全可见性、LLM 上限说明和桌面 / 移动视觉复验已完成。
- 阶段 9：用户导出、账户 / 角色删除、本机清理脚本、大型运行时二次确认删除和 roleplay 孤立频道策略已完成。

## 留给外部输入的事项

这些事项不是当前代码或文档阻塞，不能靠本线程独立完成：

- 真实 QQ 私聊 E2E：等待测试联系人或测试小号给机器人 QQ 发起私聊。已创建 baseline：[qq-e2e-baseline-2026-06-09.json](<F:/.mirrai-local/Mirrai/logs/qq-e2e-baseline-2026-06-09.json>)。
- 真实 QQ 语音、图片 / 表情包和主动消息在线验证：应在私聊文本打通后继续按 [qq-e2e-verification.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/qq-e2e-verification.md>) 执行。
- Neon / 远程 PostgreSQL 真实部署库验证：需要切换到目标远程库后执行 `corepack pnpm run db:check`。
- 真实 LLM Roleplay 发言质量抽样：需要消耗 LLM 预算，不作为 Plan2 收口阻塞。

## 转入后续计划的事项

- 完整备份包：当前导出 JSON 覆盖主要私密数据和上传文件元数据，但不内嵌上传文件实体；如果需要完整备份包，应单独设计压缩包导出、文件打包和恢复策略。
- 更完整账单报表：用量导出、分页游标、按日期聚合、真实多用户账单级明细筛选可进入运营增强计划。
- 自动记忆候选确认、资料库重新导入 / 删除、证据使用记录：进入长期记忆 / 资料库产品化后续计划。
- Roleplay 产品增强：频道搜索、归档、频道级复制 / 导出、真实发言质量评测进入 Roleplay 后续计划。
- VoxCPM 音色生产：`comfort`、`tease`、`angry_soft`、`sad_low` 的干净参考音频需要素材生产专项。
- 表情包素材生产：替换占位素材、建立角色专属表情包库和审核流程进入素材专项。
- 打包发布：Windows / macOS 安装包、本机 PostgreSQL 编排、日志面板和升级策略进入发布工程计划。

## 收尾验证

已在本机运行目录 [F:/Code/Mirrai](<F:/Code/Mirrai>) 执行：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/social/roleplay-channel.test.ts server/data-export.test.ts server/_core/persona-runtime.test.ts server/qq/message-handler.test.ts
corepack pnpm run db:check
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-readiness.ps1 -Json
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -Json
powershell -ExecutionPolicy Bypass -File scripts/check-qq-webhook-smoke.ps1
```

结果：

- `corepack pnpm run check` 通过。
- focused tests 通过：`4 passed / 35 tests passed`。
- `corepack pnpm run db:check` 通过，`Status: OK (0 missing)`。
- QQ / OneBot 只读复核通过：Mirrai Web `200`，NapCat / QQ 进程在线，OneBot `OK`，`readyForManualE2E=true`。
- QQ webhook smoke 通过，返回 `ignored_self_message`。
- QQ 真实 inbound / outbound 证据仍等待测试联系人私聊。

## 阶段 10 当前结论

Plan2 主线可以收口：本地可完成的工程、运行态、诊断、数据安全、迁移确认、Roleplay Beta、记忆 / 资料库产品化和 QQ E2E 准备工作已经完成并验证。剩余工作要么依赖外部输入，要么已经超出 Plan2 的稳定化范围，应进入后续计划或专项，而不是继续阻塞 Plan2 完成。
