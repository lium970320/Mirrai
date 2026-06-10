# Mirrai Plan2：从可用内核到日常稳定运行

> 目的：在 `MIRRAI_WORK_PLAN.md` 的工程卫生、可观测能力和 QQ 主链路稳定基本完成后，把 Mirrai 收束成可长期维护、可日常使用、可定位问题、可控制成本的社交运行时产品。  
> 范围：本计划仍只覆盖 Mirrai 应用本体；`live-action-comic` 继续作为独立生产线，不并入本路线。

## 当前判断

截至 2026-06-08，旧计划的阶段 1-5 已完成当前基线，且 Plan1 后半段已经提前完成了 Plan2 原定的一部分 P0 / P1 内容：

- 工程卫生：同步盘 Git 元数据已修复，`.env`、运行态 memory-card、`.bak` 已移出源码目录。
- P0 可观测：LLM 用量已支持数据库持久化、进程内 fallback、用户 / 角色 / route 归属、软额度提醒和省额度执行第一版；`personaRuntime` 兼容层、运行态诊断、输出策略诊断和诊断面板已经接入。
- QQ 主链路：OneBot 事件级 fixture 已覆盖文本、群聊跳过、语音输入失败、语音输出失败、图片、表情包 fallback 等关键路径。
- Runtime 统一：网页、QQ、微信已经收敛到 `server/social/persona-text-chat.ts` 和 `server/social/persona-media-chat.ts` 的共享链路，并通过 `server/social/runtime-request.ts` 固化平台 / 通道 / 输出能力 contract。
- 新功能分支：长期记忆卡、资料库召回、Roleplay 多角色频道、QQ 设置页、VoxCPM profile、主动消息随机计划等能力已经进入代码树。

因此 Plan2 的重点不是继续猛加功能，而是把已经长出来的能力整理成稳定边界：能提交、能回滚、能验证、能说明、能长期跑。Plan2 阶段 2 / 3 / 4 / 8 不再从零开始，而是只追剩余增强项。

参考记录：

- 旧计划：[MIRRAI_WORK_PLAN.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN.md>)
- 阶段 1 审计：[MIRRAI_PHASE_1_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_1_AUDIT.md>)
- 阶段 2 审计：[MIRRAI_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_2_AUDIT.md>)
- 阶段 3 审计：[MIRRAI_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_3_AUDIT.md>)
- Plan2 阶段 0 审计：[MIRRAI_PLAN2_PHASE_0_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_0_AUDIT.md>)
- Plan2 阶段 1 审计：[MIRRAI_PLAN2_PHASE_1_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_1_AUDIT.md>)
- Plan2 阶段 2 审计：[MIRRAI_PLAN2_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_2_AUDIT.md>)
- Plan2 阶段 3 审计：[MIRRAI_PLAN2_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_3_AUDIT.md>)
- Plan2 阶段 4 审计：[MIRRAI_PLAN2_PHASE_4_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_4_AUDIT.md>)
- Plan2 阶段 5 预检：[MIRRAI_PLAN2_PHASE_5_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_5_AUDIT.md>)
- Plan2 阶段 6 审计：[MIRRAI_PLAN2_PHASE_6_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_6_AUDIT.md>)
- Plan2 阶段 7 审计：[MIRRAI_PLAN2_PHASE_7_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_7_AUDIT.md>)
- Plan2 阶段 8 审计：[MIRRAI_PLAN2_PHASE_8_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_8_AUDIT.md>)
- Plan2 阶段 9 审计：[MIRRAI_PLAN2_PHASE_9_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_9_AUDIT.md>)
- Plan2 阶段 10 收尾：[MIRRAI_PLAN2_PHASE_10_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_10_AUDIT.md>)
- 当前 TODO：[docs/todo.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/todo.md>)
- 本机运行目录：[Mirrai](<F:/Code/Mirrai>)

## 执行原则

