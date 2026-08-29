#!/usr/bin/env bash
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN is required}"
: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RELEASE_BRANCH:?RELEASE_BRANCH is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

if [[ ! "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]; then
  echo "ERROR=RELEASE_SHA_MUST_BE_40_HEX" >&2
  exit 1
fi
if [[ ! "$RELEASE_BRANCH" =~ ^(release/[A-Za-z0-9._/-]+|production)$ ]] ||
   [[ "$RELEASE_BRANCH" == *".."* || "$RELEASE_BRANCH" == *"//"* ]]; then
  echo "ERROR=UNSAFE_RELEASE_BRANCH" >&2
  exit 1
fi

encoded_branch="$(python3 -c 'import os, urllib.parse; print(urllib.parse.quote(os.environ["RELEASE_BRANCH"], safe=""))')"
branch_json="$(gh api "repos/${GITHUB_REPOSITORY}/branches/${encoded_branch}")"
if [[ "$(jq -r '.protected' <<<"$branch_json")" != "true" ]]; then
  echo "ERROR=RELEASE_BRANCH_IS_NOT_PROTECTED" >&2
  exit 1
fi
branch_sha="$(jq -r '.commit.sha' <<<"$branch_json")"
if [[ "$branch_sha" != "$RELEASE_SHA" ]]; then
  echo "ERROR=RELEASE_SHA_IS_NOT_CURRENT_PROTECTED_HEAD" >&2
  echo "EXPECTED_RELEASE_SHA=$branch_sha" >&2
  echo "REQUESTED_RELEASE_SHA=$RELEASE_SHA" >&2
  exit 1
fi

checks_json="$(
  gh api --paginate \
    -H 'Accept: application/vnd.github+json' \
    "repos/${GITHUB_REPOSITORY}/commits/${RELEASE_SHA}/check-runs?per_page=100" \
    | jq -s '{check_runs: [.[].check_runs[]]}'
)"

for required_check in validate deployment-policy gateway; do
  latest="$(
    jq -c --arg name "$required_check" '
      [.check_runs[] | select(.name == $name)]
      | sort_by(.id)
      | last // empty
    ' <<<"$checks_json"
  )"
  if [[ -z "$latest" ]]; then
    echo "ERROR=MISSING_REQUIRED_EXACT_SHA_CHECK:$required_check" >&2
    exit 1
  fi
  status="$(jq -r '.status' <<<"$latest")"
  conclusion="$(jq -r '.conclusion // ""' <<<"$latest")"
  if [[ "$status" != "completed" || "$conclusion" != "success" ]]; then
    echo "ERROR=REQUIRED_EXACT_SHA_CHECK_NOT_SUCCESSFUL:$required_check:$status:$conclusion" >&2
    exit 1
  fi
done

git fetch --no-tags origin \
  "refs/heads/${RELEASE_BRANCH}:refs/remotes/origin/verified-release" >/dev/null
if [[ "$(git rev-parse refs/remotes/origin/verified-release)" != "$RELEASE_SHA" ]]; then
  echo "ERROR=FETCHED_RELEASE_HEAD_MISMATCH" >&2
  exit 1
fi

echo "RELEASE_CONTEXT=PASS"
echo "RELEASE_BRANCH=$RELEASE_BRANCH"
echo "RELEASE_SHA=$RELEASE_SHA"
echo "REQUIRED_CHECKS=validate,deployment-policy,gateway"
