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

- For the normal setup, run from `F:/Code/Mirrai` with `corepack pnpm run dev`.
- The normal setup uses Neon PostgreSQL plus the configured LLM provider, currently DeepSeek.
- Only use `corepack pnpm run dev:local` when explicitly testing the embedded local PostgreSQL fallback.

## Before Cleanup

When cleaning generated files on Windows, verify the resolved absolute path is inside the intended directory. Never delete source files, migrations, `package.json`, `pnpm-lock.yaml`, or an unbacked `.env`.

## Local File References

When referencing local files in Codex Desktop responses, use native inline file references with absolute paths and forward slashes, such as `@F:/Code/Mirrai/package.json`. Do not use Markdown links for non-image local files.
