# Changelog

## 0.1.0 (2026-08-30)


### Features

* **server:** gate /register on REGISTRATION_ENABLED flag ([b227b63](https://github.com/TatuArvela/manifesto/commit/b227b633d7296db746781f76067298bea4595ebd))
* **server:** per-user rate limit on /api/notes and /api/search ([d9777b9](https://github.com/TatuArvela/manifesto/commit/d9777b9a0b5d3e638e4f5e2bcf72be33066bd4e5))
* **server:** tighten note schema with size + URL constraints ([86e47d3](https://github.com/TatuArvela/manifesto/commit/86e47d3dc0c923cb187cd99711a971a1bdad243e))


### Bug Fixes

* **client:** guard localStorage writes against QuotaExceededError ([2f63d34](https://github.com/TatuArvela/manifesto/commit/2f63d345edb8b1d325c46f968119671f24abe200))
* **client:** NoteCardEditor compares against last-saved content ([ffe962f](https://github.com/TatuArvela/manifesto/commit/ffe962fb1d6081ba9eb1d8683ac29c52b1cd1034))
* **client:** refetch notes on WebSocket reconnect ([842e486](https://github.com/TatuArvela/manifesto/commit/842e48694238b1c1cc2b7c75680e13cc11a72c69))
* **client:** resolve a11y + optional-chain lint warnings ([130dd7c](https://github.com/TatuArvela/manifesto/commit/130dd7ceee4be0c3c23e39d27f0568812f4a3565))
* **client:** RestApiAdapter resilience for deleteAll + importAll ([eebb1b5](https://github.com/TatuArvela/manifesto/commit/eebb1b5c796317599b4f12bda0195e113ecca33f))
* **server:** detect username collisions by error code, not message regex ([e55dfa5](https://github.com/TatuArvela/manifesto/commit/e55dfa5622a88a6dcf992c272ecb643db32d9c2a))

## Changelog

All notable changes to Manifesto are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Releases below `1.0.0` are pre-stable: minor bumps may include breaking changes.

This file is maintained automatically by [release-please](https://github.com/googleapis/release-please)
based on [Conventional Commits](https://www.conventionalcommits.org/) — do not edit by hand.
