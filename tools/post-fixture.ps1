<#
.SYNOPSIS
  End-to-end check: post a Strong fixture to the deployed /ingest endpoint.

.DESCRIPTION
  Sends one of the tests/fixtures/*.txt share texts to the live Cloud Run
  service exactly as the iPhone Shortcut would, so the full path - auth gate,
  parser, Firestore, Strava - can be confirmed against the real service.

  THIS CREATES A REAL STRAVA ACTIVITY when it succeeds. It is a write test, not
  a smoke probe; use tools/probe-auth.ps1 for the read-only auth check.

  The path_token and X-Ingest-Key are read into variables and interpolated into
  the request. Neither is ever written to stdout, so the output of this script
  is safe to paste into an issue or an agent context (CONSTRAINTS rule 7).

.PARAMETER Fixture
  Fixture name under tests/fixtures, with or without the .txt suffix.
  Defaults to canonical. Pass an unknown name to list the available ones.

.PARAMETER Fresh
  Rewrite the payload so it is a NEW workout to the idempotency layer.

  Persistence dedupes on two keys: the share-link slug, and a content_hash over
  started_at plus each exercise name and set count. Changing only the slug is
  not enough - the content_hash lookup still matches. So -Fresh replaces the
  slug AND sets the date line to now, which is also what makes the posted
  activity land on today rather than on the fixture original date.

  Without -Fresh, a second run of the same fixture is expected to return
  "already posted"; that is correct idempotent behaviour, not a failure.

.PARAMETER IngestUrl
  Full ingest URL including the path_token segment. Defaults to
  "terraform output -raw ingest_url", or the STRAVA_BOT_INGEST_URL env var.
  Prefer the env var over the flag so the token stays out of your shell history.

.PARAMETER DryRun
  Print the exact payload that would be sent and stop. Nothing is posted, no
  credential is read, and no Strava activity is created.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/post-fixture.ps1 -Fresh

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/post-fixture.ps1 -Fixture reps -Fresh
#>
param(
  [string]$Fixture = "canonical",
  [switch]$Fresh,
  [switch]$DryRun,
  [string]$IngestUrl = "",
  [string]$Project = "strava-bot-508419",
  [string]$KeySecret = "strava-bot-ingest-key"
)

$ErrorActionPreference = "Stop"

$fixtureDir = Join-Path $PSScriptRoot "..\tests\fixtures"
$name = if ($Fixture.EndsWith(".txt")) { $Fixture } else { "$Fixture.txt" }
$path = Join-Path $fixtureDir $name

if (-not (Test-Path $path)) {
  Write-Output "Unknown fixture '$Fixture'. Available:"
  Get-ChildItem $fixtureDir -Filter *.txt | ForEach-Object {
    Write-Output ("  " + $_.BaseName)
  }
  exit 1
}

$payload = Get-Content $path -Raw -Encoding UTF8

if ($Fresh) {
  # New share slug: defeats the dedupe_key rule-1 lookup.
  $alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  $slug = -join (1..8 | ForEach-Object { $alphabet[(Get-Random -Maximum $alphabet.Length)] })
  $payload = [regex]::Replace(
    $payload,
    "https://link\.strong\.app/[A-Za-z0-9]+",
    "https://link.strong.app/$slug")

  # New start time: defeats the content_hash rule-2 lookup. The format is the
  # parser DATE_LINE_FORMAT ("cccc, LLLL d, yyyy at h:mm a"), en-US.
  $us = [cultureinfo]::GetCultureInfo("en-US")
  $stamp = (Get-Date).ToString("dddd, MMMM d, yyyy 'at' h:mm tt", $us)
  $payload = [regex]::Replace(
    $payload,
    "(?m)^[A-Za-z]+day, [A-Za-z]+ \d{1,2}, \d{4} at \d{1,2}:\d{2} (AM|PM)[ \t]*\r?$",
    $stamp)

  Write-Output "Payload   : $name (fresh slug + start time $stamp)"
} else {
  Write-Output "Payload   : $name (verbatim; a repeat run should dedupe)"
}

# Resolve the endpoint. The URL embeds the path_token, so it is never printed.
if ($DryRun) {
  Write-Output ""
  Write-Output "--- payload (dry run, nothing sent) ---"
  Write-Output $payload
  exit 0
}

if (-not $IngestUrl) { $IngestUrl = $env:STRAVA_BOT_INGEST_URL }
if (-not $IngestUrl) {
  Push-Location (Join-Path $PSScriptRoot "..\terraform")
  try { $IngestUrl = terraform output -raw ingest_url 2>$null } finally { Pop-Location }
}
if (-not $IngestUrl -or $IngestUrl -notmatch "/ingest/") {
  Write-Output "ERROR: no ingest URL. Set STRAVA_BOT_INGEST_URL or run where terraform state is available."
  exit 1
}

# Resolve the key. Read into a variable only; never echoed.
$ingestKey = $env:STRAVA_BOT_INGEST_KEY
if (-not $ingestKey) {
  $ingestKey = gcloud secrets versions access latest --secret=$KeySecret --project=$Project 2>$null
}
if (-not $ingestKey) {
  Write-Output "ERROR: could not read the ingest key. Set STRAVA_BOT_INGEST_KEY or authenticate gcloud."
  exit 1
}
$ingestKey = $ingestKey.Trim()

$endpoint = ($IngestUrl -replace "/ingest/.*", "/ingest/<path_token redacted>")
Write-Output "Endpoint  : $endpoint"

# Send the body from a file so PowerShell never re-encodes it. Strong text
# contains a multiplication sign and a narrow no-break space; both must reach
# the parser as UTF-8 exactly as the Shortcut sends them.
$tmp = [System.IO.Path]::GetTempFileName()
$bodyFile = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText($tmp, $payload, (New-Object System.Text.UTF8Encoding($false)))

  $curlArgs = @(
    "-s", "-o", $bodyFile, "-w", "%{http_code}",
    "-X", "POST",
    "-H", "Content-Type: text/plain; charset=utf-8",
    "-H", "X-Ingest-Key: $ingestKey",
    "--data-binary", "@$tmp",
    "--max-time", "120",
    $IngestUrl
  )
  $code = & curl.exe @curlArgs

  $body = [System.IO.File]::ReadAllText($bodyFile, [System.Text.Encoding]::UTF8).Trim()
} finally {
  Remove-Item $tmp, $bodyFile -ErrorAction SilentlyContinue
}

Write-Output ""
Write-Output "HTTP $code"
Write-Output $body
Write-Output ""

switch -regex ($code) {
  "^200$" {
    if ($body -match "^already posted") {
      Write-Output "DEDUPED: this workout was already posted. Re-run with -Fresh for a new one."
    } else {
      Write-Output "SUCCESS: posted to Strava. Open the URL above to confirm."
    }
    exit 0
  }
  "^400$" { Write-Output "PARSE FAILED: raw_text was still persisted; check the parser against this fixture." ; exit 1 }
  "^404$" { Write-Output "AUTH FAILED: wrong path_token or X-Ingest-Key (rule 3 hides which)." ; exit 1 }
  "^413$" { Write-Output "TOO LARGE: payload exceeded the size cap." ; exit 1 }
  "^500$" { Write-Output "INTERNAL ERROR: likely Firestore; nothing was posted to Strava." ; exit 1 }
  "^502$" {
    Write-Output "STRAVA REJECTED: the request reached Strava and Strava refused it."
    Write-Output "Check strava_status in the Cloud Run log record: 401 = scope/token, 400 = payload, 429 = rate limit."
    exit 1
  }
  default { Write-Output "UNEXPECTED STATUS." ; exit 1 }
}