- 同步盘目录 `F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai` 只作为源码与文档目录。
- 依赖安装、开发服务、数据库、上传文件、语音输出和浏览器验证只在 `F:/Code/Mirrai` 与 `F:/.mirrai-local/Mirrai` 下进行。
- 每次只推进一个阶段中的一个窄交付物，避免把 runtime、UI、数据库、QQ 和人设材料混在一个不可审查的大改里。
- 默认先复用现有子代理；如需并发审计，最多同时 4 个，且每个子代理只负责清晰边界的窄任务。
- 每阶段完成后更新对应审计记录或 `docs/todo.md`，不要只靠聊天上下文记忆进度。
- 所有新增运行态或成本数据都必须考虑隐私、保留期限和导出/删除账户时的清理路径。

## 阶段 0：Plan1 收口与提交基线

### 目标

把当前大量已完成但仍混杂在工作区里的改动整理成可审查、可提交、可回退的基线，为 Plan2 后续开发止住“所有东西都在半空中”的风险。

### 交付物

- 当前工作区改动按主题拆分：
  - 计划与审计文档。
  - P0 运行态、诊断、LLM usage。
  - QQ / 语音 / 表情包。
  - 长期记忆与资料库。
  - Roleplay。
  - UI 与设置页。
  - 脚本和环境变量。
  - 人设材料与 `live-action-comic` 独立资产。
- 为每组改动补一段简短说明：为什么改、风险、验证命令、是否需要迁移。
- 决定哪些内容进入第一批提交，哪些保留为后续实验。
- 保证同步盘目录不含 `node_modules/`、`dist/`、`uploads/`、`.vite/`、本地数据库、日志、`.env`。

### 验收标准

- `git status --short --branch` 能清楚看出已分组提交或待提交范围。
- Plan1 对应的三份审计记录和 Plan2 均已纳入文档基线。
- `Girlfriend.memory-card.json` 的删除和 `.gitignore` 保护在提交说明中明确。
- 本机运行目录能从同步盘干净同步后通过类型检查。

### 建议命令

```powershell
git status --short --branch
git diff --stat
git status --short --ignored
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
cd F:\Code\Mirrai
corepack pnpm run check
```

## 阶段 1：发布候选基线与回归矩阵

### 目标

建立一个“今天能不能放心继续开发”的标准答案。Plan2 之后每个功能都要能跑回这套矩阵，而不是靠记忆判断有没有弄坏主链路。

### 交付物

- 一份 `docs/release-candidate-checklist.md`：
  - 本机同步检查。
  - 类型检查。
  - DB migration 检查。
  - focused tests 列表。
  - UI smoke test 页面。
  - QQ / OneBot 手动验证项。
  - 退出和清理本机服务的步骤。
- 一份最小回归矩阵：
  - Web 文本聊天。
  - Web 图片聊天。
  - 诊断面板打开。
  - 设置页 LLM / QQ / 微信 tab 基本渲染。
  - QQ 文本私聊。
  - QQ 语音输入失败降级。
  - QQ 语音输出失败降级。
  - 表情包失败不影响主回复。
  - 主动消息随机窗口不重复发送。
- 把常用 focused 测试固化成文档，后续可考虑加入 package script。

### 验收标准

- 任意开发前都能用 15-30 分钟跑完核心回归。
- 新增失败路径时，有明确位置补测试，不再散落在聊天记录里。
- `README.md`、`.env.example`、`docs/windows-google-drive-workflow.md` 对运行方式没有互相矛盾。

### 建议测试命令

```powershell
cd F:\Code\Mirrai
corepack pnpm run check
corepack pnpm exec vitest run server/llm/usage.test.ts server/_core/persona-runtime.test.ts server/social/persona-text-chat.test.ts
corepack pnpm exec vitest run server/qq/message-handler.test.ts server/voice/voice-reply-policy.test.ts server/stickers/sticker-policy.test.ts server/wechat/proactive-scheduler.test.ts
```

## 阶段 2：运行态与 LLM 用量持久化

### 当前状态

