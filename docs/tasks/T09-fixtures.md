---
status: task
last-updated: 2026-09-13
---

← [Task index](README.md) · [Status](../STATUS.md)

# T09 — Add the share-text fixtures

|            |     |
| ---------- | --- |
| Phase      | [§13 step 2](../planning/10-build-order-and-client.md#13-build-order) — parser |
| Depends on | [T04](T04-repo-skeleton.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§3 Input contract](../planning/02-input-contract.md#3-input-contract--strong-share-text) — the canonical fixture and the grammar it exercises
- [§12 Acceptance criteria](../planning/09-acceptance-criteria.md#12-acceptance-criteria) — the variants that need their own fixture

## Deliverable

- `tests/fixtures/*.txt` — the [§3](../planning/02-input-contract.md#3-input-contract--strong-share-text) fixture verbatim, plus one fixture per variant asserted in [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria)

## Steps

1. Save the [§3](../planning/02-input-contract.md#3-input-contract--strong-share-text) block byte-for-byte as the canonical fixture, preserving U+00D7 (`×`) — parsing rule 6 hinges on it.
2. Add fixtures covering each variant listed under "Parser — variants" in [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria): warmup, bare reps, assisted positive and negative, time, distance-with-time, unparsed payload, and an `x`-instead-of-`×` copy of the canonical fixture.
3. Add one fixture with no share link, so the `sha256:` branch of the [§6](../planning/04-persistence.md#6-persistence) `dedupe_key` derivation is reachable.
4. Add one fixture that is not a Strong workout at all, for the 400 path in [§11](../planning/08-error-handling.md#11-error-handling).

## Done when

```bash
node -e "const fs=require('node:fs'); const files=fs.readdirSync('tests/fixtures').filter(f=>f.endsWith('.txt')); console.log(files.length); if (!files.some(f=>fs.readFileSync('tests/fixtures/'+f,'utf8').includes('\u00d7'))) process.exit(1)"
```

Every variant bullet in [§12](../planning/09-acceptance-criteria.md#12-acceptance-criteria) has a backing fixture and at least one fixture contains a literal `×`.

## On completion

Flip `T09` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

