# Mirrai Plan2 Phase 3 Audit：额度、成本与省额度模式

> 时间：2026-06-09 02:00 +08:00  
> 运行目录：[Mirrai](<F:/Code/Mirrai>)  
> 源码目录：[Mirrai](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai>)

## 本轮结论

Plan2 Phase 3 的成本控制基线已经从“策略能执行”推进到“上限能解释、能在设置页看见、能被测试锁住”。

本轮没有改变省额度策略的执行阈值，只补齐了诊断和 UI 可见性：

- `server/llm/economy.ts` 新增 `limitsSummary`，稳定描述每轮上下文、长期记忆召回、资料库召回和证据改写 token 上限。
- route / intent 级召回降级后，`limitsSummary.routeSpecific` 会同步反映当前 profile 和原因，例如高频 QQ / 微信短聊、主动消息、媒体回复和原著证据模式。
- `system.operationsDiagnostics.llm.economy.limitsSummary` 会返回这些上限说明，避免设置页自己拼业务含义。
- 设置页“运维诊断 / LLM 路由”新增上下文上限、记忆召回上限、资料库召回上限和“这些数字是每轮保护上限，不是质量目标”的提示。

## 验收覆盖

已完成：

- 软额度状态仍由每日 / 月度 token 使用量决定。
- `off / conservative / strict` 三档仍保持原有执行行为。
- 上下文历史条数、LLM 历史条数、长期记忆条数、资料库 chunk 数和证据改写 tokens 已进入后端 summary。
- 运维诊断接口返回 summary，且测试确认不需要前端猜测策略含义。
- 高频 QQ / 微信短聊的 route 级降级会在 summary 中标记为 `high_frequency_chat`。

仍保留为后续增强：

- 更完整账单报表：导出、分页游标和按日期聚合视图。
- 真实多用户账单级过滤体验。
- 如果未来提供用户可编辑上限，需要额外增加配置边界和误设保护；当前仍只展示运行策略上限。

## 验证记录

在 [Mirrai](<F:/Code/Mirrai>) 运行：

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/llm/economy.test.ts server/social/output-diagnostics.test.ts
corepack pnpm run db:check
```

结果：

- `corepack pnpm run check` 通过。
- `server/llm/economy.test.ts server/social/output-diagnostics.test.ts` 通过，`2 passed / 13 tests passed`。
- 当前本机 Mirrai 服务已运行并占用 embedded PostgreSQL `127.0.0.1:5434`；`db:local:check` 会因 `postmaster.pid` 已存在而无法再次启动临时库。本轮改用 `corepack pnpm run db:check` 对当前在线本机库做只读 schema 检查，结果 `Status: OK (0 missing)`。

浏览器视觉 smoke：

- 使用本机 Chrome headless 访问 [http://localhost:3000/settings](http://localhost:3000/settings)，创建临时账号 `codex_smoke_*`，打开“运维诊断 / LLM 路由”，检查新增上限行。
- 桌面 `1280 x 720`：可见上下文上限、记忆召回上限、资料库召回上限和每轮保护上限说明；`documentElement.scrollWidth === clientWidth`，`body.scrollWidth === clientWidth`。
- 移动 `390 x 844`：同上，页面级无横向溢出。
- 临时账号已通过 `user.deleteAccount` 清理。
- 截图保存在本机运行数据目录：
  - [settings-llm-limits-detail-desktop-1280x720.png](<F:/.mirrai-local/Mirrai/screenshots/settings-llm-limits-detail-desktop-1280x720.png>)
  - [settings-llm-limits-detail-mobile-390x844.png](<F:/.mirrai-local/Mirrai/screenshots/settings-llm-limits-detail-mobile-390x844.png>)

## 相关文件

- [economy.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/economy.ts>)
- [economy.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/llm/economy.test.ts>)
- [output-diagnostics.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/output-diagnostics.test.ts>)
- [Settings.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Settings.tsx>)
