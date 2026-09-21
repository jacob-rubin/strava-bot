---
status: authoritative
last-updated: 2026-09-21
---

← [Decisions](README.md) · [Docs index](../README.md)

# 0014 — Curate the Strong-to-Strava exercise map by hand

**Context.** The structured upload requires an `exercise_type` per set, drawn from the enum Strava's [uploads documentation](https://developers.strava.com/docs/uploads/) lists. The first implementation synthesized one by upper-snake-casing the Strong name, so `Hack Squat` became `HACK_SQUAT` — not a value Strava defines. The fallback position at the time was to send null categories rather than guess, which left every set effectively untyped.

A name-to-enum rule does not exist. Strong's `Hack Squat` is Strava's `MACHINE_HACK_SQUAT`; `Chin Up` has no `CHIN_UP` at all; `Bent Over Row (Cable)` has no cable variant and has to degrade to `ROW_GENERIC`. Roughly a quarter of the owner's 118 logged exercises needed a judgement call that no transformation could make.

**Decision.** Keep the mapping as authored data: a static `app/exercises/exercise_type_map.json`, curated once against the owner's full Strong export, with every ambiguous entry decided by the owner rather than inferred. Resolution is a pure lookup on the base name and the equipment parenthetical; nothing is derived from a name at runtime. A name the map does not cover resolves to `TOTAL_BODY_GENERIC` and is logged, so the upload still succeeds and the gap is visible.

A test asserts every value in the map against `tests/fixtures/strava_exercise_types.json`, the enum transcribed from the documentation. Strava silently generalizes an unrecognized value, so a typo would otherwise never surface.

**Consequences.** Adding an exercise in Strong means adding a line to the map — noticed from the log line, not from a failure. The map is worth diffing against a fresh Strong export occasionally. Curation is deliberately not automatable: the judgement calls are the value.

→ [The exercise-type map](../reference/strava.md#the-exercise-type-map)
