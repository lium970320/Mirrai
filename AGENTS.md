# Mirrai Agent Notes

## Google Drive Sync Policy

This repository is stored in a Google Drive sync folder. Treat this folder as the source-sync copy only.

- Do not install dependencies or run the dev server from this Google Drive directory.
- Do not recreate `node_modules/`, `dist/`, `uploads/`, `.vite/`, logs, local database files, or other generated artifacts in this directory.
- Use `scripts/sync-local-worktree.ps1` to mirror source files into the machine-local worktree.
- The default Windows local worktree is `F:/Code/Mirrai`.
- The default Windows local runtime data root is `F:/.mirrai-local/Mirrai`.
- Keep each computer's `.env` in its own local worktree, for example `F:/Code/Mirrai/.env`. Do not rely on Google Drive to sync `.env` between machines.

## Running The Project

- For the normal setup, run from `F:/Code/Mirrai` with `corepack pnpm run dev:local`, or start the full stack with `scripts/start-all.ps1 -UseLocalDb`.
- The primary database is the embedded local PostgreSQL (`127.0.0.1:5434/mirrai`, managed by `dev:local` / `db:local:prepare`). Neon quota is insufficient, so remote PostgreSQL is optional and not the default.
- Only use `corepack pnpm run dev` when `DATABASE_URL` points to a reachable remote database (for example a Neon migration check).
- The configured LLM provider is currently DeepSeek with dynamic Flash/Pro routing.

## Before Cleanup

When cleaning generated files on Windows, verify the resolved absolute path is inside the intended directory. Never delete source files, migrations, `package.json`, `pnpm-lock.yaml`, or an unbacked `.env`.

## Local File References

When referencing local files in Codex Desktop responses, use clickable Markdown links with absolute paths and forward slashes, such as `[package.json](<F:/Code/Mirrai/package.json>)`.

Rules:
- Do not use native inline references such as `@F:/Code/Mirrai/package.json` for local files.
- Use absolute local paths only.
- Use forward slashes `/`.
- Keep real spaces as spaces.
- Do not encode spaces as `%20`.
- Do not prepend `/` before the drive letter.
- Do not use `file://`.
- If the path contains spaces, wrap the Markdown link target in angle brackets, for example `[draft-first-act-v04-comic-pages.html](<F:/Google Drive/LM/Codex_Project_Hub/03_Code/Mirrai/live-action-comic/production/chapter-01/test-page-01-xibei-first-sighting/draft-first-act-v04-comic-pages.html>)`.

## Subagent Rules (子代理规则)

- Unless the user explicitly requests "create subagent" or "use subagent", you must not create any subagents, parallel agents, extra workers, or similar delegated execution units.
- Work should be done directly by the current agent.
- If it is truly necessary to use a subagent, you must obtain explicit user approval first.
（除非用户明确要求“创建子代理”或“使用子代理”，否则不得擅自创建任何子代理、并行代理、额外 worker。默认由当前代理直接完成任务，确有必要时必须先得到用户明确许可。）

## Login Website Automation Rules (登录网站自动化规则)

- When handling websites that require login, do not directly operate on the user's active foreground browser window.
- Prefer reusing the user's logged-in Chrome session by creating a separate copy of the profile under `F:/LM_Runtime/.../browser-profiles/` for automated access.
- Automation processes should avoid affecting the user's active browsing state.
- Unless explicitly requested by the user, perform read-only extraction and avoid submission, messaging, deletion, batch writing, modifying account states, or other side-effect operations.
- Never display, export, or print sensitive information such as cookies, tokens, or sessions in plain text.
（处理需要登录的网站时，默认不要操作前台浏览器窗口。优先在 `F:/LM_Runtime/.../browser-profiles/` 中创建独立副本 profile，尽量不影响用户状态。默认只做只读提取，不要展示/导出敏感登录态。）

## PowerShell / Terminal Chinese Text Safety (PowerShell/终端中文文本处理规则)

In Windows environments, when a task involves reading, printing, searching, replacing, joining, filtering, exporting, or writing back Chinese text in PowerShell, terminals, or command-line tools, you must default to Chinese Safe Mode:
1. Prefer using Python and explicitly specify `encoding="utf-8"` when reading and processing Chinese text.
2. If PowerShell must be used to display Chinese, switch the input/output encoding of the console to UTF-8 first before executing further commands.
3. Avoid directly viewing Chinese text using tools/commands that rely on the terminal's default encoding.
4. Always specify UTF-8 encoding when writing files back to disk.
5. If gibberish/encoding errors (乱码) only appear in the terminal or PowerShell output, treat it as a display channel issue rather than file corruption.
（涉及 PowerShell / 终端中处理中文文本时，优先改用 Python 并使用 `encoding="utf-8"`；或先在 PowerShell 中切换编码为 UTF-8。写回文件显式保持 UTF-8；注意区分终端显示乱码与文件损坏。）

## Image Ban (图片禁令)

- Do not embed images in responses unless the user explicitly asks to see or generate an image.
- Do not output Markdown image tags such as `![alt](...)` by default.
- Do not include screenshots, rendered PDF page images, local image previews, or other visual attachments unless the user explicitly asks for them.
（不要在回复中添加图片渲染（如 `![alt](...)`），除非用户明确要求看图或生成图片。）

## Default Execution Style (默认执行风格)

- Prioritize robust, roll-backable, and low-side-effect execution paths.
- Maintain a conservative strategy regarding user data, login states, Chinese text, and original file content.
- Do not expand the scope of modifications unless explicitly requested by the user.
（优先采用稳健、可回退、低副作用的操作路径；对用户数据、登录态、中文文本、原始文件内容保持保守策略；不要擅自扩大修改范围。）

## Language Rule (语言规则)

- All replies, answers, and conversations must be written in Chinese only. Do not use English under any circumstances. This applies to all threads, processes, and subagents.
（所有回复、解答和对话必须完全使用中文回答，绝对不要使用英文。该规则对所有线程和子代理均有效。）

