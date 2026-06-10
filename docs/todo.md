# TODO

## 当前剩余优化优先级

这部分是统一路线图；下面各模块保留详细背景和已完成范围，避免优化方向散在不同章节里看不清。

### P0 近期优先

- 已完成 P0 可观测基线：LLM 调用已记录 provider、model、purpose、user、persona、route、token 估算、耗时和成败；用量已支持数据库持久化和进程内 fallback，并在运维诊断展示今日 / 本周 / 本月统计、今日用户 / 角色 / 入口成本归属，以及按时间、用户、角色、route、provider、purpose、成功状态筛选的用量明细；运维诊断已增加排障清单，可把数据库、LLM 用量持久化、QQ / OneBot、微信 Web 登录 / 同步、ASR / TTS / VoxCPM / MiniMax、音频转码和 sticker 发送错误分类成脱敏 raw error 与可执行步骤；economy policy 已按 `off / conservative / strict` 缩短历史窗口、长期记忆召回体量和原著证据体量，并进一步按 source / proactive / media / technical / 高频 QQ 微信短聊 / 情绪深情表达等 intent 与 route 细分召回降级，写入 runtime diagnostics；`runtimeLifeState`、`runtimeDiagnostics`、主动消息随机计划和发送状态已通过 `personaRuntime` 兼容层与 `persona_runtime_states` 独立表从稳定人物画像分离；聊天诊断面板已展示回合规划、资料库召回、长期记忆、语音/表情包判断、主动消息随机时间和 LLM 用量。详见 [MIRRAI_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_2_AUDIT.md>) 和 [MIRRAI_PLAN2_PHASE_2_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_2_AUDIT.md>)。
- 已完成运维诊断基线：设置页新增“运维诊断”，集中展示运行与数据库、LLM 路由、QQ / 微信接入、Runtime 收敛、语音、表情包和主动消息；聊天页入口统一为“运行诊断”。详见 [MIRRAI_PHASE_5_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_5_AUDIT.md>)。
- 已完成 Plan2 数据安全清理基线：本机清理脚本默认 dry-run，覆盖 uploads、TTS cache、tmp、logs、截图、NapCat downloads 和微信 session；NapCat runtime、VoxCPM runtime、torch runtime、Hugging Face / ModelScope 模型缓存必须显式开关 + `DELETE LARGE MIRRAI RUNTIME` 确认短语才能删除。详见 [MIRRAI_PLAN2_PHASE_9_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_9_AUDIT.md>)。
- 已完成 Plan2 收尾决策：本地可完成的稳定化主线已收口，真实 QQ 私聊、远程库验证、完整备份包、素材生产和打包发布进入外部输入或后续计划。详见 [MIRRAI_PLAN2_PHASE_10_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_10_AUDIT.md>)。
- P0 当前无明确剩余项；后续可作为运营增强继续补用量导出、分页和更细报表。

### P1 中期整理