- 基线已由 Plan1 阶段 2 补充完成：`llm_usage_records` 已落库，LLM usage 支持数据库持久化、进程内 fallback、今日 / 本周 / 本月统计，以及 `userId` / `personaId` / `route` 归属。
- Plan2 阶段 2 已补齐 persona runtime 独立表化：新增 `persona_runtime_states` 和迁移 `drizzle/0008_persona_runtime_states.sql`，读取 persona 时合并 runtime，写入 personaData 时把临时生活状态、主动消息运行态和 diagnostics 拆到 runtime 表。
- 用户数据导出和删除账户已覆盖 `personaRuntimeStates`；删除 persona 会清理对应 runtime row。详见 [MIRRAI_PLAN2_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_2_AUDIT.md>)。

### 目标

把现在“当前进程可看”的诊断能力升级为“跨重启可追溯、可汇总、可清理”的运行时记录，同时避免把临时状态重新污染人物画像。

### 交付物

- 新增或明确持久化结构：
  - `llm_usage_records`：provider、model、purpose、输入/输出 token 估算、耗时、成功/失败、错误摘要、创建时间、user/persona/route 归属。（已完成）
  - `persona_runtime_states`：临时生活状态、主动消息随机计划、lastSent、ambientPresence、最近 diagnostics。（已完成）
- `server/llm/usage.ts` 从纯内存记录改为内存 + 可选落库，失败时不影响主回复。（已完成基线）
- `server/db.ts` 在 persona 读取路径合并 runtime row，在 `updatePersona` 写入路径拆出 runtime row，避免继续扩大稳定人物画像里的临时状态。（已完成）
- 诊断面板支持：
  - 今天 / 本周 / 本月用量。
  - 按 provider / model / purpose 分桶。
  - 最近失败调用。
  - 数据来自内存还是数据库的来源标识。
- 数据保留策略：
  - 默认保留最近 N 天或最近 N 条。
  - 删除账户时同步清理。
  - 不保存完整 prompt 和完整回复，只保存摘要、计数和错误短摘。

### 验收标准

- 重启服务后，最近用量和近几天汇总仍可查看。
- LLM 用量落库失败不会导致聊天失败。
- 旧角色继续能读取 legacy `personaData.runtimeLifeState` / `proactiveMessages.randomizedSchedule`。
- `personaData` 中新的运行态写入会经 `updatePersona` 拆入独立 runtime 表；业务读取仍看到兼容的 `personaRuntime`。

### 建议测试命令

```powershell
cd F:\Code\Mirrai
corepack pnpm run check
corepack pnpm exec vitest run server/_core/persona-runtime.test.ts server/data-export.test.ts server/_core/life-schedule.test.ts server/social/persona-text-runtime-platform.test.ts server/social/persona-media-runtime-platform.test.ts server/wechat/proactive-runtime-generation.test.ts
```

### 风险

- 这是数据库结构变化阶段，必须同时验证 Neon 和本机 PostgreSQL。
- 正式 Neon / 远程 PostgreSQL 仍应执行 `0008_persona_runtime_states.sql`，不要只依赖 runtime helper 的兼容建表。
- 不要把完整 prompt / 私密对话落到 usage 表里，否则会增加隐私和导出清理压力。

## 阶段 3：额度、成本与省额度模式

### 当前状态

- 基线已由 Plan1 阶段 2 补充完成：已支持每日 / 月度软额度提醒，并接入 `off` / `conservative` / `strict` 三档省额度策略。
- 已接入低价值链路降级：非显式语音智能判断、TTS LLM 润色、环境主动消息、严格模式下定时主动消息、原著证据改写 token 上限。
- Plan2 阶段 3 已补齐运行上限可解释性：`limitsSummary` 会展示每轮上下文、长期记忆召回、资料库召回和证据改写 token 上限；设置页“LLM 路由”同步显示这些上限，并明确“上限是保护阈值，不是质量目标”。详见 [MIRRAI_PLAN2_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_3_AUDIT.md>)。
- 剩余增强：更完整账单报表、导出、分页游标、按日期聚合视图和真实多用户账单级明细筛选。

