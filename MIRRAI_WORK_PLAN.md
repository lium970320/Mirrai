# Mirrai 五阶段工作推进计划

> 目的：把当前已经长出来的 Mirrai 应用能力收束成稳定、可观测、可调试、可持续迭代的系统。  
> 范围：本计划只覆盖 Mirrai 应用本体；`live-action-comic` 暂不纳入主路线，后续如需要再单独开计划。

## 执行原则

- 同步盘目录 `F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai` 只作为源码与文档目录。
- 依赖安装、开发服务、构建、测试优先在本机运行目录 `F:/Code/Mirrai` 完成。
- 每个阶段先做小范围、可验证的改动；完成后把结果写回本计划或 `docs/todo.md`。
- 不把 `node_modules/`、`dist/`、`uploads/`、`.vite/`、日志、本地数据库、`.env` 等运行产物放回同步盘。
- 每阶段默认验收命令：
  - `corepack pnpm run check`
  - 与该阶段相关的 focused `vitest run ...`
  - 涉及 UI 时，先同步到 `F:/Code/Mirrai`，再启动本机服务做页面验证。

## 阶段 1：工程卫生与 Git / 同步盘风险收束

### 当前状态

- 2026-06-08 已完成当前轮工程卫生收束：Git 元数据已重建，`.env`、运行态 memory-card 和未跟踪 `.bak` 已移出同步盘源码目录。
- 详细记录见：[MIRRAI_PHASE_1_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_1_AUDIT.md>)

### 目标

先把工作环境稳住，避免 Google Drive 同步、损坏的 `.git` 对象、备份文件和大量未归类改动继续干扰后续开发。

### 交付物

- 明确同步盘源码目录和本机运行目录的职责边界。
- 盘点当前未提交改动、新增文件、`.bak` 文件和生成物，区分：
  - 需要保留的源码改动。
  - 需要纳入计划的文档和迁移。
  - 可以删除或归档的备份 / 临时文件。
- 修复或重建健康的 Git 工作副本，避免 `git log` / `git diff --stat` 因缺失对象失败。
- 确认 `scripts/sync-local-worktree.ps1` 的排除规则仍覆盖运行产物。

### 验收标准

- `git status --short --branch` 能稳定运行。
- `git log --oneline -n 5` 和 `git diff --stat` 不再因缺失对象失败。
- 同步盘根目录没有新出现的 `node_modules/`、`dist/`、`uploads/`、`.vite/`、日志或本地数据库文件。
- 当前改动能被清晰分组，后续可以按阶段提交或保存。

### 建议检查命令

