<#
.SYNOPSIS
  Run terraform plan or apply in terraform/ with its secret variables loaded
  from Secret Manager.

.DESCRIPTION
  terraform/ needs two sensitive variables that must never be written to disk:
  strava_client_secret and github_token. This reads the current version of each
  from Secret Manager into a TF_VAR_* environment variable for the duration of
  one terraform run and removes it afterwards. Neither value is printed, and
  because they are the values Terraform last wrote, an apply does not create new
  secret versions.

  Every other input comes from terraform/terraform.tfvars, which is gitignored;
  create it from terraform/terraform.tfvars.example. The working directory is
  initialized first if it has not been.

.PARAMETER Command
  plan or apply. Defaults to apply, which still shows the plan and asks for
  confirmation before changing anything.

.PARAMETER TerraformArgs
  Extra arguments passed straight through to terraform, e.g. -auto-approve.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/terraform-apply.ps1 plan

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File tools/terraform-apply.ps1
#>
param(
  [ValidateSet("plan", "apply")]
  [string]$Command = "apply",

  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$TerraformArgs = @()
)

$ErrorActionPreference = "Stop"

$terraformDir = Join-Path $PSScriptRoot "..\terraform"
$varsFile = Join-Path $terraformDir "terraform.tfvars"

if (-not (Test-Path $varsFile)) {
  throw "Missing terraform/terraform.tfvars; copy terraform/terraform.tfvars.example and fill it in."
}

$projectMatch = Select-String -Path $varsFile -Pattern '^\s*project_id\s*=\s*"([^"]+)"'
if (-not $projectMatch) {
  throw "project_id is not set in terraform/terraform.tfvars."
}
$project = $projectMatch.Matches[0].Groups[1].Value

$secrets = [ordered]@{
  TF_VAR_strava_client_secret = "strava-client-secret"
  TF_VAR_github_token         = "strava-bot-github-token"
}

$code = 1
Push-Location $terraformDir
try {
  foreach ($envName in $secrets.Keys) {
    $secretId = $secrets[$envName]
    $value = gcloud secrets versions access latest --secret=$secretId --project=$project
    if ($LASTEXITCODE -ne 0 -or -not $value -or $value -is [array]) {
      throw "Could not read a single-line value for secret '$secretId' in project $project."
    }
    Set-Item -Path "Env:$envName" -Value $value
  }

  $code = 0
  if (-not (Test-Path ".terraform")) {
    terraform init -input=false
    $code = $LASTEXITCODE
  }

  if ($code -eq 0) {
    terraform $Command @TerraformArgs
    $code = $LASTEXITCODE
  }
} finally {
  foreach ($envName in $secrets.Keys) {
    Remove-Item -Path "Env:$envName" -ErrorAction SilentlyContinue
  }
  Pop-Location
}

exit $code