### 目标

让 Mirrai 不只是“知道用了多少”，还要能在高消耗时自动收敛，把长期运行成本控制在用户可预期范围内。

### 交付物

- 设置页新增成本控制区：
  - 今日 / 本周 / 本月 token 估算。
  - 每日软上限和月度软上限。
  - 超额提醒。
  - 省额度模式开关。
- 省额度模式策略：
  - 普通聊天减少历史消息数量。
  - 关闭非必要语音智能判断，优先本地规则。
  - TTS 润色从 `llm` 降到 `local` 或关闭。
  - 主动消息降频或暂停非必要 ambient presence。
  - 原著资料召回限制 chunk 数和二次复核调用。
  - Roleplay 降低自动轮转频率。
- DeepSeek 动态路由 UI 可解释：
  - Flash 适合普通聊天、主动消息、语音判断。
  - Pro 适合原著证据、人物画像、毕业信、复杂 Roleplay。
  - 明确显示当前 purpose 被路由到了哪个 provider。

### 验收标准

- 超过软上限后，诊断面板和设置页都能看到状态。
- 省额度模式启用后，普通聊天仍自然可用。
- 省额度模式不破坏原著证据模式的“没有证据就承认记不准”规则。
- 相关策略有单元测试或配置测试覆盖。

### 建议测试命令

```powershell
cd F:\Code\Mirrai
corepack pnpm run check
corepack pnpm exec vitest run server/llm/deepseek-routing.test.ts server/social/source-recall.test.ts server/social/source-grounding.test.ts server/voice/voice-reply-policy.test.ts
```

## 阶段 4：社交适配层正式统一

### 当前状态

- 基线已由 Plan1 阶段 4 完成：Web / QQ / WeChat 文本与媒体入口共用 shared social runtime contract；QQ 新消息和主动消息使用 `channel: "qq"`；主动消息接入 proactive turn planner 和 runtime diagnostics。
- Plan2 阶段 4 已补齐数据库迁移执行确认工具：`db:check` 检查当前在线库，`db:local:check` 临时启动本机嵌入式 PostgreSQL 并执行只读 Plan2 schema 检查；`db:local:prepare` 会补齐旧本机库缺失的 Plan2 幂等迁移片段。详见 [MIRRAI_PLAN2_PHASE_4_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_4_AUDIT.md>)。
- 剩余增强：Neon / 远程 PostgreSQL 需要在部署时用 `db:check` 验证；QQ / NapCat 外部运行态已在阶段 5 复核为可手动 E2E，仍等待测试联系人真实私聊；未来新增平台继续沿用 `runtime-request` contract。

### 目标

把网页、QQ、微信明确整理成同一套社交 runtime 的三个适配器。平台只处理收发和格式限制，不再各自产生人格逻辑。

### 交付物

- 梳理并文档化统一 runtime 输入：
  - `platform` / `channel`
  - `personaId` / `userId`
  - 联系人标识和展示名
  - 最近上下文
  - 文本 / 图片 / 表情 / 语音转写
  - 场景 overlay
  - 输出能力：文本、语音、表情包、主动消息
- 适配层职责边界：
  - QQ：OneBot 事件解析、文件下载、发送文本/图片/record、群聊策略。
  - 微信：Wechaty 事件解析、图片/表情读取、发送文本、登录状态。
  - Web：tRPC 请求、文件上传、UI 展示。
  - 共享 runtime：turn planner、reflection、memory recall、source recall、life schedule、reply cleanup、diagnostics。
- 消除重复文案和重复 prompt：
  - 文本平台 overlay 只保留一个来源。
  - 媒体平台 overlay 与文本 overlay 共享核心平台一致性规则。
  - 角色称呼、短句消歧、睡眠防循环、原著证据规则都从共享模块进入。

### 验收标准

