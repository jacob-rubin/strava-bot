---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T04 — Scaffold the TypeScript repository skeleton

|            |     |
| ---------- | --- |
| Phase      | [§13 step 1](../planning/10-build-order-and-client.md#13-build-order) — prove auth |
| Depends on | — |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§10 Repository layout](../planning/07-config-and-repo-layout.md#10-repository-layout) — the authoritative tree and dependency list
- [ADR 0008](../decisions/0008-typescript-node-runtime.md) — TypeScript and Node.js runtime decision
- [AGENTS.md](../../AGENTS.md)

## Deliverable

- `package.json` and `package-lock.json` — Node.js 24 LTS, the runtime and development dependencies named in [§10](../planning/07-config-and-repo-layout.md#10-repository-layout), and the documented npm scripts
- `tsconfig.json` — strict TypeScript configuration from [§10](../planning/07-config-and-repo-layout.md#10-repository-layout)
- `vitest.config.ts` — discovers `tests/test_*.ts`
- Source directories `app/`, `scripts/`, `tests/`, and `tests/fixtures/`, tracked with `.gitkeep` files until their task-owned contents land
- `.gitignore` covering `node_modules/`, `dist/`, Vitest coverage output, and any local credential file

## Steps

1. Write `package.json` with `engines.node` set to `24.x`, ESM enabled, exactly the runtime dependencies listed in [§10](../planning/07-config-and-repo-layout.md#10-repository-layout), no ORM, and the documented `build`, `typecheck`, `test`, `dev`, and `start` scripts. Add TypeScript, `tsx`, Vitest, and required type packages as dev dependencies.
2. Write the strict `tsconfig.json` and `vitest.config.ts` described by [§10](../planning/07-config-and-repo-layout.md#10-repository-layout).
3. Create the directory tree from [§10](../planning/07-config-and-repo-layout.md#10-repository-layout). Track otherwise-empty directories with `.gitkeep`; do not create placeholder TypeScript modules because individual modules belong to their own tasks.
4. Run `npm install` to generate and commit `package-lock.json`.
5. Do **not** add `app/` modules here — each has its own task, and [CONSTRAINTS.md](../CONSTRAINTS.md) must be read before any of them.

## Done when

```bash
node -e "const major=Number(process.versions.node.split('.')[0]); if (major !== 24) process.exit(1)"
npm run typecheck
npm test -- --passWithNoTests
```

All commands exit 0, Vitest reports no tests discovered, `package-lock.json` is committed, and the tree matches [§10](../planning/07-config-and-repo-layout.md#10-repository-layout).

## On completion

Flip `T04` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

