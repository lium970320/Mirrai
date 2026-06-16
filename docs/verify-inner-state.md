# 待验证：人物内在状态层（PR #7 / 合并提交 c470ede）

> 自动闸门已过：`tsc --noEmit` 零错误、`vitest run` 45 文件 / 244 测试全过（含新增 12）。
> 以下是**需要起服务、隔时段人工观察**的行为验证。本特性已合并进 `main`，但建议你过一遍再大规模放量。
> 出问题可单独回退：本特性都在 PR #7，`git revert c470ede` 即可，其余 main 不受影响。

---

## 〇、起服务（运行机）

```powershell
cd F:\Code\Mirrai
corepack pnpm run dev:local        # 或 scripts\start-all.ps1 -UseLocalDb
```

> 若服务原本在跑，需重启才会加载新代码；两条新列在首次访问 DB 时自动迁移。

---

## 一、DB 自动加列自检（首次访问触发 ensure*）

启动后随便加载一个分身或聊一句，然后查列是否存在、有无 SQL 报错：

```sql
SELECT column_name FROM information_schema.columns
 WHERE table_name='persona_runtime_states' AND column_name='runtimeInnerState';   -- 期望 1 行
SELECT column_name FROM information_schema.columns
 WHERE table_name='memories' AND column_name='followUpAt';                          -- 期望 1 行
```

---

## 二、内心状态延续（核心）

1. **制造情绪**：发一段让分身动容（表白/想念）或被冷落（"你怎么这么敷衍"）的对话。
2. **立刻查库**：
   ```sql
   SELECT "runtimeInnerState" FROM persona_runtime_states WHERE "personaId"=<id>;
   ```
   期望：有 `mood / valence / energy / intensity / cause / preoccupation / dayContext / updatedAt` 字段。
3. **隔一会（几小时内）再聊一句中性的话** → 回复应**仍带上一轮的余温/微冷**，不是瞬间回到中性。
4. **隔很久（>18 小时）再聊** → 心情应已**松回"平静"**（intensity≈0）。

**预期**：心情有延续、会随时间淡化，不再每轮按关键词重置。

---

## 三、人物"自己的一天"

- 同一天多次聊 → 当天有一致底色（偏累 / 偏轻快 / 想念加重等）；**换一天可能不同**（按 `hash(personaId+dateKey)` 稳定生成）。
- 不同作息时段对比（深夜 vs 晚间）→ 深夜回复更短更低、晚间更开放（精力随作息）。
- 提示词里能看到「当前内心状态」块带"今天……"。可临时在回复链路打印 `buildInnerStateOverlay` 输出确认。

---

## 四、关心回访（open_loop）

1. 告诉分身一件未来的事：**"我明天有个面试"**。
2. 查记忆是否带回访时间：
   ```sql
   SELECT id, title, "memoryType", "followUpAt" FROM memories
    WHERE "personaId"=<id> AND "memoryType"='open_loop' ORDER BY id DESC;
   ```
   期望：该条 `followUpAt ≈ 明天`。
3. **到点后**（或手动把该行 `followUpAt` 改成过去时间）等一条主动消息 → 分身应**自然问起"上次那件事/面试怎么样了"**；问过后 `followUpAt` 应变 `NULL`（不再反复问）。
4. 聊天中也可验证：到期 open_loop 更容易被召回（被动想起）。

> 提示：主动消息按时段+概率触发；想强制触发可用 `maybeSendAmbientPresenceMessage(..., { force: true })` 或运维触发入口。

---

## 五、媒体回合也演进

- 发一张图 / 表情包 → 回复后再查 `runtimeInnerState` 的 `updatedAt` 应**已刷新**（媒体回合也读取+写回内心状态，不再只读）。

---

## 六、兼容回归

- `personas.emotionalState` 列仍正常更新（warm/playful/nostalgic/melancholy/happy/distant 之一，现在由内在状态派生）。
- 亲密度（emotionVariety）与毕业判定不受影响（仍消费该标签）。

---

## 验证结论回执（验证后填）

- [ ] DB 两列已加、无启动报错
- [ ] 内心状态延续 / 衰减 / 跨天重置符合预期
- [ ] 自己的一天有当天一致底色
- [ ] 关心回访能埋入并到期问起、且不复问
- [ ] 媒体回合也写回状态
- [ ] 旧 emotionalState / 亲密度链路无回归

> 有红字或行为不符，把现象 + 上面 SQL 的结果贴回来定位。

---

# 待验证（第二批）：人物配置化 + 更像真人（P0/P1/P2，PR #8 / c… 待填）

> 自动闸门已过：`tsc` 零错误、`vitest` 258 全过。
> 安全设计：**P0 默认行为与现状逐字节一致**；P1 为增量丰富；P2 两个高风险项（回应延迟、主动多模态）**默认关闭**，线上不变，验证后再开。

## P0 人物配置化（应「无变化」=回归点）
- 王芃泽分身体验应与之前**完全一致**（默认配置）：重点确认「当前生活行程」overlay、深情语气、原著召回都没变。
- 验证可配置：给一个测试分身 `personaData.profileSections.life` 写入 `{ settingLine, partnerName, sourceTerms }`（可选 `routines`），确认其生活行程 overlay 跟着变（如"被{partnerName}叫醒"、不同 settingLine）。
- **已知暂缓**（与原著角色名强耦合，留到带验证时做）：`memory-recall` 的"她→他"代词反转、source 词表逐人物穿透、`turn-planner`/`reflection` 里"王芃泽"语气字面量。

## P1 主动消息有由头
- 主动/氛围消息现在带"你今天的状态：…"（来自 dayContext），偶尔顺口提自己今天；到期回访仍由氛围消息问起（见第一批第四节）。
- 验证：连续触发几条主动消息（可 `force`），看是否有"今天…"由头、不再是纯寒暄。

## P1 关系张力与修复
- 发带冲突信号的消息（如"你最近好冷漠/不理我"）→ 之后几轮回复应带点"收着"的别扭，而非立刻恩爱；隔一段时间或经一轮表白/安慰后回暖。
- 查 `runtimeInnerState.relationshipTone`（tone/intensity）应出现并随时间衰减。

## P2 记忆显著性（已开，仅影响排名，安全可逆）
- 召回更偏向近期 + 高重要度；很旧、低重要度、长期没碰的记忆排名下沉（**不删除、不归档**，纯排名）。高重要度不受影响。

## P2 回应延迟（⚙️ 默认关：`PERSONA_REPLY_LATENCY_ENABLED`）
- 默认未设 → 秒回、无变化。
- 设为 `true` 后：忙碌/克制时段（brief）回复会隔几秒~十几秒才发，期间来新消息仍被既有 isStale 守住。当前接在 QQ 文本主路。

## P2 主动多模态（⚙️ 默认关：`PROACTIVE_MULTIMODAL_ENABLED`，决策层就绪、发送待接）
- 默认关 → 无变化。设为 `true` 后，氛围消息诊断里会记录本条 `multimodalIntent`（voice/sticker/text）；**实际发语音/表情的集成是下一步**（本批只做了决策原语 + 开关 + 记录意图）。

## 第二批回退
全部在本 PR，可整体 revert。
