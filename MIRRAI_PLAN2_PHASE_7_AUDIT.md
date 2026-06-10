# Mirrai Plan2 阶段 7 Roleplay 多角色频道 Beta 收束记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)

## 阶段目标

阶段 7 的目标是把 Roleplay 多角色频道从实验入口整理成可控 Beta：它应是多角色共同生活 / 对话频道，不反向污染一对一聊天 runtime；角色每轮只代表自己发言，允许沉默只作为显式配置存在，且成本紧张时自动轮转应收敛。

## 已有基线盘点

- 已存在 `roleplay_channels`、`roleplay_channel_members`、`roleplay_messages` 三张表和兼容建表 helper。
- 已存在 `/roleplay` 页面，支持新建频道、频道列表、用户插话、推进一轮和指定角色发言。
- `runRoleplayChannelTurn` 已按频道成员、历史消息、场景提示和角色 profile 组装 roleplay prompt。
- `roleplay` purpose 已进入 LLM usage 记录，后续可按 route / purpose 汇总成本。

## 本轮完成内容

### Runtime 收束

修改位置：

- [server/social/roleplay-channel.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/roleplay-channel.ts>)
- [server/social/roleplay-channel.test.ts](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/server/social/roleplay-channel.test.ts>)

变更：

- 新增 `allowSilence` 解析测试，确认模型返回不发言时可以被解析为沉默轮次。
- 接入 `getCurrentLlmEconomyPolicy`。
- 新增 `shouldSkipAutomaticRoleplayTurnForEconomy(level, requestedPersonaId?)`：
  - `strict` 省额度模式下跳过自动轮转。
  - 用户显式指定 `personaId` 时仍允许该角色发言，避免 UI 操作被省额度模式误挡。
  - `off` / `conservative` 不跳过自动轮转。
- 按省额度档位收紧 roleplay 历史 transcript 和 max tokens，降低长频道持续运行成本。
- 保持每次 tick 最多新增一条角色消息，不扩大为批量发言。

### UI 收束

修改位置：

- [client/src/pages/Roleplay.tsx](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/client/src/pages/Roleplay.tsx>)

变更：

- 新增“允许沉默”开关，并随 `roleplay.tick` 请求传入 `allowSilence`。
- 成员选择区新增上移 / 下移图标按钮，创建频道前可以调整发言顺序。
- 已选成员头像角标显示当前顺序数字，未选成员继续显示姓名首字。
- 空频道文案调整为“频道还没有消息。”，避免误导用户以为自动轮转已经失败。

## 验证命令与结果

同步盘源码目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/sync-local-worktree.ps1
```

结果：同步到 [F:/Code/Mirrai](<F:/Code/Mirrai>) 成功。

本机运行目录执行：

```powershell
corepack pnpm run check
```

结果：`tsc --noEmit` 通过。

本机运行目录执行：

```powershell
corepack pnpm exec vitest run server/social/roleplay-channel.test.ts server/social/source-recall.test.ts server/llm/usage.test.ts server/llm/economy.test.ts
```

结果：通过，`4 passed / 22 tests passed`。

浏览器 smoke：

- 使用本机服务 [http://localhost:3000](http://localhost:3000)。
- 通过 `/api/auth/register` 创建临时 smoke 用户 `codex_roleplay_smoke_*`。
- 通过本机 DB helper 创建两个 ready persona：`烟测甲`、`烟测乙`。
- 打开 `/roleplay`，验证：
  - 页面标题“角色频道”可见。
  - “允许沉默”开关可见。
  - 两个 ready persona 可见。
  - 上移 / 下移排序按钮可见。
  - 点击下移可以调整顺序。
  - 可以创建角色频道。
  - 空频道显示“频道还没有消息。”。
  - “推进一轮”和“让 烟测甲 / 烟测乙 说话”按钮可见。
- 桌面 `1280 x 720`：
  - `document.documentElement.scrollWidth === clientWidth`，`1280 / 1280`。
  - `document.body.scrollWidth === clientWidth`，`1280 / 1280`。
- 移动 `390 x 844`：
  - `document.documentElement.scrollWidth === clientWidth`，`390 / 390`。
  - `document.body.scrollWidth === clientWidth`，`390 / 390`。
- 本轮 smoke 没有触发真实 LLM 调用，只验证 Beta 入口、布局和可操作控件。
- 临时用户、角色、频道和消息已通过 `deleteUserAccount` 按 userId 清理。
- 上一次中断遗留的空临时用户 `codex_roleplay_smoke_1780916483907` 也已清理；更早记录中的 `codex_roleplay_smoke_1780915632220` 在当前数据库中不存在。

## 阶段 7 验收项

- [x] 两个及以上 ready persona 可以创建频道。
- [x] 成员顺序可在创建前调整。
- [x] 指定角色发言入口存在且不被 strict 省额度自动跳过规则误挡。
- [x] 自动轮转在 strict 省额度模式下会跳过，避免成本失控。
- [x] 允许沉默有单元测试覆盖，并接入 UI 请求。
- [x] Roleplay UI 在桌面和移动视口无页面级横向溢出。

## 当前缺口

- 本轮 smoke 没有触发真实 roleplay LLM 回复；真实发言质量和沉默概率仍需要在有成本预算时手动抽样。
- Roleplay 频道的导出 / 删除覆盖已在阶段 9 纳入用户数据导出和删除策略；删除角色后成员不足的频道会自动停用并保留历史。
- Roleplay 频道列表仍是最小可用形态，没有搜索、归档和频道级复制 / 导出能力；这些不阻塞 Beta。
- 省额度模式的 UI 解释仍主要在设置 / 诊断阶段承接，后续阶段 8 可继续把“为什么自动轮转被跳过”变得更可见。

## 阶段 7 当前结论

阶段 7 核心 Beta 收束已完成：Roleplay 页面具备频道列表、成员选择与排序、场景提示、用户插话、指定角色发言、自动轮转入口和允许沉默开关；runtime 在严格省额度模式下会限制自动轮转，同时保留显式角色发言。单元测试、类型检查和桌面 / 移动浏览器 smoke 均已通过。后续应优先进入阶段 9，把 roleplay、memory、source、usage 等新增私密数据纳入导出、删除和本机缓存清理策略。
