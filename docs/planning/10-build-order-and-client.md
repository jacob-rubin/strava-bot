---
status: authoritative
last-updated: 2026-09-10
---

← [Index](../PLANNING.md)

## 13. Build order

1. `scripts/authorize.py`; obtain a refresh token; `curl` a manual `POST /activities` with a title and description. Proves auth and the endpoint before any infrastructure.
2. Parser + tests against the fixture.
3. `/ingest` with auth, size cap, parse, dedupe, Firestore, and a **templated** description. Deploy with `--max-instances=3` and a budget alert.
4. Wire the Shortcut ([§14](#14-client--ios-shortcut)). Confirm the round trip.
5. Replace the template with the LLM path plus fallback.
6. `history` collection and PR flags.
7. Optional: probe `[U]` structured uploads; enable the flag only if the probe succeeds.

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
