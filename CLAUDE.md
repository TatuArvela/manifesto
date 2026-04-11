# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Manifesto is a free, open-source note-taking app with a sticky note interface (think Google Keep). It's MIT licensed and currently in the **specification phase** — no code has been written yet. The full spec lives in `docs/specification/`.

## Architecture

Two separate applications sharing a contract defined by the data model and REST/WebSocket API:

- **Client**: Preact + TypeScript SPA, built with Vite. Uses @preact/signals for state, Tailwind CSS for styling, Vitest for tests. Targets ~minimal bundle size (Preact over React).
- **Server**: Node.js + TypeScript, Express or Hono, better-sqlite3. Optional — the client works standalone with localStorage.

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