- 已完成社交 runtime 统一基线：Web / QQ / WeChat 文本与媒体入口共用 shared social runtime contract；QQ 新消息和主动消息使用 `channel: "qq"`；主动消息接入 proactive turn planner 和 runtime diagnostics。详见 [MIRRAI_PHASE_4_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_4_AUDIT.md>)。
- 已完成 QQ 主链路测试基线：OneBot 事件级 fixture 覆盖普通私聊文本、群聊跳过、语音输入失败降级、语音输出失败降级、base64 语音、base64 图片、图片文本占位回退和表情包失败不影响主回复；关键 `console.info` / `console.warn` 日志与降级原因已做 spy 断言。详见 [MIRRAI_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PHASE_3_AUDIT.md>)。
- 已新增 QQ / OneBot 在线 E2E 只读预检脚本：[check-qq-e2e-readiness.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-readiness.ps1>)，并对最近日志信号做 token 脱敏；2026-06-09 复核时 Mirrai Web 正常、NapCat / QQ 进程在线、OneBot `OK`、`readyForManualE2E=true`，真实在线 E2E 已进入等待测试联系人发起私聊文本 / 语音 / 图片消息的阶段。
- 已新增 QQ / OneBot 在线 E2E 日志证据脚本：[check-qq-e2e-evidence.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-e2e-evidence.ps1>)；支持测试前创建 baseline、测试后只分析新增日志，并汇总私聊文本、语音、图片 / 表情包和主动消息证据；当前 baseline 为 [qq-e2e-baseline-2026-06-09.json](<F:/.mirrai-local/Mirrai/logs/qq-e2e-baseline-2026-06-09.json>)。
- 已新增 QQ webhook 入口 smoke 脚本：[check-qq-webhook-smoke.ps1](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/scripts/check-qq-webhook-smoke.ps1>)；已验证 Mirrai webhook 路由、token 鉴权、JSON body 解析和 QQ handler 入口可用，但不替代真实 NapCat 上报和测试联系人消息。
- P1 后续增强：真实测试联系人消息端到端验证、真实数据库迁移执行确认，以及未来新增平台继续沿用 `runtime-request` contract。
- VoxCPM 情绪质量：继续补 `comfort`、`tease`、`angry_soft`、`sad_low` 的干净参考音频，并优化生成速度和情绪判断。

### P2 低优先级

- 表情包素材和意图优化：替换默认占位素材，增加更细的情绪标签；以后可让 LLM 只判断表情意图，不指定文件。
- 角色规则测试：把异地、健康状态、不要轮椅、不要括号旁白、不编原著、不催睡循环等规则做成开发期测试。当前聊天表现正常，先不作为近期重点。
- `profileSections` 数据结构升级：以后再考虑从 JSON 内部结构升级成单独数据库表或版本化 migration。

## 已完成第一版，后续优化

### QQ 语音消息识别与偶尔语音回复

目标：为当前 QQ / NapCat / OneBot 接入更完整的异步语音消息能力，不做实时通话。

已完成第一版：

- `server/qq/message-handler.ts` 已支持 NapCat / OneBot `record` 语音消息。
- 语音输入链路已接通：OneBot 获取语音文件、音频格式归一化、智谱 ASR 转写、转写文本进入共享 persona / LLM 回复流程。
- 语音输出链路已接通：默认文字回复；配置允许、智能判断通过或用户明确要求时，通过 VoxCPM 生成语音并用 OneBot 发回 QQ。
- 下载、转码、ASR、TTS、发送任一步失败时，会退回文字回复或自然提示，不中断主对话。
- `server/voice/audio-normalizer.ts`、`server/voice/zhipu-asr.ts`、`server/voice/voice-reply-policy.ts`、`server/voice/voxcpm-voice-profile.ts` 已覆盖当前第一版主链路。

后续优化：

- 把 QQ 语音输入/输出模块名进一步拆细，向 `audio-resolver`、`speech-to-text`、`text-to-speech`、`voice-sender` 这种更清晰的边界演进。
- 增加更完整的失败路径测试和真实 OneBot fixture。
- 继续优化 VoxCPM 参考音频、情绪 profile 和生成速度。
- 如果以后恢复微信，再单独评估 wechat4u 语音接入。

第一版不做：

- QQ / 微信语音电话、自动接听、实时通话。
- 微信侧 wechat4u 语音接入。
- QQ 原生语音条强适配。
- 强制 silk / amr 编码发送。
- 复杂声纹识别或多人说话分离。

验证要求：

- TypeScript 类型检查通过。
- `corepack pnpm run check` 通过。
- 失败路径没有未捕获异常。
- 日志能区分语音下载、格式检测、转码、ASR、TTS、发送和降级原因。

### 人物运行时 / 回合规划

已完成第一步：

