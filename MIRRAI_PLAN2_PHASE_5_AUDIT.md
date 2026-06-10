# Mirrai Plan2 阶段 5 QQ / NapCat 端到端验证记录

记录时间：2026-06-08  
对应计划：[MIRRAI_WORK_PLAN_2.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/MIRRAI_WORK_PLAN_2.md>)  
验证流程：[docs/qq-e2e-verification.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/qq-e2e-verification.md>)

## 阶段目标

阶段 5 的目标是在 mock 事件测试之外，完成一套可以复现的真实 QQ / NapCat / OneBot 验证流程，确认 QQ 作为外部社交入口时具备可启动、可绑定、可收发、可降级、可定位问题和可清理临时数据的能力。

## 本轮完成内容

- 新增 [docs/qq-e2e-verification.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/qq-e2e-verification.md>)，覆盖：
  - 本机路径和同步盘约束。
  - `.env` 和 TTS 配置预检。
  - Mirrai / NapCat 启动与状态检查。
  - NapCat HTTP POST 上报和 webhook token 配置。
  - QQ 联系人绑定。
  - 私聊文本、群聊跳过、语音输入、语音输出、图片 / 表情包输入、主动表情包、主动消息手动验证矩阵。
  - 日志关键词和清理步骤。
- 更新 [docs/qq-onebot.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/qq-onebot.md>)，修正过时限制：
  - 当前已支持 QQ `record` 语音输入转写。
  - 当前已支持 QQ 语音输出策略和 TTS fallback。
  - QQ 新消息和主动消息已使用 `channel: "qq"`。
- 更新 [docs/release-candidate-checklist.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/release-candidate-checklist.md>)，把 QQ / OneBot 手动验证指向完整 E2E 流程。

## 本机只读预检

本机运行目录：[Mirrai](<F:/Code/Mirrai>)

已执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/status-mirrai.ps1
powershell -ExecutionPolicy Bypass -File scripts/status-qq.ps1
```

结果：

- Mirrai 本机服务正在运行。
- `http://localhost:3000/` 返回 `Web: OK (200)`。
- [F:/Code/Mirrai/.env](<F:/Code/Mirrai/.env>) 存在。
- [onekey-v4.18.1](<F:/.mirrai-local/Mirrai/tools/napcat/onekey-v4.18.1>) 存在。
- [logs](<F:/.mirrai-local/Mirrai/logs>) 存在。
- QQ/NapCat 当前 `Process: STOPPED`。
- OneBot 当前 `NOT RESPONDING`，错误为无法连接到远程服务器。
- 本机日志显示今日早些时候曾成功发送 QQ 主动消息到 `qq:private:1274568850`，说明该机器配置曾经连通，但当前不在线。

## 2026-06-09 只读复核

本机运行目录：[Mirrai](<F:/Code/Mirrai>)

已执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-readiness.ps1 -Json
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -Json
powershell -ExecutionPolicy Bypass -File scripts/check-qq-webhook-smoke.ps1
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -CreateBaselinePath F:\.mirrai-local\Mirrai\logs\qq-e2e-baseline-2026-06-09.json
```

结果：

- Mirrai Web 正常，`http://localhost:3000/` 返回 `200`。
- [F:/Code/Mirrai/.env](<F:/Code/Mirrai/.env>) 存在，`QQ_ENABLED=true`，OneBot access token 和 webhook secret 均已配置，脚本输出未打印真实密钥。
- NapCat / QQ 相关进程数为 5。
- OneBot `OK`，登录用户为 `广袤 (3321802943)`。
- `readyForManualE2E=true`，当前外部运行态已经满足“可以让测试联系人发消息”的前置条件。
- QQ webhook smoke 通过：HTTP OK，响应 `status=ok`、`handled=false`、`reason=ignored_self_message`。
- 证据脚本当前未看到新的真实私聊文本 inbound / outbound、语音、图片 / 表情包或主动消息证据；这符合“尚未让测试联系人发真实消息”的状态。
- 已创建本轮 baseline：[qq-e2e-baseline-2026-06-09.json](<F:/.mirrai-local/Mirrai/logs/qq-e2e-baseline-2026-06-09.json>)。后续真实消息测试后可用该 baseline 只分析新增日志。

## 当前未完成项

- 真实 QQ 私聊文本收发尚未在本轮执行；当前 NapCat / OneBot 已在线，缺的是测试联系人或测试小号给机器人 QQ 发起私聊。
- 真实 QQ 语音输入、语音输出、图片 / 表情包输入、主动表情包和主动消息尚未在本轮完成在线验证。
- 仍需要一个测试联系人或测试小号主动给机器人 QQ 发私聊，以进入“最近 QQ 联系人”绑定流程。

## 下一步条件

要继续完成阶段 5，需要先满足：

1. 保持当前 Mirrai Web、NapCat / QQ 和 OneBot 在线。
2. 测试联系人给机器人 QQ 发送一条私聊文本。
3. 在设置页 QQ 标签确认联系人已自动绑定，或手动绑定到 ready 分身。
4. 使用本轮 baseline 复查新增日志：

```powershell
cd F:\Code\Mirrai
powershell -ExecutionPolicy Bypass -File scripts/check-qq-e2e-evidence.ps1 -BaselinePath F:\.mirrai-local\Mirrai\logs\qq-e2e-baseline-2026-06-09.json
```

5. 继续按 [docs/qq-e2e-verification.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/qq-e2e-verification.md>) 验证语音、图片 / 表情包和主动消息。

## 阶段 5 当前结论

阶段 5 的文档、预检、日志定位流程和 webhook smoke 已完成；2026-06-09 复核时 NapCat / OneBot 已在线，真实在线 E2E 不再卡在 OneBot 不可达，而是等待测试联系人或测试小号发起真实私聊。满足该外部输入后，应继续按 [docs/qq-e2e-verification.md](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/docs/qq-e2e-verification.md>) 逐项验证并更新本记录。
