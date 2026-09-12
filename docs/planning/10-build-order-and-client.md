---
status: authoritative
last-updated: 2026-09-10
---

← [Index](../PLANNING.md)

## 13. Build order

The seven steps below are phases. Each is decomposed into atomic task runbooks under [docs/tasks/](../tasks/README.md); [STATUS.md](../STATUS.md) tracks which are done.

1. **Prove auth.** `scripts/authorize.py`; obtain a refresh token; `curl` a manual `POST /activities` with a title and description. Proves auth and the endpoint before any infrastructure. → [T01](../tasks/T01-strava-api-app.md), [T02](../tasks/T02-gcp-project.md), [T03](../tasks/T03-secret-manager-secrets.md), [T04](../tasks/T04-repo-skeleton.md), [T05](../tasks/T05-config-module.md), [T06](../tasks/T06-authorize-script.md), [T07](../tasks/T07-manual-create-activity.md)
2. **Parser.** Parser + tests against the fixture. → [T08](../tasks/T08-models-module.md), [T09](../tasks/T09-fixtures.md), [T10](../tasks/T10-parser-core.md), [T11](../tasks/T11-parser-derived-values.md), [T12](../tasks/T12-parser-tests.md)
3. **Ingest v1.** `/ingest` with auth, size cap, parse, dedupe, Firestore, and a **templated** description. Deploy with `--max-instances=3` and a budget alert. → [T13](../tasks/T13-store-workouts.md), [T14](../tasks/T14-llm-fallback-template.md), [T15](../tasks/T15-strava-client.md), [T16](../tasks/T16-ingest-endpoint.md), [T17](../tasks/T17-ingest-and-boundary-tests.md), [T18](../tasks/T18-dockerfile-local-run.md), [T19](../tasks/T19-cloud-run-deploy.md)
4. **Client.** Wire the Shortcut ([§14](#14-client--ios-shortcut)). Confirm the round trip. → [T20](../tasks/T20-share-sheet-probe.md), [T21](../tasks/T21-shortcut-wiring-e2e.md)
5. **LLM generation.** Replace the template with the LLM path plus fallback. → [T22](../tasks/T22-llm-provider.md)
6. **History and PRs.** `history` collection and PR flags. → [T23](../tasks/T23-history-writes.md), [T24](../tasks/T24-pr-flags-history-context.md)
7. **Optional.** Probe `[U]` structured uploads; enable the flag only if the probe succeeds. → [T25](../tasks/T25-probe-upload-json.md), [T26](../tasks/T26-structured-upload.md), plus tooling [T27](../tasks/T27-reparse-script.md)

---

## 14. Client — iOS Shortcut

Shortcuts app → new shortcut → ⓘ → Details → **Show in Share Sheet**. Set accepted input to **Any** initially.

```
1. Get Contents of URL
     URL     https://<service>.run.app/ingest/<path_token>
     Method  POST
     Headers X-Ingest-Key: <secret>
             Content-Type: text/plain
     Body    Shortcut Input          ← raw, no transformation
2. Show Notification  ← Contents of URL
```

The Shortcut performs no parsing, formatting, or branching. All logic is server-side so a fix is a redeploy.

**[U] What Strong's share sheet actually delivers is unverified** — it may be the full text block, the `link.strong.app` URL alone, or both as separate items. Before building the server, set the shortcut's only action to `Quick Look` on Shortcut Input and run it from Strong. If only the URL arrives, the share-sheet path is not viable and the fallback is: Strong → Share → **Copy**, then a shortcut using `Get Clipboard`, triggered from Back Tap or the Action Button. The server contract is unchanged either way.

**Operational notes.** The secret lives as plaintext in the Shortcut and syncs via iCloud; never share the shortcut. Rotation is a new secret version plus editing one field.

---

← [Index](../PLANNING.md) · Previous: [Acceptance criteria](09-acceptance-criteria.md) · Next: [Open items and sources](11-open-items-and-sources.md)
