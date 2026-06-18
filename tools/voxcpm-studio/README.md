# VoxCPM Studio · 本地 TTS 试音台

一个**完全独立**的 Web 工作台，用来直接体验 / 调试 Mirrai 项目里的 VoxCPM 语音合成：输入文字 → 选音色或自定义控制提示 → 生成 → 在线试听 → 下载，并支持声音克隆、参数微调、多音色 A/B 对比和历史记录。

它不修改 Mirrai 主项目任何代码，只是一个轻量代理：把浏览器请求转发给现有的 VoxCPM HTTP 服务（默认 `127.0.0.1:8818`），并托管前端页面与生成的音频。

## 前置条件

- 本机已安装 **Python 3.9+**（试音台自身只需 fastapi/uvicorn 等轻量依赖）。
- 首次使用需安装一次 VoxCPM 运行环境（仅一次）：
  ```powershell
  powershell -ExecutionPolicy Bypass -File scripts/setup-voxcpm.ps1
  ```
  之后用下面的「一键启动」即可——脚本会在需要时自动拉起 VoxCPM 服务，无需手动启动。

## 一键启动（推荐）

双击 `tools/voxcpm-studio/start.cmd`，或运行：

```powershell
powershell -ExecutionPolicy Bypass -File tools/voxcpm-studio/start.ps1
```

它会自动完成三步：① 确保 VoxCPM 服务在线（未在线则调用 `scripts/start-voxcpm.ps1` 拉起并等模型就绪）→ ② 启动试音台（首次自动建 venv、装依赖）→ ③ 就绪后自动打开浏览器 **http://127.0.0.1:8820**。按 `Ctrl+C` 停止。

一键脚本参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-Port` | `8820` | 试音台监听端口 |
| `-VoxcpmServiceUrl` | `http://127.0.0.1:8818` | 现有 VoxCPM 服务地址 |
| `-TimeoutSeconds` | `180` | 单次合成超时 |
| `-RuntimeRoot` | `F:\.mirrai-local\Mirrai\voxcpm-studio` | 运行时根（.venv / 生成音频 / 上传文件），在源码树外、不被同步 |
| `-NoBrowser` | 关 | 不自动打开浏览器 |
| `-SkipVoxcpm` | 关 | 不自动启动 VoxCPM（假设已由外部启动） |
| `-Reinstall` | 关 | 强制重装依赖 |

## 进阶：仅启动试音台后端

若 VoxCPM 服务已经在运行，只想单独起试音台：

```powershell
powershell -ExecutionPolicy Bypass -File tools/voxcpm-studio/run.ps1
```

首次运行会自动在 `tools/voxcpm-studio/.venv` 创建虚拟环境并安装依赖，然后启动服务。
启动后浏览器访问 **http://127.0.0.1:8820**。

常用参数：

| 参数 | 默认值 | 说明 |
| --- | --- | --- |
| `-Port` | `8820` | 试音台监听端口 |
| `-VoxcpmServiceUrl` | `http://127.0.0.1:8818` | 现有 VoxCPM 服务地址 |
| `-TimeoutSeconds` | `180` | 单次合成超时（模型首次加载较慢，给足余量） |
| `-RuntimeRoot` | `F:\.mirrai-local\Mirrai\voxcpm-studio` | 运行时根（.venv / 生成音频 / 上传文件），在源码树外、不被同步 |
| `-Reinstall` | 关 | 强制重装依赖 |

示例：换端口并指向另一台 VoxCPM 服务
```powershell
powershell -ExecutionPolicy Bypass -File tools/voxcpm-studio/run.ps1 -Port 9000 -VoxcpmServiceUrl http://127.0.0.1:8818
```

## 功能

- **王芃泽克隆音色**：5 个情绪 profile（日常 / 安慰 / 调侃 / 轻微不满 / 低落深夜）直接产出王芃泽的声音——参考音频、控制提示、prompt 全部读自 Mirrai 运行树 `.env`（与 QQ 语音同一套配置）。也可切到「自定义」自己写控制提示。
- **声音克隆**：上传参考音频，支持 `controllable`（控制提示 + 参考音色）和 `hifi`（参考音频 + 转录文本，忽略控制提示）两种模式。
- **参数微调**：CFG scale、推理步数、归一化、降噪（降噪需 VoxCPM 环境装 FFmpeg shared 库）。
- **快捷词条 + 停顿助手**：control 旁一键追加语速/情绪/停顿词条；正文一键插入 …… / 句号 / 问号（VoxCPM 靠标点控停顿，换行无效、不支持 SSML）。
- **AI 表演增强**：一键调 LLM（复用 Mirrai 运行树 `.env` 的 provider）把普通文本改写成带停顿、有情绪起伏的台词 + 控制提示。
- **分段表演稿**：把长文本拆成多段，每段配各自的情绪音色与段后停顿，分别合成后用标准库 `wave` 拼成一条——实现一句话里的情绪转折与逐段语速控制。
- **A/B 对比**：同一段文本一键用全部 5 个音色各生成一次，并排试听。
- **历史记录**：每次生成自动留存（文本、参数、音频），可重新播放、收藏、回填参数、删除；保存在浏览器 `localStorage`。

## 目录结构

```
tools/voxcpm-studio/
├─ app.py            # FastAPI 代理后端（转发 VoxCPM、托管音频与前端）
├─ requirements.txt
├─ start.cmd         # 一键启动入口（可双击）
├─ start.ps1         # 一键全栈：确保 VoxCPM 在线 + 起试音台 + 自动开浏览器
├─ run.ps1           # 仅启动试音台后端
├─ static/           # 前端工作台（纯原生，无 CDN 依赖，可离线）
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
└─ （运行时产物 .venv、outputs/、uploads/ 不在此目录，而在源码树外的 -RuntimeRoot，
    默认 F:\.mirrai-local\Mirrai\voxcpm-studio，不被 Google Drive 同步）
```

## 说明

- 试音台后端**不加载模型**，所有合成都由 `:8818` 的 VoxCPM 服务完成；若页面顶部显示「未连接」，请检查该服务是否已启动。
- 生成的音频与上传的参考音频落在 `-RuntimeRoot`（默认 `F:\.mirrai-local\Mirrai\voxcpm-studio`）下的 `outputs/`、`uploads/`，**不在 Google Drive 源码盘**，可定期清空。
- 遵循仓库 `AGENTS.md`：依赖与运行时数据一律放源码树之外，避免被 Google Drive 同步。
- **音色克隆来源**：5 个情绪音色读自 Mirrai 运行树 `.env`（`MIRRAI_ENV_PATH`，默认 `F:\Code\Mirrai\.env`）的 `VOXCPM_PROFILE_*` 配置，参考音频在 `F:\.mirrai-local\Mirrai\voice-profiles\wangpengze\`。改 `.env` 即同时影响试音台与 QQ 语音；`.env` 不可用时自动回退到通用控制音色（无克隆）。想临时用别人的音色，直接在「参考音频」处上传即可（优先级高于内置音色）。
