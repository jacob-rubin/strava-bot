# Handing off a human step

Some runbooks are marked `human` (T01, T02, T07, T20, T21) or `agent + human step` (T06). Those steps involve a browser login, a device, or a console the agent cannot drive. Do the agent-side work, then hand off and wait — do not attempt the human step, and do not mark the task verified without the user's result.

## What to do first

Everything the runbook allows without the human: write the script, prepare the command with real values filled in, stage the config, confirm prerequisites exist. The user should have nothing to figure out.

## Handoff format

Emit one block containing:

1. **Why it needs you** — one line (e.g. "Strava's OAuth consent screen requires an interactive login").
2. **Steps** — numbered, each concrete enough to follow without opening the runbook. Include exact commands and URLs, with placeholders already substituted.
3. **Paste back** — exactly what output proves the step worked: the redirect URL, the activity id, the console value, the screenshot description. Name each item.
4. **Do not paste** — any secret the step exposes. If a secret is needed, say where it goes (Secret Manager, `.env`) and ask the user to confirm placement, not to paste the value.

Example shape:

```text
T07 needs you — Strava's POST /activities call must run against a live token.

1. Run: .venv\Scripts\python.exe scripts/authorize.py
2. Open the printed URL, approve, and copy the full localhost redirect URL.
3. Confirm the activity appears at https://www.strava.com/athlete/training

Paste back:
- the numeric activity id from the response
- whether the response required "type" alongside "sport_type" (open item 4)

Do not paste: the authorization code or any token. Confirm instead that the
refresh token was written to Secret Manager.
```

## After the user replies

Resume at the verification step with their result as the evidence. If the reply answers an open item in `docs/STATUS.md`, record it inline in that row during the approval step. If the reply is ambiguous or a step failed, ask one targeted follow-up rather than guessing.
