# Hermes Workspace — Documentation

> Long-form documentation for Hermes Workspace.
> Looking for the quick start? See [README.md](../README.md) at the repo root.

---

## 📑 Index

### Architecture & Design
- [Architecture](ARCHITECTURE.md) _(if present)_ — top-level system map (Tauri ↔ headroom ↔ OpenClaw ↔ Hermes)
- [API key registry](api-key-registry.md) — how secrets flow into the workspace
- [Claude ↔ OpenAI compatibility spec](claude-openai-compat-spec.md) — gateway adapter contract
- [Multi-gateway pool spec](multi-gateway-pool-spec.md) — gateway failover & load-balancing
- [Workspace chat session routing](workspace-chat-session-routing.md) — how a chat message gets routed
- [Conductor bug log](conductor-bug-log.md) — known conductor regressions
- [Dashboard service](dashboard-service.md) — the embedded dashboard shim
- [Tool artifacts context plan](tool-artifacts-context-plan.md) — how tool results are scoped

### Desktop (Tauri)
- [Desktop update system](desktop-update-system.md) — auto-updater, signing, channels
- [Windows setup guide](windows-setup-guide.md) — dev environment for Windows 11
- [Hermes Workspace naming contract](hermes-workspace-naming-contract.md) — bundle IDs, env names

### Swarm Mode (multi-agent control plane)
- [swarm/README.md](swarm/README.md) — entry point
- [swarm/QUICKSTART.md](swarm/QUICKSTART.md) — 5-minute local swarm
- [swarm/ARCHITECTURE.md](swarm/ARCHITECTURE.md) — orchestrator / worker / tmux topology
- [swarm/ROLES.md](swarm/ROLES.md) — builder / reviewer / docs / research / ops / triage / QA / lab
- [swarm/SKILLS.md](swarm/SKILLS.md) — what each lane can do
- [swarm/AUTORESEARCH.md](swarm/AUTORESEARCH.md) — autonomous experiment runner

### Swarm2 (next-gen)
- [swarm2-agent-ide-spec.md](swarm2-agent-ide-spec.md)
- [swarm2-autopilot-orchestration-spec.md](swarm2-autopilot-orchestration-spec.md)
- [swarm2-frankengpu-control-plane.md](swarm2-frankengpu-control-plane.md)
- [swarm2-memory-framework-spec.md](swarm2-memory-framework-spec.md)
- [swarm2-worker-lifecycle-compaction-spec.md](swarm2-worker-lifecycle-compaction-spec.md)

### Operations
- [Troubleshooting](troubleshooting.md) — first stop when something breaks
- [docker.md](docker.md) — Docker / Compose / GHCR pull
- [Agent pairing](AGENT-PAIRING.md) — pairing the workspace with an existing Hermes Agent install
- [Agent-authored UI state](agent-authored-ui-state.md) — when the agent drives the UI
- [i18n contributing](i18n-contributing.md) — translating the UI
- [Requirements catalog](requirements/) — product requirements behind each module
- [Release notes — 2.1.0](release-2.1.0.md) — historical

### Performance
- [Mobile perf report](mobile-perf-report.md)
- [Mobile perf baseline](mobile-perf-baseline-bundle.json)
- [Mobile perf after bundle](mobile-perf-after-bundle.json)

### HermesWorld (in-game / art)
- [hermesworld/README.md](hermesworld/README.md) — the in-world design bible
- [hermesworld/MASTER-PLAN.md](hermesworld/MASTER-PLAN.md)
- [hermesworld/VISION-BEST-AI-MMO.md](hermesworld/VISION-BEST-AI-MMO.md)
- [hermesworld/PUBLIC-ROADMAP.md](hermesworld/PUBLIC-ROADMAP.md)
- [hermesworld/guides/](hermesworld/guides/) — onboarding & gameplay loops
- [hermesworld/lore/](hermesworld/lore/) — world, factions, sigils, timeline
- [hermesworld/walkthroughs/](hermesworld/walkthroughs/) — first-quest narratives
- [hermesworld/reference-images/](hermesworld/reference-images/) — mood boards

### Playground
- [playground/README.md](playground/README.md) — visual experimentation surface

### Design & assets
- [design/](design/) — internal design specs
- [screenshots/](screenshots/) — official screenshots for the website & README
- [images/](images/) — badges & OG cards
- [pr-screenshots/](pr-screenshots/) — screenshots attached to past PRs

---

## ✍️ Adding new docs

1. Drop the file in the right sub-folder.
2. Add a one-line link here (alphabetical within section).
3. Mention it in the PR description so reviewers can sanity-check the placement.
4. Long-form specs (≥ 200 lines) should be split into multiple files under a themed
   folder, with a top-level `README.md` index — see `swarm/` and `hermesworld/`
   for examples.

If you are writing a spec for an unreleased feature, prefix the file with
`swarm2-` or put it under `requirements/` until it lands.