- 同一句输入从 Web 和 QQ 进入时，人物设定、记忆、原著规则和风险约束一致。
- 平台差异只体现在收发能力和格式限制上。
- 新增平台入口时不需要复制大段 prompt。
- Web、QQ、微信现有接口不退化。

### 建议测试命令

```powershell
cd F:\Code\Mirrai
corepack pnpm run check
corepack pnpm exec vitest run server/social/persona-text-chat.test.ts server/social/persona-media-chat.test.ts server/qq/persona-bridge.test.ts server/qq/message-handler.test.ts
```

## 阶段 5：真实 QQ / NapCat 端到端验证

### 目标

在 mock 事件测试之外，完成一次可复现的真实 QQ 私聊链路验证，让 QQ 成为当前最可靠的外部社交入口。

### 交付物

- 一份 `docs/qq-e2e-verification.md`：
  - NapCat 登录前检查。
  - OneBot baseUrl / token / webhook secret 配置。
  - 测试联系人绑定。
  - 文本、语音、图片、表情包、主动消息验证步骤。
  - 常见失败和日志定位。
- 手动验证四条主路径：
  - 私聊文本进入共享 runtime 并回复。
  - 用户发语音：下载、归一化、ASR、回复。
  - 用户要求语音：TTS / VoxCPM 生成并发送；失败退文字。
  - 表情包策略命中：文字先发，表情包失败不影响文字。
- 日志规范继续收束：
  - `voice_in_download_failed`
  - `voice_in_normalize_failed_fallback_text`
  - `voice_asr_failed_fallback_text`
  - `voice_tts_failed`
  - `voice_send_failed_fallback_text`
  - `sticker_send_failed_fallback_text`
  - 主动消息计划和实际发送时间

### 验收标准

- 一台 Windows 本机可以按文档复现 QQ 端到端。
- 所有外部失败都能自然降级，不导致进程退出。
- 群聊默认关闭，打开时有明确配置和测试。
- 真实验证产生的临时联系人、角色、消息有清理说明。

### 注意事项

- 不做实时语音电话、自动接听、多人声纹识别。
- 不把 NapCat 运行数据、日志、QQ 本地状态放入同步盘源码目录。

## 阶段 6：长期记忆治理与资料库产品化

### 目标

把“能召回”推进到“可信、可编辑、可解释”。长期记忆和原著资料库是人格质量的地基，不能只靠自动生成。

### 交付物

- 长期记忆治理：
  - 记忆卡片列表、编辑、归档、标记矛盾。
  - 显示 importance、confidence、source、memoryType、keywords、evidenceMessageIds。
  - 最近召回记录和低置信提示。
  - 自动沉淀后的人工确认入口。
- 资料库产品化：
  - 导入状态、chunk 数、章节标题、关键词统计。
  - 检索命中展示：本轮用了哪些片段。
  - “证据不足”的明确提示和回退文案。
  - 避免把上一轮错误回答当成事实继续召回。
- 记忆质量测试：
  - 不把推测写成事实。
  - 不记录低价值寒暄。
  - 矛盾记忆不优先召回。
  - 原著问题无证据时不编造。

### 验收标准

- 用户能看到角色为什么记得某件事，也能手动修正或关闭。
- 记忆召回不会把昵称、平台名、群名误当成关系事实。
- 原著证据模式在无证据时稳定承认不确定。
- 自动记忆沉淀不会无限增加低价值卡片。

### 建议测试命令

```powershell
cd F:\Code\Mirrai
corepack pnpm run check
corepack pnpm exec vitest run server/social/memory-card.test.ts server/social/memory-consolidation.test.ts server/social/memory-governance.test.ts server/social/memory-recall.test.ts server/social/source-recall.test.ts server/social/source-grounding.test.ts
```

## 阶段 7：Roleplay 多角色频道 Beta 收束

### 目标

把已经出现的 Roleplay 频道能力从“实验入口”整理成可控 Beta，不让它反向污染一对一社交 runtime。

### 当前状态

