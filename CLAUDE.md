# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Manifesto is a free, open-source note-taking app with a sticky note interface (think Google Keep). It's MIT licensed. The full spec lives in `docs/specification/`.

## Commands

```bash
pnpm install          # Install all dependencies
pnpm dev              # Run client and server dev servers in parallel
pnpm build            # Build all packages
pnpm lint             # Check linting and formatting (Biome)
pnpm lint:fix         # Auto-fix lint/format issues
pnpm typecheck        # TypeScript check all packages
pnpm test             # Run all tests (Vitest)
```

Run for a single package with `pnpm --filter @manifesto/<client|server|shared> <script>`.

## Architecture

pnpm monorepo with three packages:

- **`packages/shared`** — TypeScript types and enums (`Note`, `NoteColor`, `LockLevel`, API types). Imported by both client and server. No runtime dependencies — types only.
- **`packages/client`** — Preact + TypeScript SPA, built with Vite. Uses @preact/signals for state, Tailwind CSS for styling, Vitest for tests.
- **`packages/server`** — Node.js + TypeScript, Hono, better-sqlite3. Optional — the client works standalone with localStorage.

### Key Design Decisions

- **Local-first**: Client works fully offline using localStorage (open mode). Server connection is opt-in.
- **Managed mode**: Organizations can deploy as server-only (no local storage, auth required).
- **Storage adapters**: Client abstracts data access behind `StorageAdapter` interface — `LocalStorageAdapter` (default) or `RestApiAdapter` (server-connected).
- **ULIDs** for note IDs (not UUIDs) — lexicographically sortable, timestamp-prefixed.
- **NoteColor** uses named enums (not hex) so themes can map colors differently for light/dark mode.
- **LockLevel** enum: `unlocked | content-locked | fully-locked`. Content-locked notes still allow checklist toggling.

### API Contract

- REST: `/api/notes`, `/api/search`, `/api/auth/*`
- WebSocket: `ws(s)://server/api/ws` for real-time collaborative editing
- All timestamps are ISO 8601 UTC strings
- Note schema has 13 fields — see `docs/specification/data-model.md`

## Code Style

- Biome for linting and formatting (not ESLint/Prettier)
- TypeScript strict mode in all packages
- `type: "module"` (ESM) throughout
