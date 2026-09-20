---
status: authoritative
last-updated: 2026-09-14
---

← [Decisions](README.md) · [Docs index](../README.md)

# 0008 — TypeScript on Node.js 24 LTS

**Context.** The original implementation spec selected Python 3.12, FastAPI, pytest, and Python scripts. The implementation has not begun, so changing the runtime now does not require a code migration. The project benefits from one statically checked language across the HTTP service, domain model, local scripts, and tests.

**Decision.** Implement `app/`, `scripts/`, and `tests/` in strict TypeScript targeting Node.js 24 LTS, the current LTS line when this decision was made ([Node.js release schedule](https://nodejs.org/en/about/previous-releases)). Use Fastify for HTTP routing, the official `@google-cloud/firestore` and `@google-cloud/secret-manager` clients, Luxon for timezone-aware wall-clock conversion, Node's built-in `fetch` for outbound HTTP, Vitest for tests, and `tsx` for local scripts. Compile with `tsc`; Google's [Node.js buildpack](https://docs.cloud.google.com/docs/buildpacks/nodejs) runs the declared `build` script and then the npm `start` command. Commit `package-lock.json` and do not add Python project files or tooling.

Persisted Firestore field names and external API field names remain snake_case where the existing contracts specify them. TypeScript function names use idiomatic camelCase unless an external API controls the name.

**Consequences.** Type errors and nullability issues are caught before deployment, and service code and operational scripts share one toolchain. The project now carries a compile step and TypeScript development dependencies.

→ [Repository layout](../reference/configuration.md#repository-layout)
