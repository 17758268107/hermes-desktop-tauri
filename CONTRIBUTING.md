# Contributing to Hermes Workspace

Thanks for your interest in contributing! Here's how to get started.

## Quick Start

1. Fork the repo and clone your fork
2. Install dependencies: `pnpm install`
3. Set up environment:
   ```bash
   cp .env.example .env
   # Edit .env — set HERMES_API_URL (default: http://127.0.0.1:8642)
   ```
4. Start [Hermes Agent](https://github.com/NousResearch/hermes-agent) API server
5. Run dev server: `pnpm dev`
6. Make your changes on a feature branch
7. Open a PR against `main`

## Development

```bash
# Install dependencies
pnpm install

# Dev server (default: localhost:3000)
pnpm dev

# Type check
pnpm typecheck

# Lint
pnpm lint

# Format check
pnpm format:check

# Auto-format
pnpm format

# All checks at once
pnpm check

# Build for production
pnpm build

# Tauri desktop dev
pnpm tauri:dev

# Tauri desktop build (Windows)
pnpm tauri:build:win
```

## Branching Strategy

- **`main`** — stable, always deployable. All PRs target this branch.
- **`feature/*`** — new features (`feature/copilotkit-panel`)
- **`fix/*`** — bug fixes (`fix/health-endpoint`)
- **`docs/*`** — documentation-only changes
- **`chore/*`** — tooling, CI, dependency updates

Keep branches short-lived. Rebase on `main` before opening a PR.

## Commit Convention

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

feat(copilot): add CopilotPanel toggle button
fix(docker): resolve health check timeout
docs(readme): update download links
chore(ci): switch from bun to pnpm
```

**Types:** `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `ci`, `perf`

## Testing

```bash
# Run unit tests
pnpm test

# Type check (required before PR)
pnpm typecheck

# Lint (required before PR)
pnpm lint

# Full CI check (lint + typecheck + build)
pnpm check
```

All checks must pass before a PR can be merged. CI runs on every push.

## Environment Variables

See `.env.example` for all options. Key ones:

- `HERMES_API_URL` — Hermes Agent gateway backend (default: `http://127.0.0.1:8642`)
- `CLAUDE_PASSWORD` — Optional password protection for the web UI
- `CLAUDE_ALLOWED_HOSTS` — Comma-separated hostnames for non-localhost access

## Guidelines

- **One PR per feature/fix** — keep them focused and reviewable
- **Test your changes** — run `pnpm check` before opening a PR
- **Describe what you changed** — clear PR title + description, link related issues
- **No secrets** — never commit API keys, tokens, or passwords
- **Follow existing patterns** — match the code style you see
- **Keep it backwards compatible** — if you need a breaking change, discuss it in an issue first

## Code Review

- All PRs require at least one approval
- CI must pass (lint, typecheck, build)
- Squash-merge to keep `main` history clean
- Reviewers: check for security implications, test coverage, and documentation updates

## Release Process

1. Update version in `package.json`, `tauri.conf.json`, `Cargo.toml`
2. Update `CHANGELOG.md` with the new version's entries
3. Commit: `chore: release vX.Y.Z`
4. Tag: `git tag vX.Y.Z`
5. Push tag: `git push origin vX.Y.Z`
6. CI automatically builds Tauri installers + Docker images and creates the GitHub Release

## Questions?

Open a [Discussion](https://github.com/17758268107/hermes-desktop-tauri/discussions) or check existing [Issues](https://github.com/17758268107/hermes-desktop-tauri/issues).