- 新增 `server/social/persona-turn-planner.ts`，在每轮回复前生成内部规划：入口、用户意图、记忆模式、当前活动、可回复程度、回复长度目标、输出倾向和风险。
- `server/social/persona-text-chat.ts` 和 `server/social/persona-media-chat.ts` 已接入回合规划，提示词会显式约束短句、连续消息、原著幻觉、睡眠状态和重复关心等风险。
- 网页文字和网页图片回复已接入共享社交人物链路，减少网页、QQ、微信表现不一致。
- 网页录音旧逻辑已停止“根据上下文猜测转写”，无法转写时只做自然降级，避免编造语音内容。
- 新增 `persona.getRuntimeState` 调试接口，可查看当前日程状态、临时生活状态、资料库统计、人物资料字段、核心运行模块和有效系统提示词。
- 原著资料库召回增强了连续追问识别；用户在问完原著问题后继续问“谁、哪里、怎么、哪段、是不是真的”等，也会沿用上一轮原著问题进入资料库检索。
- 固定时间主动消息已增加每日随机窗口：每个配置时间会在前 10 分钟到后 10 分钟内抽取当天实际发送时间，并写入 `proactiveMessages.randomizedSchedule`，避免精确打卡感和重复随机。

后续优化：

- 将回合规划结果持久化到调试表或调试日志面板，方便查看每一轮“为什么这轮这么回”。
- `personaData` 已增加兼容式 `profileSections` 拆分层：核心画像、性格情感、关系记忆、说话方式、原著资料、行为策略、运行时状态。旧字段仍保留，避免破坏现有编辑页和运行逻辑。
- 人物编辑页已改成按 `profileSections` 分区编辑：核心、性格、关系、原著、说话、行为。保存时会同时写回旧字段和新的分区结构，保证旧角色和新 prompt 逻辑兼容。
- 将网页、QQ、微信的输出策略继续统一到一个 `persona-runtime` 目录下，适配层只负责收发消息。
- 低优先级补充角色规则测试：异地、车祸前健康状态、中考回忆、不要轮椅、不要动作旁白、不要催睡循环、原著问题不编造。当前聊天表现正常，先不作为近期重点。

后续可继续：

- 将 `profileSections` 从 JSON 内部结构进一步升级为单独数据库表或版本化 migration。
- 主动消息运行时状态已从画像资料拆到 `persona_runtime_states`；后续只需继续评估主动消息用户配置是否也需要单独表化。

### 额度 / Token / 成本控制

目标：让系统知道每轮大概用了多少额度，并能主动减少不必要的大模型调用和长上下文消耗。

已完成基线：

- LLM 调用用量已记录 provider、model、purpose、输入 / 输出 token 估算、耗时、是否成功和失败原因。
- LLM 用量已写入 `llm_usage_records`，支持跨重启保留；数据库不可用时回退到当前进程内统计。
- 诊断面板和运维诊断页已展示今日调用、今日 token、最近调用、provider / purpose 分桶；运维诊断页额外展示今日 / 本周 / 本月 token 和调用次数。
- 运维诊断页已支持每日 / 月度软额度提醒；`LLM_DAILY_SOFT_TOKEN_LIMIT`、`LLM_MONTHLY_SOFT_TOKEN_LIMIT` 为 0 时不启用，达到 `LLM_BUDGET_WARNING_RATIO` 后进入接近上限状态，超过后显示超额建议。
- 省额度模式自动执行第一版已接入：`warn` 时暂停环境主动消息和 TTS LLM 润色，`exceeded` 时进一步暂停定时主动消息和非显式语音智能判断；显式语音请求仍保留，原著证据改写会降低 token 上限而不是跳过核查。
- 省额度模式已接入上下文 / 召回降级：`conservative` / `strict` 会缩短 LLM 历史窗口、连续性时间线、长期记忆条数 / 描述长度、原著证据条数 / 摘录长度；不直接跳过原著事实核查。
- LLM 用量已增加用户 / 角色 / route 成本归属字段，内存 snapshot、数据库 snapshot、最近调用和运维诊断页都能展示今日分桶。
- 不同链路已通过 purpose 区分：普通聊天、原著召回、隐藏反思、人物分析、技能管线、毕业判断、角色群聊等。
- `buildSystemPrompt` 默认只注入 `longBackground` 的精简认知锚点，保留人物气质、关系阶段和硬设定，不再每轮常驻最多 32,000 字长篇背景。
- 进入原著资料库证据模式时，系统提示词会关闭长篇背景常驻，要求只使用本轮检索到的内部证据；没有证据则说记不准，避免用概括背景补编剧情。
- DeepSeek 动态路由已接入：`DEFAULT_LLM_PROVIDER=deepseek` 会作为自动路由别名，普通聊天、图片/媒体回复、主动消息、语音回复智能判断、TTS 语音稿润色、记忆提取和日记默认使用 `DeepSeek-Flash`；原著证据召回、人物画像构建、技能管线和毕业信使用 `DeepSeek-Pro`。
- Plan2 Phase 3 已补齐省额度上限说明：`limitsSummary` 会稳定展示每轮 `historyFetchLimit`、`llmHistoryLimit`、长期记忆条数、资料库 chunk / excerpt 限制和原著证据改写 token 上限；设置页“运维诊断 / LLM 路由”同步显示这些保护阈值，并提示“上限不是质量目标”。详见 [MIRRAI_PLAN2_PHASE_3_AUDIT.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_PLAN2_PHASE_3_AUDIT.md>)。