- 核心 Beta 收束已完成：页面支持频道列表、成员选择与顺序调整、场景提示、用户插话、指定角色发言、自动轮转入口和允许沉默开关。
- Runtime 已接入 roleplay purpose 用量记录；严格省额度模式下会跳过自动轮转，但用户显式指定角色发言仍允许执行。
- 桌面 `1280 x 720` 和移动 `390 x 844` 浏览器 smoke 已通过，详见 [MIRRAI_PLAN2_PHASE_7_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_7_AUDIT.md>)。

### 交付物

- 明确 Roleplay 定位：
  - 它是多角色共同生活/对话频道，不是一对一恋爱聊天入口。
  - 角色只扮演自己，不替其他角色说话。
  - innerThought 只作为诊断或创作辅助，不直接混进公开发言。
- UI 收束：
  - 频道列表。
  - 成员选择和顺序。
  - 场景提示。
  - 用户发言。
  - 指定角色发言 / 自动轮转。
  - 允许沉默开关。
- Runtime 收束：
  - roleplay purpose 用量统计。
  - 省额度模式下限制自动轮转。
  - 每轮只新增一个角色发言。
  - 不把 Roleplay 场景临时设定写回稳定人物画像。

### 验收标准

- 两个及以上 ready persona 可以创建频道并轮流发言。
- 指定角色发言、自动轮转和允许沉默都有测试覆盖。
- Roleplay 不破坏普通 `chat/:id` 一对一聊天。
- UI 在桌面和移动视口没有明显溢出。

### 建议测试命令

```powershell
cd F:\Code\Mirrai
corepack pnpm run check
corepack pnpm exec vitest run server/social/roleplay-channel.test.ts server/social/source-recall.test.ts server/llm/usage.test.ts
```

## 阶段 8：设置页与诊断体验整理

### 当前状态

- 基线已由 Plan1 阶段 5 完成：设置页新增“运维诊断”页签；聊天页入口统一为“运行诊断”；诊断面板增加最近运行事件、Runtime 路由、投递与触发；桌面和移动视口已通过浏览器验证。
- Plan2 阶段 8 已补充持久化与数据安全可见性：运维诊断显示 `persona_runtime_states`、`llm_usage_records`、导出/删除覆盖、本机清理脚本和必跑迁移清单；数据管理页显示 runtime 状态计数并更新导出/删除边界。详见 [MIRRAI_PLAN2_PHASE_8_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_8_AUDIT.md>)。
- 剩余增强：继续扩展平台原始错误旁边的行动建议，避免后续新增状态或输出模式重新裸显英文枚举；本轮设置页桌面 / 移动视觉复验已补齐。

### 目标

把诊断面板和设置页从“所有信息都能看见”整理成“用户能快速知道哪里出问题、该去哪儿改”。

### 交付物

- 诊断面板保留运行事实：
  - 本轮 planner / reflection / memory / source。
  - 生活状态和临时运行态。
  - 主动消息随机计划。
  - 输出策略摘要。
  - LLM 用量和失败调用。
  - 后端关键模块路径。
- 设置页承接配置：
  - LLM provider / model routing。
  - QQ / NapCat 状态和绑定。
  - 语音 / VoxCPM / MiniMax / fallback。
  - 表情包素材与策略。
  - 主动消息。
  - Neon / 本机数据库说明。
  - 成本控制和省额度模式。
  - 持久化表、导出/删除覆盖、本机清理脚本和必跑迁移清单。
- 文案原则：
  - 诊断区说事实，不写沉浸式“内心世界”装饰文案。
  - 设置区说配置、风险和状态，不堆实现细节。
  - 移动端表格使用局部横向滚动，不撑开页面。

### 验收标准

- `chat/:id` 诊断面板桌面和 390 x 844 移动视口无页面级横向溢出。
- 设置页各 tab 首屏能清楚显示启用状态、配置缺失和下一步动作。
- LLM usage、QQ、语音、表情包、主动消息不再全挤在诊断面板里。
- UI 改动经过本机浏览器验证。

