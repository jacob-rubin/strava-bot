#!/usr/bin/env bash
#
# Post-deploy smoke check for the /ingest auth gate.
#
# Confirms the two independent auth checks in app/main.ts still reject unknown
# callers: a wrong path_token and a wrong X-Ingest-Key must each return 404 with
# an empty body (CONSTRAINTS rule 3, docs/reference/ingest-api.md).
#
# Prints status codes and body sizes only. The real path_token is read from
# terraform output into a variable and interpolated into the request URL; it is
# never written to stdout. No secret value is ever printed, so the output is safe
# to paste into an issue or an agent context.
#
# Usage:
#   tools/probe-auth.sh [--service URL]
#
#   --service URL   Base URL of the deployed service. Defaults to the deployed
#                   Cloud Run URL.

set -euo pipefail

service="https://strava-bot-<hash>-uc.a.run.app"

while [[ $# -gt 0 ]]; do
  case $1 in
    --service)
      service=${2:?--service needs a URL}
      shift 2
      ;;
    -h | --help)
      sed -n '3,18s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument '$1'. See --help." >&2
      exit 2
      ;;
  esac
done

terraform_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../terraform" && pwd)"
write_out="code=%{http_code} size=%{size_download}"
fail=0

# Posts to url with an optional X-Ingest-Key and expects an empty 404.
post() {
  local label=$1 url=$2 key=${3:-} out
  local args=(-s -o /dev/null -w "$write_out" -X POST -H "Content-Type: text/plain")
  if [[ -n $key ]]; then
    args+=(-H "X-Ingest-Key: $key")
  fi
  out=$(curl "${args[@]}" --data-binary "probe" --max-time 30 "$url") || true
  printf '%-36s -> %s\n' "$label" "$out"
  if [[ $out != "code=404 size=0" ]]; then
    fail=$((fail + 1))
    echo "    EXPECTED code=404 size=0"
  fi
}

health=$(curl -s -w " code=%{http_code}" --max-time 30 "$service/health") || true
printf '%-36s -> %s\n' "GET  /health (no auth)" "$health"
if [[ $health != *"code=200"* ]]; then
  fail=$((fail + 1))
  echo "    EXPECTED code=200"
fi

post "POST /ingest/WRONG (no key)" "$service/ingest/wrong-path-token-guess"
post "POST /ingest/WRONG (wrong key)" "$service/ingest/wrong-path-token-guess" "wrong-key-guess"

# Real path_token with a bad key: proves the X-Ingest-Key check is independent of
# the path check, i.e. leaking the URL alone does not grant access.
ingest_url=$(cd "$terraform_dir" && terraform output -raw ingest_url 2>/dev/null) || ingest_url=""
if [[ $ingest_url == *"/ingest/"* ]]; then
  post "POST /ingest/<REAL> (wrong key)" "$ingest_url" "wrong-key-guess"
  post "POST /ingest/<REAL> (no key)" "$ingest_url"
else
  printf '%-36s -> %s\n' "POST /ingest/<REAL>" "SKIPPED (terraform output ingest_url unavailable)"
fi

echo
if [[ $fail -gt 0 ]]; then
  echo "FAILED: $fail probe(s) did not match expectations"
  exit 1
fi
echo "OK: auth gate rejects unknown callers with an empty 404"