后续增强：

- 运维诊断页已提供 LLM 用量明细筛选；如果后续需要更完整账单或审计报表，可继续增加导出、分页游标和按日期聚合视图。
- 省额度策略已支持按 intent / route 细分召回降级；后续可继续把用量报表、导出和分页做成运营视图。
- 未来如开放用户可编辑上限，需要增加配置边界、异常值保护和误设恢复提示。

### VoxCPM 多 voice profile / 情绪参考音频

已完成第一版：QQ 语音回复在进入 VoxCPM 前会根据回复文本选择 `calm`、`comfort`、`tease`、`angry_soft`、`sad_low` profile。

已完成范围：

- 新增 `server/voice/voxcpm-voice-profile.ts`，支持 profile 配置、文本规则选择和参考音频 fallback。
- 每个 profile 包含 `referenceAudioPath`、`promptText`、`control`、`moods`、`priority`。
- `server/_core/tts.ts` 已接入 profile 选择，profile 会进入 VoxCPM 缓存 key，避免不同 profile 复用同一缓存。
- 当前本机 `.env` 先复用 `calm` 参考音频，用不同 profile 的 `control` 区分情绪；以后有干净素材时再填 profile 专属音频路径。
- 缺失某个 profile 参考音频时，会复用默认 `calm` 的参考音频和 prompt，但保留该 profile 的情绪 control。
- 日志会记录 `voxcpm_voice_profile_selected` 和 `voxcpm_voice_profile_fallback`。

已验证：

- `corepack pnpm exec vitest run server/voice/voxcpm-voice-profile.test.ts server/_core/tts.test.ts`
- `corepack pnpm run check`

后续可优化：

- 给 `comfort`、`tease`、`angry_soft`、`sad_low` 分别补真实干净参考音频。
- 增加可选 LLM profile judge，用于比本地关键词更细地判断语气。
- 根据角色日程、夜间状态、半醒状态进一步影响 profile。

### QQ 角色主动发表情包

已完成 P1：QQ / NapCat / OneBot 侧稳定、自然、低频、可控的角色主动表情包功能。第一版只使用本地 PNG / JPG / GIF 文件，通过 OneBot `image` 消息段发送。

已完成范围：