```powershell
git status --short --branch
git log --oneline -n 5
git diff --stat
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

### 注意事项

- 不要使用 `git reset --hard` 或强制回退用户未确认的改动。
- 如果同步盘 `.git` 对象确实损坏，优先从远端或健康副本重新克隆 / 重建工作副本，再合并现有源码改动。
- `.bak` 文件不要直接删除，先确认是否只是上次 UI pass 的备份。

## 阶段 2：P0 可观测能力

### 当前状态

- 2026-06-08 已完成当前 P0 可观测基线：LLM 用量已支持数据库持久化，并保留进程内 fallback；可记录 provider / model / purpose / user / persona / route / token 估算 / 耗时 / 成败，运维诊断展示今日 / 本周 / 本月汇总，以及今日用户 / 角色 / 入口成本归属。运行态已通过 `personaRuntime` 兼容层与稳定人物画像分离；诊断面板已展示 planner / reflection / recall / usage / output strategy。
- 2026-06-08 已完成省额度模式自动执行第一版：软额度进入 `warn` / `exceeded` 后会生成 economy policy，自动降低 TTS LLM 润色、环境主动消息、定时主动消息、非显式语音智能判断和原著改写 token 上限；运维诊断展示执行状态。
- 2026-06-08 已完成原始错误排障清单第一版：运维诊断会把数据库、LLM 用量持久化、QQ / OneBot、微信 Web 登录 / 同步错误分类成脱敏 raw error 与可执行步骤。
- 2026-06-08 已完成上下文 / 召回降级第一版：economy policy 会按 `off / conservative / strict` 缩短历史窗口、长期记忆条数 / 描述长度、原著证据条数 / 摘录长度，并写入 runtime diagnostics。
- 2026-06-08 已补充语音 / 表情包排障分类：ASR / TTS / VoxCPM / MiniMax / 音频转码 / QQ 语音发送 / sticker 文件和 OneBot image 发送失败会进入运维排障清单，最近运行事件会脱敏展示。
- 2026-06-08 已完成 LLM 用量明细筛选 / 运维查账第一版：受保护接口支持按时间、用户、角色、route、provider、purpose、成功状态和条数查询；普通用户强制只看自己的用量，管理员可全局或按用户筛选；设置页运维诊断展示筛选、汇总和最近调用元数据。
- 2026-06-08 已完成按 intent / route 更细分的召回降级第一版：在全局 `off / conservative / strict` 额度档位之上，按 source、proactive、media、technical、高频 QQ / 微信日常短聊、情绪/深情表达等 profile 二次收束上下文、长期记忆、原著证据和 rewrite tokens，并写入 runtime diagnostics。
- 当前阶段 2 的 P0 可观测路线图已无明确剩余项；后续可作为运营增强继续补导出、分页和更细报表。
- 详细记录见：[MIRRAI_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_2_AUDIT.md>)

### 目标

让系统知道“为什么这轮这么回、用了多少额度、哪些状态是临时运行态”，减少人格运行时的玄学感。

### 交付物

- LLM 用量记录从当前内存估算进一步升级：
  - 记录 provider、model、purpose、输入 / 输出 token 估算、耗时、成功失败和失败原因。
  - 调试面板至少展示今天调用量、token 估算、provider / purpose 分桶和最近调用。
- 运行时状态拆分：
  - 将 `runtimeLifeState`、`proactiveMessages.randomizedSchedule`、主动消息发送状态等临时运行态从稳定人物画像里逐步分离。
  - 保持旧 `personaData` 字段兼容，避免旧角色无法读取。
- 调试面板增强：
  - 展示回合规划、隐藏反思、资料库召回、长期记忆召回、主动消息随机时间、语音 / 表情策略和 LLM 用量。
  - 明确区分“人物事实”“运行诊断”“临时状态”。

### 验收标准

- 普通聊天后，诊断面板能看到本轮 planner / reflection / recall / usage 信息。
- 用量记录至少在当前进程内稳定展示；如果实现持久化，应能跨重启保留最近记录。
- 临时运行态迁移后，旧角色仍能正常回复、主动消息仍能按原配置发送。
- 长篇人物设定不会重新回到每轮大段常驻。

### 建议测试命令

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/llm/deepseek-routing.test.ts server/social/persona-turn-planner.test.ts
corepack pnpm exec vitest run server/social/memory-recall.test.ts server/social/source-recall.test.ts
```

### 注意事项

- 优先保持接口兼容，不做一次性大迁移。
- 如果新增表或迁移，必须明确 Neon 和本机 PostgreSQL 都能跑。
- 调试面板是排查工具，不要改成抽象的“内心世界”展示。

## 阶段 3：QQ 主链路稳定

### 当前状态

