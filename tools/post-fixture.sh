#!/usr/bin/env bash
#
# End-to-end check: post a Strong fixture to the deployed /ingest endpoint.
#
# Sends one of the tests/fixtures/*.txt share texts to the live Cloud Run
# service exactly as the iPhone Shortcut would, so the full path - auth gate,
# parser, Firestore, Strava - can be confirmed against the real service.
#
# THIS CREATES A REAL STRAVA ACTIVITY when it succeeds. It is a write test, not
# a smoke probe; use tools/probe-auth.sh for the read-only auth check.
#
# The path_token and X-Ingest-Key are read into variables and handed to curl
# without appearing on its command line. Neither is ever written to stdout, so
# the output of this script is safe to paste into an issue or an agent context
# (CONSTRAINTS rule 7).
#
# Usage:
#   tools/post-fixture.sh [--fixture NAME] [--fresh] [--dry-run]
#                         [--ingest-url URL] [--project ID] [--key-secret NAME]
#
#   --fixture NAME    Fixture under tests/fixtures, with or without the .txt
#                     suffix. Defaults to canonical. An unknown name lists the
#                     available ones.
#   --fresh           Rewrite the payload so it is a NEW workout to the
#                     idempotency layer. Persistence dedupes on two keys: the
#                     share-link slug, and a content_hash over started_at plus
#                     each exercise name and set count. Changing only the slug
#                     is not enough, so --fresh replaces the slug AND sets the
#                     date line to now, which also makes the posted activity
#                     land on today. Without it, a second run of the same
#                     fixture is expected to return "already posted".
#   --dry-run         Print the exact payload that would be sent and stop.
#                     Nothing is posted and no credential is read.
#   --ingest-url URL  Full ingest URL including the path_token segment.
#                     Defaults to STRAVA_BOT_INGEST_URL, then to
#                     "terraform output -raw ingest_url". Prefer the env var so
#                     the token stays out of your shell history.
#   --project ID      GCP project holding the ingest key secret.
#   --key-secret NAME Secret Manager secret holding the ingest key. The
#                     STRAVA_BOT_INGEST_KEY env var takes precedence.
#
# Examples:
#   tools/post-fixture.sh --fresh
#   tools/post-fixture.sh --fixture reps --fresh

set -euo pipefail

fixture=canonical
fresh=false
dry_run=false
ingest_url=""
project=strava-bot-508419
key_secret=strava-bot-ingest-key

while [[ $# -gt 0 ]]; do
  case $1 in
    --fixture)
      fixture=${2:?--fixture needs a name}
      shift 2
      ;;
    --fresh)
      fresh=true
      shift
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    --ingest-url)
      ingest_url=${2:?--ingest-url needs a URL}
      shift 2
      ;;
    --project)
      project=${2:?--project needs an ID}
      shift 2
      ;;
    --key-secret)
      key_secret=${2:?--key-secret needs a name}
      shift 2
      ;;
    -h | --help)
      sed -n '3,44s/^# \{0,1\}//p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument '$1'. See --help." >&2
      exit 2
      ;;
  esac
done

repo_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture_dir="$repo_dir/tests/fixtures"
name="${fixture%.txt}.txt"
fixture_path="$fixture_dir/$name"

