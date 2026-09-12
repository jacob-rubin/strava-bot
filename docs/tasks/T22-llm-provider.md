---
status: task
last-updated: 2026-09-11
---

← [Task index](README.md) · [Status](../STATUS.md)

# T22 — Replace the template with the real LLM path

|            |     |
| ---------- | --- |
| Phase      | [§13 step 5](../planning/10-build-order-and-client.md#13-build-order) — LLM generation |
| Depends on | [T14](T14-llm-fallback-template.md), [T19](T19-cloud-run-deploy.md) |
| Executor   | agent |
| Blocked by | — |

## Read first

- [§8 Title and description generation](../planning/06-llm-generation.md#8-title-and-description-generation) — inputs, output constraints, and the mandatory fallback
- [§7.5 Policy constraint](../planning/05-strava-integration.md#75-policy-constraint--non-negotiable)
- [Constraints 1, 9, 10](../CONSTRAINTS.md)

## Deliverable

- `app/llm.py` — provider call behind the unchanged `generate()` signature, with the [T14](T14-llm-fallback-template.md) template retained as the fallback
- `tests/test_llm.py` — extended for timeout and error fallback

## Steps

1. Add the provider call behind the existing signature; `generate()`'s contract with [T16](T16-ingest-endpoint.md) does not change.
2. Build the prompt from [T08](T08-models-module.md) types only. No Strava-originated value may appear — not `activity_id`, not upload status, not an error string ([Constraint 1](../CONSTRAINTS.md), [§7.5](../planning/05-strava-integration.md#75-policy-constraint--non-negotiable)).
3. Enforce the [§8](../planning/06-llm-generation.md#8-title-and-description-generation) output constraints after generation — length caps, plain text, no URLs, no emoji unless the config flag is set — and fall back rather than post a violating string.
4. Apply a 10s timeout and fall back to the template on any error, so a model failure never costs the user their activity ([Constraint 9](../CONSTRAINTS.md)).
5. Keep PR/comparison claims out of the prompt's reasoning burden — they arrive as explicit booleans from [T24](T24-pr-flags-history-context.md) ([ADR 0005](../decisions/0005-pr-detection-in-code.md)).

## Done when

```bash
pytest tests/test_llm.py tests/test_boundaries.py
```

Passes, including a test where the provider raises and one where it exceeds 10s — both yield the template output — plus the unchanged import-boundary assertions.

## On completion

Flip `T22` to `done` in [STATUS.md](../STATUS.md), add a one-line note there if the work deviated from the spec, and bump that file's `last-updated`.

---

← [Task index](README.md) · [Status](../STATUS.md)