- 2026-06-08 已完成当前 QQ 主链路测试基线：OneBot 事件级 fixture 覆盖普通私聊文本、群聊跳过、语音输入失败降级、语音输出失败降级、base64 语音、base64 图片、图片文本占位回退和表情包失败不影响主回复。
- 2026-06-08 已补强关键日志 / 降级原因断言：QQ handler 事件级测试会 spy `console.info` / `console.warn`，确认语音、图片和表情包主链路能记录成功节点、失败节点和 fallback 原因。
- 2026-06-08 已新增 QQ / OneBot 在线 E2E 只读预检脚本：[check-qq-e2e-readiness.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-readiness.ps1>)；脚本会脱敏日志里的 `token=...`、`WebUi Token: ...` 和 `Bearer ...`。
- 2026-06-08 20:23 已从本机运行目录启动 NapCat，当前 Mirrai Web 正常，NapCat 相关进程数为 5，OneBot `OK`，登录用户为 `广袤 (3321802943)`；真实 E2E 已进入等待测试联系人发起私聊文本 / 语音 / 图片消息的阶段。
- 2026-06-08 已新增 QQ / OneBot 在线 E2E 日志证据脚本：[check-qq-e2e-evidence.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-evidence.ps1>)；支持测试前创建 baseline，测试后只分析新增日志，并汇总私聊文本、语音、图片 / 表情包、主动消息的证据状态。
- 2026-06-08 已新增 QQ webhook 入口 smoke 脚本：[check-qq-webhook-smoke.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-webhook-smoke.ps1>)；已验证 Mirrai webhook 路由、token 鉴权、JSON body 解析和 QQ handler 入口可用，响应为 `ignored_self_message`。这不替代真实 NapCat 上报和测试联系人消息。
- 仍保留为后续增强：真实 NapCat / OneBot 在线端到端验证。
- 详细记录见：[MIRRAI_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_3_AUDIT.md>)

### 目标

把 QQ / NapCat / OneBot 作为当前主要外部社交入口稳定下来，保证文本、语音、表情包、主动消息和失败降级都可控。

### 交付物

- 语音链路边界整理：
  - 下载 / 解析 OneBot 文件。
  - 音频格式归一化。
  - ASR 转写。
  - TTS / VoxCPM 生成。
  - OneBot 发送。
  - 失败降级到文本。
- 补充真实或接近真实的 OneBot fixture，覆盖 `record`、`image`、普通私聊、群聊跳过等场景。
- 表情包策略继续保持低频、可控、失败不影响主回复。
- 主动消息继续使用随机窗口，避免精确打卡感；日志可说明计划时间、实际发送时间、联系人和角色。

### 验收标准

- QQ 文本消息可以正常进入共享 persona 回复流程。
- 语音输入失败不会导致进程退出；语音输出失败会自然退回文字。
- 表情包文件缺失、OneBot 发送失败时不影响文字回复。
- 主动消息同一天同一时间点不会重复发送。
- 日志能区分下载、转码、ASR、TTS、发送和降级原因。

### 建议测试命令

```powershell
corepack pnpm run check
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-readiness.ps1
powershell -ExecutionPolicy Bypass -File scripts/check-qq-webhook-smoke.ps1
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1
corepack pnpm exec vitest run server/voice/voice-reply-policy.test.ts
corepack pnpm exec vitest run server/social/persona-text-chat.test.ts
corepack pnpm exec vitest run server/wechat/proactive-scheduler.test.ts
```

### 注意事项

- 不做 QQ / 微信实时语音电话、自动接听或多人声纹识别。
- 群聊默认保持保守策略，除非配置明确允许。
- 微信当前保留，但本阶段不把微信作为主攻目标。

## 阶段 4：社交 Runtime 统一

### 当前状态

- 2026-06-08 已完成当前社交 runtime 统一基线：Web / QQ / WeChat 文本与媒体入口共用 shared social runtime contract；QQ 文本 / 媒体 / 主动消息正式使用 `channel: "qq"`；主动消息也接入 proactive turn planner 和 runtime diagnostics。
- 仍保留为后续增强：执行真实数据库迁移、真实外部平台端到端验证，以及未来新增平台时继续沿用 `runtime-request` contract。
- 详细记录见：[MIRRAI_PHASE_4_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_4_AUDIT.md>)

### 目标

把网页、QQ、微信的输出策略继续收敛到同一套人物运行时，外部平台只负责收发适配。

### 交付物

- 明确统一 runtime 的核心输入：
  - platform / channel。
  - personaId / userId。
  - 最近上下文。
  - 媒体类型和转写文本。
  - 场景 overlay。
  - 是否允许语音、表情包、主动消息等输出倾向。