### 建议命令

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
cd F:\Code\Mirrai
corepack pnpm run check
corepack pnpm run dev
```

## 阶段 9：备份、导出、删除与数据安全

### 目标

Mirrai 的数据高度私密。进入日常使用阶段前，必须明确本机数据、云端数据库、上传文件、语音缓存和诊断记录如何备份、导出和删除。

### 当前状态

- 后端第一版已完成：用户导出已覆盖 persona、消息、文件元数据、长期记忆、资料库、Roleplay、日记、LLM usage、平台绑定、skill jobs 和自定义场景，并排除密码哈希、session cookie 和 LLM API Key。
- 删除账户已补齐 Plan2 新增私密表；删除角色已补齐日记记录，并会自动停用成员不足 2 个的 Roleplay 历史频道。
- 本机清理脚本已覆盖 `uploads`、TTS cache、tmp、logs、截图、NapCat downloads、微信 session，并为 NapCat runtime、VoxCPM runtime、torch runtime、Hugging Face / ModelScope 模型缓存增加二次确认删除保护；设置页数据管理文案和浏览器导出抽样已完成。详见 [MIRRAI_PLAN2_PHASE_9_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_9_AUDIT.md>)。

### 交付物

- 数据分类文档：
  - 账户与配置。
  - persona 稳定画像。
  - persona runtime 临时状态。
  - 消息和媒体。
  - 长期记忆。
  - 资料库 chunks。
  - LLM usage 和诊断记录。
  - QQ / 微信绑定。
  - TTS / VoxCPM 缓存。
- 导出增强：
  - 用户数据导出包含新增表。
  - 可选导出 persona + memory + source library。
  - 不默认导出本地语音缓存，除非用户明确选择。
- 删除增强：
  - 删除 persona 清理消息、记忆、资料库、roleplay 关联、runtime、诊断。
  - 删除账户清理所有私密数据。
  - 本机 `uploads` 和 TTS 缓存提供清理脚本或文档。
- Google Drive 同步盘保护：
  - 再次确认 `.gitignore` 和 sync 脚本排除运行产物。
  - 文档强调 `.env` 和本机数据库不进入同步盘。

### 验收标准

- 新增持久化表都纳入导出/删除策略。
- 删除账户不会留下孤立的 QQ 绑定、runtime、usage、memory、source chunks。
- 本机缓存清理路径清楚，且不会误删源码。

## 阶段 10：后续分支决策

### 目标

在 Plan2 主线稳定后，再决定哪些方向值得进入下一个计划，避免所有愿望同时争抢主线。

### 当前状态

- Plan2 阶段 10 已完成收尾决策，详见 [MIRRAI_PLAN2_PHASE_10_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_10_AUDIT.md>)。
- 本地可完成的工程、运行态、诊断、数据安全、迁移确认、Roleplay Beta、记忆 / 资料库产品化和 QQ E2E 准备工作已经完成并验证。
- 剩余事项分为外部输入等待项和后续计划项，不再阻塞 Plan2 主线关闭。

### 候选方向

- WeChat 恢复为第一等入口：只有在 wechat4u 登录稳定或替代方案明确后再推进。
- macOS / Windows 打包：把本机 Postgres、Node、启动脚本和日志面板整理成用户可安装版本。
- 表情包素材生产：替换占位图，建立角色专属表情包库和审核流程。
- VoxCPM 音色生产：补 `comfort`、`tease`、`angry_soft`、`sad_low` 的干净参考音频。
- `profileSections` 数据库化：从 JSON 内部兼容层升级成版本化 schema。
- `live-action-comic` 单独计划：作为漫画生产线继续开独立 Plan，不挤进 Mirrai 应用内核。

## 推荐执行顺序

1. 阶段 0 已完成：当前大改已拆成可审查基线，并创建发布候选回归清单。
2. 阶段 1 已完成最小发布候选基线：QQ handler 单测、最小 focused regression matrix 和 `corepack pnpm run check` 均通过，详见 [MIRRAI_PLAN2_PHASE_1_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_1_AUDIT.md>)。
3. 阶段 5 已完成文档、只读预检和 webhook smoke；2026-06-09 复核时 NapCat / OneBot 已在线且 `readyForManualE2E=true`，真实 QQ 在线 E2E 仍等待测试联系人私聊，详见 [MIRRAI_PLAN2_PHASE_5_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_5_AUDIT.md>)。
4. 阶段 6 已完成核心最小交付：聊天页记忆抽屉支持筛选、编辑、归档、标错和恢复，记忆列表查询已按 `personaId + userId` 收紧；资料库抽屉支持 source / chunk / 章节 / token / 关键词概览、检索命中预览、关联片段标识和证据不足提示；桌面与移动浏览器 smoke 已通过。
5. 阶段 7 已完成核心 Beta 收束：允许沉默、成员排序、严格省额度自动轮转跳过、指定角色发言保留和桌面 / 移动浏览器 smoke 均已完成，详见 [MIRRAI_PLAN2_PHASE_7_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_7_AUDIT.md>)。
6. 阶段 2 已完成 runtime table 收口：`persona_runtime_states` 迁移、读写拆分、导出/删除覆盖和 focused tests 均已完成。
7. 阶段 4 已完成本机库迁移确认工具和 `db:local:check` 只读 OK 证据；远程库验证留给部署时执行。
8. 阶段 3 已完成省额度上限说明和运维诊断可见性；后续只追完整账单报表、导出、分页等运营增强。
9. 阶段 8 已完成持久化与数据安全可见性 polish，并补齐设置页桌面 / 移动视觉复验；后续只滚动补新增枚举中文化和行动建议。
10. 阶段 9 已完成主要数据安全收口，并补齐大型 / 登录态运行时二次确认清理和孤立 roleplay 频道停用策略；后续只补完整备份包。
11. 阶段 10 已完成 Plan2 收尾决策：真实 QQ 私聊、远程库验证和素材生产等进入外部输入 / 后续计划，不再阻塞 Plan2 主线关闭。

## Plan2 第一批具体任务

建议下一轮直接从这些任务开始：

1. 阶段 0 已完成：`docs/release-candidate-checklist.md` 和 `MIRRAI_PLAN2_PHASE_0_AUDIT.md` 已创建。
2. 阶段 1 已完成：最小 regression matrix、QQ focused test 和类型检查通过，且修复了 QQ handler 测试异步串扰。
3. 阶段 5 已完成 E2E 文档、本机只读预检、webhook smoke 和 2026-06-09 在线状态复核；当前等待测试联系人发起真实私聊。
4. 阶段 6 已完成长期记忆治理和资料库只读产品化第一版；自动记忆候选确认、资料库重新导入 / 删除和证据使用记录转入后续阶段。
5. 阶段 7 已完成 Roleplay Beta 核心收束；频道导出 / 删除与孤立频道停用已在阶段 9 收口，真实 LLM 发言质量抽样和省额度解释文案转入后续阶段。
6. 阶段 2 已完成 persona runtime 独立表化；下一步不再反复评估是否建表。
7. 阶段 9 已完成主要导出 / 删除 / 清理收口。
8. 阶段 8 已完成新增 runtime 表和数据安全的诊断可见性；后续补浏览器视觉复验。
9. 阶段 4 已完成 `db:local:prepare` / `db:local:check` 本机迁移确认闭环；部署或切到 Neon 后继续跑 `db:check`。
10. 在测试联系人发起真实 QQ 私聊后，使用 `F:/.mirrai-local/Mirrai/logs/qq-e2e-baseline-2026-06-09.json` 继续阶段 5 在线证据复核。
11. 阶段 10 已完成收尾决策；下一步进入提交 / 分支整理，优先提交计划 / 审计 / 回归清单，再拆 P0 观测、runtime、QQ、UI、Roleplay、素材。
