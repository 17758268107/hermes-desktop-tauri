# Changelog

All notable changes to Hermes Workspace are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Changed
- **`docker compose up` now pulls pre-built images by default** (#82) — `nousresearch/hermes-agent:latest` for the gateway and `ghcr.io/17758268107/hermes-desktop-tauri:latest` for the UI. Agent state persists in the `claude-data` named volume. Adds `docker-compose.dev.yml` overlay for building from source.

## [2.5.0] — 2026-06-12

**CopilotKit frontend integration + CI/CD hardening release.**

### Added
- **CopilotKit frontend fully wired** — `CopilotProvider` wraps the workspace shell, `CopilotPanel` (420px sliding AI assistant) and `CopilotPanelToggle` (✨ floating button) are now rendered on all non-chat routes
- **Zustand copilot state** — `copilotPanelOpen`, `toggleCopilotPanel`, `setCopilotPanelOpen` added to workspace store with localStorage persistence
- **CopilotKit CSS** — `@copilotkit/react-core/v2/styles.css` loaded via `<link>` in the root layout
- **8 Hermes backend tools** registered via `useHermesTools()`: `getServiceStatus`, `listDirectory`, `readFile`, `sendTerminalCommand`, `restartService` (HITL), `getModelList`, `createFile`, `deleteFile` (HITL)
- **CopilotKit dependencies** — `@copilotkit/runtime@^1.59.0`, `@ai-sdk/openai@^1.2.0` added to package.json

### Changed
- **Version bump** — package.json, tauri.conf.json, Cargo.toml → 2.5.0
- **CI workflow** — added `timeout-minutes: 15` and `CI=true` env to prevent prerendering timeout
- **Dockerfile** — added `ENV CI=true` to skip prerendering; copies `.npmrc` and `pnpm-workspace.yaml`
- **Vite config** — prerendering disabled when `CI` env is set; removed `build.rollupOptions.external` (CopilotKit now bundled as dependency)
- **`.npmrc`** — added `onlyBuiltDependencies` for pnpm v11 compatibility (`electron`, `esbuild`, `unrs-resolver`, `@scarf/scarf`)

### Fixed
- **CI build 6-hour timeout** — prerendering tried to connect to gateway (127.0.0.1:8642) in CI/Docker; now skipped when `CI=true`
- **Docker build 6-hour timeout** — same prerender issue; fixed with `ENV CI=true`
- **`@copilotkit/runtime` missing from dependencies** — was imported in source but never declared in package.json
- **`@copilotkit/react-core` missing from dependencies** — added as direct dependency so CI can resolve `@copilotkit/react-core/v2` imports
- **CopilotKit CSS import fails in CI** — `@copilotkit/react-core/v2/styles.css?url` couldn't be resolved by Rollup; copied locally to `src/styles/copilotkit.css`
- **`time` crate 0.3.48 breaking change** — pinned to 0.3.47 via `Cargo.lock` (now tracked in git); 0.3.48 was published same day with incompatible API changes
- **Docker health check always failing** — root path `/` returned 500 due to SSR errors; added `/health` endpoint and updated `Dockerfile` HEALTHCHECK + CI smoke test
- **`@scarf/scarf` build script blocked** — approved via `onlyBuiltDependencies` in `.npmrc`
- **Tauri release workflow** — switched from bun to pnpm, reordered pnpm setup before Node.js, simplified to Windows-only matrix

## [2.4.1] — 2026-06-11

**Auto-update support + repo governance + documentation polish release.**

### Added
- **Auto-update support** — Tauri updater artifacts enabled with new signing key; desktop app can now check for and install updates automatically
- **4 Issue templates** — bug report, feature request, question, security (YAML structured forms)
- **PR template** — full review checklist with summary, linked issues, type/scope, test plan, risk & rollout, release notes
- **Dependabot** — weekly auto-updates for npm (4 groups: tauri / react / ai / tooling), cargo, github-actions, docker
- **`docs/README.md`** — top-level documentation index (Architecture / Desktop / Swarm / Operations / Performance / HermesWorld / Playground / Design)
- **`.editorconfig`** — cross-platform editor configuration for consistent formatting

### Changed
- **`CHANGELOG.md`** — backfilled v2.4.0 entry (CopilotKit v2 + Tauri NSIS installer)
- **`CODEOWNERS`** — replaced stale `@outsourc-e` references with `@17758268107` (sole repo collaborator)
- **Version bump** — package.json, tauri.conf.json, Cargo.toml → 2.4.1
- **README.md** — updated version badge to 2.4.1; updated "Native Desktop App" section to reflect Tauri status with download links
- **CI workflow** — fixed `--no-frozen-lockfile` to `--frozen-lockfile`; cleaned up lint/typecheck fallbacks
- **package.json scripts** — added `typecheck`, `format:check`; fixed `format` script to include `--write .`
- **Vite config** — added `build.rollupOptions.external` for CopilotKit SSR build resolution

### Fixed
- **SSR build error** — `@copilotkit/runtime/v2` import resolution in Vite 7.x production builds

### Migration
None. Documentation and CI config only. No breaking changes, no new dependencies.

## [2.4.0] — 2026-06-11

**CopilotKit v2 Phase 2 — Tauri-native AI agent + GitHub Release pipeline.**

### Added
- **CopilotKit v2 embedded AI agent** — floating ✨ button on every screen, 420px sliding chat panel powered by `@copilotkit/react-core` v1.59 (v2 protocol)
- **Human-in-the-Loop interrupts** — sensitive tool calls trigger a confirmation modal via `useInterrupt`
- **Threads + cross-session memory** — `useThreads()` with `localStorage` persistence (`hermes.copilotkit.threads`)
- **8 Frontend Tools** registered with the agent: `list_jobs`, `run_skill`, `search_memory`, `add_memory`, `mcp_call`, `gateway_health`, `get_settings`, `update_settings`
- **NSIS Tauri installer** — GitHub Release `v2.4.0` ships `Hermes Workspace_2.4.0_x64-setup.exe` (39.5 MB, Windows x64, currentUser mode)
- **`GET /api/copilotkit-status`** — runtime endpoint exposing LLM config and reachability of headroom proxy
- **CI/CD hardening** — Tauri release workflow triggered on `v*.*.*` tags; Docker smoke-test job on push to `main`; CodeQL security audit

### Changed
- **API base URL** — CopilotKit now uses `provider.chat()` to force Chat Completions (`/v1/chat/completions`) via the local **headroom proxy** (`127.0.0.1:8787`) instead of pointing directly at `tokendance.space`
- **Vite SSR body stream handling** — fixes `POST 400` errors on CopilotKit chat submissions
- **Single-route CopilotKit endpoint** — `copilotkit.ts` consolidates the runtime onto `/api/copilotkit`
- **Cargo build jobs** limited to 2 + debuginfo stripped to fit 7 GB GitHub runner budget
- **rust-cache** hardened with cache-on-failure + shared-key per target
- **Bun cache** removed for `aarch64-apple-darwin`; Windows signing key import forced into bash shell

### Fixed
- **API 405 Method Not Allowed** on CopilotKit transport by routing through `provider.chat()`
- **BASE_URL redirection** — `.env` now points at headroom proxy `http://127.0.0.1:8787/v1`
- **Tauri NSIS build** — bash shell forced on Windows runner so `signtool` import works

### Security
- **CodeQL weekly scan** added (`.github/workflows/security.yml`)
- **No new outbound dependencies** beyond `@copilotkit/*` v1.59

### Migration
- No breaking API changes. Users on v2.3.0 can upgrade in place; the headroom proxy requirement is the only new local assumption (already shipped with the desktop app).
- `.env` consumers: update `OPENAI_BASE_URL=http://127.0.0.1:8787/v1` and `COPILOTKIT_MODEL=deepseek-v4-flash`.

## [2.3.0] — 2026-05-28

**Stability + token-cost dashboard release.** Sessions intelligence, cost ledger, cache efficiency, and the new agent-hub.

## [2.2.0] — 2026-05-15

**Operations + Conductor release.** Agent registry, sessions manager, and mission-control surface.

### Added
- **Operations** (`/operations`) — agent registry / sessions manager; pause, steer, kill live agents
- **Conductor** (`/conductor`) — mission-control surface; spawn missions, assign workers, watch live output

## [2.1.0] — 2026-05-01

**Skills + MCP release.** Skills management, MCP integration, and enhanced chat experience.

### Added
- **Skills management** — browse, install, and configure agent skills
- **MCP integration** — Model Context Protocol support for external tool connections
- **Enhanced chat** — improved streaming, tool-call rendering, and session persistence

## [2.0.0] — 2026-04-20

**Zero-fork release.** Clone, don't fork. Hermes Workspace now runs on vanilla `pip install hermes-agent` with no patches, no drift, no custom gateway required.

### Added
- **Zero-fork architecture** — dual gateway/dashboard routing; workspace talks directly to vanilla `hermes-agent` 0.10.0+ via standard endpoints (`/v1/models`, `/api/sessions`, `/api/skills`, `/api/config`, `/api/jobs`)
- **One-liner curl installer** — `curl -fsSL … | bash` provisions workspace + gateway + defaults
- **Claude-Nous theme** — dark + light editorial variants with cobalt/paper surface pass, thin 1px architectural borders, editorial type accents
- **Conductor** (`/conductor`) — mission-control surface ported from Clawsuite; spawn missions, assign workers, watch live output and costs
- **Operations** (`/operations`) — agent registry / sessions manager ported from Clawsuite; pause, steer, kill live agents with role and model insight
- **Synthesized tool pills** — inline tool-call rendering from dashboard stream markers when running against zero-fork gateway
- **Landing parity pass** — hero, features, screenshots, setup, OG image, mobile theme toggle
- **Task board status vs. assignee** decoupling
- **Local-model chat session persistence** — local sessions appear in history + session list
- **Memory is local-fs first** — honors `HERMES_HOME`, no gateway dependency
- **Splash + screenshots refresh** — Conductor, Dashboard, Tasks, Jobs captured in new editorial theme

### Changed
- **Model picker** — fetches from gateway (`~/.hermes/models.json` for user-configured models), matches OCPlatform behavior; shows only configured providers instead of all upstream
- **`enhanced-fork` mode label** no longer implies a fork is required; it indicates streaming route availability on vanilla gateway
- **Dashboard + enhanced-chat capabilities** marked optional; missing endpoints no longer trigger warnings
- **Feature-gate + install copy** — all fork-era references purged
- **Theme family allowlist** — `claude-nous` promoted to the enterprise allowlist
- **Session pill** — solid dark-mode background, matches model selector

### Fixed
- Duplicate responses and disappearing history on interrupt (#62)
- Portable-mode double user message, uncleaned timeouts, orphaned unregister callbacks
- Local model selection actually propagates to chat (no silent fallback)
- Strip provider prefix correctly for local routing
- Dashboard token injection on `/` (not `/index.html`)
- Onboarding no longer stacks behind workspace shell
- Root bootstrap guards against uncaught errors
- Preserve assistant text during tool-call streaming
- Installer output uses defined escape vars (removed undefined BOLD/RESET)

### Removed
- All references to the legacy "enhanced fork" as a requirement
- Stale fork-era gateway instructions and feature-gate copy

---

## [1.0.0] — 2026-04-10

Initial public release. Chat, files, memory, skills, terminal, dashboard, settings — the foundational workspace.
