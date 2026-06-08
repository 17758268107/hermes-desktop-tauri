# Hermes Workspace Agent Contract

This workspace uses semantic Hermes swarm workers, not numbered-only lanes. The source of truth for routing is `swarm.yaml`; each worker also has a matching profile under `~/.hermes/profiles/<worker-id>/`, a role skill `<worker-id>-core`, and a wrapper in `~/.local/bin/`.

## Current semantic roster

| Worker | Wrapper | Tools | Skills | MCP | Plugins |
|---|---|---|---|---|---|
| `orchestrator` | `orchestrator:plan` | todo, kanban, delegation, terminal, file, gbrain, session_search, cronjob, skills, clarify, web | orchestrator-core, gstack-for-hermes, gbrain, kanban-orchestrator, subagent-driven-development, writing-plans, requesting-code-review, workspace-dispatch | gbrain | none |
| `km-agent` | `km:health` | gbrain, file, terminal, session_search, skills, todo, cronjob, web | km-agent-core, gbrain, obsidian-markdown, obsidian-cli, obsidian-bases, json-canvas, gstack-for-hermes | gbrain | none |
| `builder` | `builder:task` | terminal, file, browser, web, gbrain, session_search, skills, todo | builder-core, gstack-for-hermes, test-driven-development, systematic-debugging, github-pr-workflow, requesting-code-review, codebase-inspection | gbrain | none |
| `reviewer` | `reviewer:gate` | terminal, file, web, gbrain, session_search, skills | reviewer-core, requesting-code-review, github-code-review, systematic-debugging, gstack-for-hermes, gbrain, codebase-inspection | gbrain | none |
| `qa` | `qa:smoke` | browser, terminal, file, vision, gbrain, session_search, skills, web | qa-core, browser-harness-power-use, dogfood, gstack-for-hermes | gbrain | none |
| `researcher` | `researcher:quick` | gbrain, web, browser, terminal, file, vision, session_search, skills, todo | researcher-core, gbrain, autoresearch, browser-harness-power-use, gstack-for-hermes, researcher-quick, researcher-autoresearch, arxiv, youtube-content, polymarket | gbrain | none |
| `ops-watch` | `ops:health` | terminal, cronjob, file, gbrain, skills, session_search, web | ops-watch-core, gbrain, hermes-agent, systematic-debugging, webhook-subscriptions | gbrain | none |
| `maintainer` | `maintainer:check` | terminal, file, web, browser, gbrain, session_search, skills | maintainer-core, github-repo-management, github-pr-workflow, github-issues, github-code-review, gbrain, gstack-for-hermes, hermes-agent | gbrain | none |
| `strategist` | `strategist:review` | gbrain, web, session_search, file, skills, todo, clarify | strategist-core, gstack-for-hermes, gbrain, writing-plans, polymarket | gbrain | none |
| `inbox-triage` | `inbox:triage` | gbrain, web, file, session_search, todo, skills, terminal | inbox-triage-core, gbrain, obsidian-markdown, gstack-for-hermes, defuddle, youtube-content | gbrain | none |

## Operating rules

- Keep `swarm.yaml`, profile `config.yaml`, profile core skills, and wrappers aligned when changing a worker.
- Prefer GBrain-first lookup for context-sensitive RAZSOC/Hermes/workflow decisions.
- Builder implements; Reviewer gates; QA verifies behavior; Orchestrator routes and enforces greenlight.
- Do not enable optional Hermes plugins globally unless the task explicitly needs them; record plugin/toolset alignment in `swarm.yaml` first.
- For local Workspace pairing/debugging, treat **one gateway + one dashboard** as canonical: `hermes gateway run` on `:8642` and `hermes dashboard` on `:9119`. Before starting another gateway, verify `curl http://127.0.0.1:3000/api/sessions` (or the active workspace port) first. If Sessions already returns data, refresh/reprobe the UI instead of spawning a duplicate gateway.
- If the default model is `gpt-5.4` / `openai-codex`, remember that chat depends on a live local Codex CLI login (`codex login`).

## Windows-specific notes (2026-06-01)