if [[ ! -f $fixture_path ]]; then
  echo "Unknown fixture '$fixture'. Available:"
  for available in "$fixture_dir"/*.txt; do
    echo "  $(basename "$available" .txt)"
  done
  exit 1
fi

work_dir=$(mktemp -d)
trap 'rm -rf "$work_dir"' EXIT
payload_file="$work_dir/payload.txt"
response_file="$work_dir/response.txt"
cp "$fixture_path" "$payload_file"

if [[ $fresh == true ]]; then
  # New share slug: defeats the dedupe_key rule-1 lookup.
  alphabet=abcdefghijklmnopqrstuvwxyz0123456789
  slug=""
  for _ in 1 2 3 4 5 6 7 8; do
    slug+=${alphabet:RANDOM%${#alphabet}:1}
  done

  # New start time: defeats the content_hash rule-2 lookup. The format is the
  # parser DATE_LINE_FORMAT ("cccc, LLLL d, yyyy at h:mm a"), en-US.
  stamp=$(LC_ALL=C date '+%A, %B %-d, %Y at %-I:%M %p')

  # LC_ALL=C makes sed treat the UTF-8 fixture text as plain bytes. A trailing
  # carriage return on the date line is kept.
  cr=$'\r'
  LC_ALL=C sed -E \
    -e "s#https://link\.strong\.app/[A-Za-z0-9]+#https://link.strong.app/$slug#g" \
    -e "s#^[A-Za-z]+day, [A-Za-z]+ [0-9]{1,2}, [0-9]{4} at [0-9]{1,2}:[0-9]{2} (AM|PM)[[:blank:]]*($cr?)\$#$stamp\2#" \
    "$fixture_path" >"$payload_file"

  echo "Payload   : $name (fresh slug + start time $stamp)"
else
  echo "Payload   : $name (verbatim; a repeat run should dedupe)"
fi

if [[ $dry_run == true ]]; then
  echo
  echo "--- payload (dry run, nothing sent) ---"
  cat "$payload_file"
  exit 0
fi

# Resolve the endpoint. The URL embeds the path_token, so it is never printed.
ingest_url=${ingest_url:-${STRAVA_BOT_INGEST_URL:-}}
if [[ -z $ingest_url ]]; then
  ingest_url=$(cd "$repo_dir/terraform" && terraform output -raw ingest_url 2>/dev/null) || ingest_url=""
fi
if [[ $ingest_url != *"/ingest/"* ]]; then
  echo "ERROR: no ingest URL. 'terraform output' found no state in terraform/ (a Codex worktree has none; the state lives in the main checkout). Set STRAVA_BOT_INGEST_URL or run from the main checkout."
  exit 1
fi

# Resolve the key. Read into a variable only; never echoed.
ingest_key=${STRAVA_BOT_INGEST_KEY:-}
if [[ -z $ingest_key ]]; then
  ingest_key=$(gcloud secrets versions access latest --secret="$key_secret" --project="$project" 2>/dev/null) || ingest_key=""
fi
ingest_key="${ingest_key#"${ingest_key%%[![:space:]]*}"}"
ingest_key="${ingest_key%"${ingest_key##*[![:space:]]}"}"
if [[ -z $ingest_key ]]; then
  echo "ERROR: could not read the ingest key. Set STRAVA_BOT_INGEST_KEY or authenticate gcloud."
  exit 1
fi

echo "Endpoint  : ${ingest_url%%/ingest/*}/ingest/<path_token redacted>"

# The body is sent from the file byte for byte, so the multiplication sign and
# narrow no-break space in Strong text reach the parser as UTF-8 exactly as the
# Shortcut sends them. The key header is read from stdin (-H @-) so it never
# appears in curl's argument list, where other processes could see it.
code=$(
  printf 'X-Ingest-Key: %s\n' "$ingest_key" |
    curl -s -o "$response_file" -w "%{http_code}" \
      -X POST \
      -H "Content-Type: text/plain; charset=utf-8" \
      -H @- \
      --data-binary "@$payload_file" \
      --max-time 120 \
      "$ingest_url"
) || true

body=""
if [[ -f $response_file ]]; then
  body=$(cat "$response_file")
fi

echo
echo "HTTP $code"
echo "$body"
echo

case $code in
  200)
    if [[ $body == "already posted"* ]]; then
      echo "DEDUPED: this workout was already posted. Re-run with --fresh for a new one."
    else
      echo "SUCCESS: posted to Strava. Open the URL above to confirm."
    fi
    exit 0
    ;;
  400) echo "PARSE FAILED: raw_text was still persisted; check the parser against this fixture." ;;
  404) echo "AUTH FAILED: wrong path_token or X-Ingest-Key (rule 3 hides which)." ;;
  413) echo "TOO LARGE: payload exceeded the size cap." ;;
  500) echo "INTERNAL ERROR: likely Firestore; nothing was posted to Strava." ;;
  502)
    echo "STRAVA REJECTED: the request reached Strava and Strava refused it."
    echo "Check strava_status in the Cloud Run log record: 401 = scope/token, 400 = payload, 429 = rate limit."
    ;;
  *) echo "UNEXPECTED STATUS." ;;
esac
exit 1