- 新增表情包素材库 `server/stickers/persona-stickers.ts`，使用本地路径，不依赖外部 URL。
- 每个素材对象包含 `id`、`path`、`enabled`、`mood`、`tags`、`intensity`、`type`、`description`。
- 素材情绪方向至少覆盖：开心、害羞、撒娇、无语、吐槽、委屈、安慰、生气（轻度）、认同、得意、困惑。
- 新增 QQ 表情包配置项，包含启用开关、概率、最大回复长度、冷却时间、群聊限制、用户发梗/调侃/表情后的加权开关、最近使用去重数量、素材根目录。
- 新增策略模块 `server/stickers/sticker-policy.ts`，根据回复长度、冷却、群聊、用户是否发了表情包/玩笑/调侃、当前内容是否严肃或技术化，决定是否允许发表情包。
- 新增意图模块 `server/stickers/sticker-intent.ts`，第一版用本地规则生成结构化 `stickerIntent`，只表达情绪意图，不指定具体文件路径。
- 新增选择器 `server/stickers/sticker-selector.ts`，按 mood、intensity、tags 从素材库选择合适表情包，并避免连续重复。
- 新增发送器 `server/stickers/sticker-sender.ts`，通过 OneBot 发送 PNG / JPG / GIF。
- 主流程已接入 `server/qq/message-handler.ts`：先正常发送文字回复，再按策略和意图尝试发送表情包。语音回复场景不额外发表情包，避免刷屏。

配置项：

- `QQ_STICKER_REPLY_ENABLED`
- `QQ_STICKER_REPLY_PROBABILITY`
- `QQ_STICKER_REPLY_MAX_REPLY_LENGTH`
- `QQ_STICKER_REPLY_COOLDOWN_SECONDS`
- `QQ_STICKER_REPLY_ALLOW_GROUPS`
- `QQ_STICKER_REPLY_ALLOW_AFTER_USER_STICKER`
- `QQ_STICKER_REPLY_ALLOW_AFTER_USER_JOKE`
- `QQ_STICKER_REPLY_ALLOW_AFTER_USER_TEASE`
- `QQ_STICKER_REPLY_AVOID_REPEAT_RECENT_COUNT`
- `QQ_STICKER_BASE_DIR`

适合发表情包：

- 用户发来表情包。
- 用户调侃、撒娇、吐槽、开玩笑。
- 用户表达强烈情绪。
- 机器人回复是短句、情绪化回应或角色化回应。
- 机器人表达害羞、无语、安慰、轻微吐槽。

不适合发表情包：

- 严肃问题、技术问题、信息查询。
- 学术、作业批改、代码分析、解释性长文。
- 明确要求简洁、专业、正式的对话。
- 回复文本太长或刚刚发过表情包。
- 群聊默认不发，除非配置允许。

已实现降级：

- `QQ_STICKER_REPLY_ENABLED=false` 时完全不发表情包，正常文字回复。
- 本地意图模块没生成 `stickerIntent` 时默认不发表情包。
- `stickerIntent.shouldSend = true` 但没选到图时，只保留文字回复。
- 文件不存在、路径错误、OneBot 发送失败时，只保留文字回复并记录日志。
- 任意表情包失败都不能中断主对话流程。

日志要求：

- `sticker_policy_checked`
- `sticker_skipped_by_config`
- `sticker_skipped_by_length`
- `sticker_skipped_by_cooldown`
- `sticker_skipped_by_group`
- `sticker_selected_by_policy`
- `sticker_intent_detected`
- `sticker_candidate_found`
- `sticker_selected`
- `sticker_not_found`
- `sticker_send_start`
- `sticker_send_success`
- `sticker_send_failed`
- `sticker_send_failed_fallback_text`

后续可优化：

- 用 LLM 做更细的 `stickerIntent` 判断，但仍只输出情绪意图，不指定文件路径。
- 替换 `assets/stickers/persona` 下的默认占位素材为真实角色表情包。
- 增加更多素材检索规则和更细的情绪标签。
- 优化 GIF 在不同 NapCat / OneBot 版本下的显示效果。
- 如以后恢复微信，再单独研究微信原生收藏表情 / Emoticon；当前不做微信侧。

第一版不做：

- 微信原生收藏表情发送。
- 微信商店 Emoticon 发送。
- 复杂表情包在线生成。
- 高频连续发表情包。
- 群聊高频刷屏。

已验证：

- `corepack pnpm run check` 通过。
- `corepack pnpm exec vitest run server/stickers/sticker-policy.test.ts server/stickers/sticker-selector.test.ts` 通过。