- **Three services required**: Gateway (:8642) + Dashboard (:9119) + Workspace (:3000). All must be running for full functionality.
  - Gateway: `hermes gateway run`
  - Dashboard: `hermes dashboard --port 9119 --host 127.0.0.1 --no-open`
  - Workspace: `bun run dev` (or `pnpm dev`)
  - Or use the Tauri desktop app: `pnpm tauri:dev` (auto-starts the Vite dev server inside the webview; gateway/dashboard are managed by the in-app bootstrap wizard)
- **Desktop app**: Tauri 2 + Rust shell (`src-tauri/`). The webview loads the Vite-built client at `http://127.0.0.1:3000` in dev or `tauri://` in production. The Rust side is responsible for single-instance lock, settings persistence, Hermes Agent install + gateway/dashboard lifecycle, and the `gateway_request` HTTP proxy.
- **Build (Windows)**: `pnpm tauri:build:win` produces an NSIS installer in `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`. CI does this automatically on tag push via `.github/workflows/tauri-release.yml`.
- **Dev mode**: `pnpm tauri:dev` runs the Rust binary, which spawns `bun run dev` (`beforeDevCommand`) and points the webview at `http://127.0.0.1:3000`. Hot-reload works through Vite.
- **Running build output**: `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/Hermes Workspace_2.4.0_x64-setup.exe` (NSIS installer) and `…/hermes-workspace.exe` (unpacked binary).
- **Console suppression**: `main.rs` uses `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` and `lib.rs` spawns every subprocess with `CREATE_NO_WINDOW` so no console window pops up during install/start.
- **Windows spawn fixes** (in `src-tauri/src/lib.rs`): `spawn_logged()` uses `cmd /c` on Windows (not `bash -lc`), log paths use `%TEMP%` (not `/tmp`), `is_hermes_installed()` uses `where hermes`, `install_hermes()` uses `pip install hermes-agent` (not `curl|bash`).
- **Two `.env` files**: Gateway reads `C:\\Users\\<you>\\AppData\\Local\\hermes\\.env`; CLI reads `C:\\Users\\<you>\\.hermes\\.env`; workspace reads `hermes-workspace\\.env`. Keep API keys in sync across all three.
- **Gateway API server**: Requires `API_SERVER_ENABLED=true` + `API_SERVER_KEY` in the gateway's `.env`. Without these, the gateway starts with no connected platforms.
- **Workspace env vars**: Runtime reads `CLAUDE_API_URL` / `CLAUDE_API_TOKEN` / `CLAUDE_DASHBOARD_URL` (not `HERMES_*` variants).
- **sqlite3 CLI**: Not bundled on Windows. Install via `winget install SQLite.SQLite`, then copy `sqlite3.exe` to a Git Bash PATH directory (winget installs to a long path not in PATH).
- **claude CLI**: Required for Claude Tasks / Conductor features. Install via `npm install -g @anthropic-ai/claude-code`.
- **Port conflicts**: Use `netstat -ano | findstr :<port>` + `Stop-Process -Id <PID> -Force` (PowerShell) — `lsof` not available in Git Bash on Windows.
- **PWA install**: Dashboard at `http://127.0.0.1:3000` can be installed as PWA via Chrome/Edge address bar install icon. Prefer the Tauri build for production.
- **Slack invalid_auth**: Expected if Slack tokens aren't configured — ignore, doesn't affect core functionality.
- **Node version**: Requires Node.js 22+. Check with `node --version`.
- **Bun version**: `1.3.14` (matches CI). Install with `npm install -g bun` or follow https://bun.sh.
- **Rust toolchain**: Tauri 2 requires stable Rust + MSVC build tools. Install via `winget install Rustlang.Rustup` then `rustup default stable-x86_64-pc-windows-msvc`. The `cargo tauri` CLI is `cargo-tauri 2.11.x` (already pinned in `src-tauri/Cargo.lock`).
- **Tauri signing key**: `src-tauri/keys/hws.key.pub` is committed (the public half — needed for the webview to verify update signatures). The private half lives only in CI as `TAURI_SIGNING_PRIVATE_KEY` and must NEVER be committed locally.
