#!/usr/bin/env bash
#
# Run terraform plan or apply in terraform/ with its secret variables loaded
# from Secret Manager.
#
# terraform/ needs two sensitive variables that must never be written to disk:
# strava_client_secret and github_token. This reads the current version of each
# from Secret Manager into a TF_VAR_* environment variable exported only to this
# script's process and the terraform it runs, so both are gone when it exits.
# Neither value is printed, and because they are the values Terraform last
# wrote, an apply does not create new secret versions.
#
# Every other input comes from terraform/terraform.tfvars, which is gitignored;
# create it from terraform/terraform.tfvars.example. The working directory is
# initialized first if it has not been.
#
# Usage:
#   tools/terraform-apply.sh [plan|apply] [terraform args...]
#
#   plan|apply       Defaults to apply, which still shows the plan and asks for
#                    confirmation before changing anything.
#   terraform args   Passed straight through to terraform, e.g. -auto-approve.
#
# Examples:
#   tools/terraform-apply.sh plan
#   tools/terraform-apply.sh

set -euo pipefail

die() {
  echo "$*" >&2
  exit 1
}

command=apply
if [[ $# -gt 0 ]]; then
  case $1 in
    plan | apply)
      command=$1
      shift
      ;;
    -*) ;;
    *) die "Unknown command '$1'; expected plan or apply." ;;
  esac
fi

terraform_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../terraform" && pwd)"
vars_file="$terraform_dir/terraform.tfvars"

[[ -f $vars_file ]] ||
  die "Missing terraform/terraform.tfvars; copy terraform/terraform.tfvars.example and fill it in."

project=$(sed -nE 's/^[[:space:]]*project_id[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/p' "$vars_file")
project=${project%%$'\n'*}
[[ -n $project ]] || die "project_id is not set in terraform/terraform.tfvars."

# Prints the secret's latest version, which must be a single non-empty line.
read_secret() {
  local secret_id=$1 value
  if ! value=$(gcloud secrets versions access latest --secret="$secret_id" --project="$project") ||
    [[ -z $value || $value == *$'\n'* ]]; then
    die "Could not read a single-line value for secret '$secret_id' in project $project."
  fi
  printf '%s' "$value"
}

TF_VAR_strava_client_secret=$(read_secret strava-client-secret)
export TF_VAR_strava_client_secret
TF_VAR_github_token=$(read_secret strava-bot-github-token)
export TF_VAR_github_token

cd "$terraform_dir"
if [[ ! -d .terraform ]]; then
  terraform init -input=false
fi

exec terraform "$command" "$@"
