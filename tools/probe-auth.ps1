<#
.SYNOPSIS
  Post-deploy smoke check for the /ingest auth gate.

.DESCRIPTION
  Confirms the two independent auth checks in app/main.ts still reject unknown
  callers: a wrong path_token and a wrong X-Ingest-Key must each return 404 with
  an empty body (CONSTRAINTS rule 3, planning/03-ingest-api.md section 5).

  Prints status codes and body sizes only. The real path_token is read from
  terraform output into a variable and interpolated into the request URL; it is
  never written to stdout. No secret value is ever printed, so the output is safe
  to paste into an issue or an agent context.

.PARAMETER Service
  Base URL of the deployed service. Defaults to the Cloud Run URL from T19.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/probe-auth.ps1
#>
param(
  [string]$Service = "https://strava-bot-<hash>-uc.a.run.app"
)

$W = "code=%{http_code} size=%{size_download}"
$fail = 0

function Post($label, $url, $key) {
  if ($key) {
    $out = curl.exe -s -o NUL -w $W -X POST -H "Content-Type: text/plain" -H "X-Ingest-Key: $key" --data-binary "probe" --max-time 30 $url
  } else {
    $out = curl.exe -s -o NUL -w $W -X POST -H "Content-Type: text/plain" --data-binary "probe" --max-time 30 $url
  }
  Write-Output ("{0,-36} -> {1}" -f $label, $out)
  if ($out -ne "code=404 size=0") { $script:fail++ ; Write-Output "    EXPECTED code=404 size=0" }
}

$health = curl.exe -s -w " code=%{http_code}" --max-time 30 "$Service/health"
Write-Output ("{0,-36} -> {1}" -f "GET  /health (no auth)", $health)
if ($health -notmatch "code=200") { $fail++ ; Write-Output "    EXPECTED code=200" }

Post "POST /ingest/WRONG (no key)" "$Service/ingest/wrong-path-token-guess" $null
Post "POST /ingest/WRONG (wrong key)" "$Service/ingest/wrong-path-token-guess" "wrong-key-guess"

# Real path_token with a bad key: proves the X-Ingest-Key check is independent of
# the path check, i.e. leaking the URL alone does not grant access.
Push-Location (Join-Path $PSScriptRoot "..\terraform")
$ingestUrl = terraform output -raw ingest_url 2>$null
Pop-Location
if ($ingestUrl -and $ingestUrl -match "/ingest/") {
  Post "POST /ingest/<REAL> (wrong key)" $ingestUrl "wrong-key-guess"
  Post "POST /ingest/<REAL> (no key)" $ingestUrl $null
} else {
  Write-Output "POST /ingest/<REAL>                  -> SKIPPED (terraform output ingest_url unavailable)"
}

if ($fail -gt 0) { Write-Output "" ; Write-Output "FAILED: $fail probe(s) did not match expectations" ; exit 1 }
Write-Output ""
Write-Output "OK: auth gate rejects unknown callers with an empty 404"