- 网页、QQ、微信适配层只做：
  - 消息接收。
  - 联系人 / 角色绑定。
  - 媒体下载与上传。
  - 调用统一 runtime。
  - 平台特定发送和失败降级。
- 统一“短句消歧、连续消息合并、睡眠状态、原著证据、记忆召回、角色语气”的核心规则。

### 验收标准

- 同一句用户输入从网页和 QQ 进入时，人物设定、记忆和风险约束一致。
- 平台差异只体现在收发能力和格式限制上，不再产生两套人格逻辑。
- 新增平台入口时不需要复制大段 prompt 或人格规则。
- 现有网页聊天、QQ 私聊和主动消息不退化。

### 建议测试命令

```powershell
corepack pnpm run check
corepack pnpm exec vitest run server/social/persona-text-chat.test.ts server/social/persona-media-chat.test.ts
corepack pnpm exec vitest run server/social/source-grounding.test.ts server/social/source-recall.test.ts
```

### 注意事项

- 不急着重命名大量文件，优先先统一数据流和行为。
- 微信 Web 登录不稳定时，不以微信端到端在线作为本阶段唯一验收标准。
- 避免把平台昵称误当作人物称呼或关系事实。

## 阶段 5：UI 与诊断体验整理

### 当前状态

- 2026-06-08 已完成当前 UI 与诊断体验基线：聊天页入口统一为“运行诊断”；诊断面板增加“最近运行事件”、Runtime 路由、投递与触发；设置页新增“运维诊断”页签，展示运行与数据库、LLM 路由、平台接入、Runtime 收敛、语音、表情包和主动消息。
- 已完成诊断文案 polish：QQ / 微信实时状态、runtime 能力、语音 / TTS / ASR、`incoming_message` / `short` / `light` / `text` 等枚举值已中文化；QQ / 微信错误增加可行动建议。
- 已完成桌面与移动视口浏览器验证，详细记录见：[MIRRAI_PHASE_5_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_5_AUDIT.md>)

### 目标

把前端从“能聊天的界面”整理成“角色社交运行时仪表盘”，让用户能快速判断系统状态和问题来源。

### 交付物

- 聊天页保留轻量、自然的主体验。
- 诊断入口集中展示：
  - 当前生活状态。
  - 本轮意图。
  - 长期记忆 / 原著资料统计。
  - 最近隐藏反思。
  - 主动消息状态。
  - LLM 用量。
  - 关键后端模块路径。
- 设置页逐步承接：
  - QQ / NapCat 状态。
  - 语音 / TTS / VoxCPM 配置。
  - 表情包配置。
  - 主动消息配置。
  - LLM provider / model routing。
  - Neon / 本机数据库说明。
- Roleplay 页面保持功能可用，但不抢主线优先级。

### 验收标准

- `chat/:id` 的诊断面板能在桌面和移动视口正常阅读，不出现明显文本溢出或层叠遮挡。
- 诊断文案具体指向运行事实，不使用空泛的装饰性描述。
- UI 不新增大型营销 hero、嵌套卡片或过重装饰。
- 涉及 UI 的改动经过本机浏览器验证。

### 建议测试命令

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
cd F:\Code\Mirrai
corepack pnpm run check
corepack pnpm run dev
```

### 注意事项

- 视觉方向以安静、紧凑、可扫描为主。
- 调试面板是工具，不是角色沉浸文案。
- 本阶段如果涉及截图或浏览器验证，应记录视口和页面路径。

## 后续节奏

建议每次只推进一个阶段里的一个小交付物：

1. 先读相关文件和当前测试。
2. 写最小改动。
3. 跑 focused 测试。
4. 必要时同步到本机运行目录做端到端验证。
5. 更新本计划或 `docs/todo.md` 的完成状态。

优先级顺序固定为：阶段 1 → 阶段 2 → 阶段 3 → 阶段 4 → 阶段 5。  
如果中途出现线上可用性问题，允许临时插队修复，但修完后回到当前阶段。
