#!/usr/bin/env bash
set -euo pipefail

image_ref="${1:?image reference is required}"
relationship="${2:?relationship exact or ancestor is required}"

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${RELEASE_BRANCH:?RELEASE_BRANCH is required}"
: "${RELEASE_SHA:?RELEASE_SHA is required}"

if [[ ! "$image_ref" =~ ^ghcr\.io/appolon1908-hue/scrapper@sha256:[a-f0-9]{64}$ ]]; then
  echo "ERROR=IMAGE_REFERENCE_MUST_BE_APPROVED_IMMUTABLE_DIGEST" >&2
  exit 1
fi
if [[ "$relationship" != "exact" && "$relationship" != "ancestor" ]]; then
  echo "ERROR=INVALID_IMAGE_RELATIONSHIP" >&2
  exit 1
fi

docker pull "$image_ref" >/dev/null
revision="$(docker image inspect "$image_ref" --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}')"
if [[ ! "$revision" =~ ^[a-f0-9]{40}$ ]]; then
  echo "ERROR=IMAGE_REVISION_LABEL_IS_INVALID" >&2
  exit 1
fi

case "$relationship" in
  exact)
    if [[ "$revision" != "$RELEASE_SHA" ]]; then
      echo "ERROR=CANDIDATE_IMAGE_REVISION_MISMATCH" >&2
      echo "IMAGE_REVISION=$revision" >&2
      echo "RELEASE_SHA=$RELEASE_SHA" >&2
      exit 1
    fi
    ;;
  ancestor)
    git cat-file -e "${revision}^{commit}" 2>/dev/null || {
      echo "ERROR=ROLLBACK_IMAGE_REVISION_NOT_IN_REVIEWED_HISTORY" >&2
      exit 1
    }
    if [[ "$revision" == "$RELEASE_SHA" ]]; then
      echo "ERROR=ROLLBACK_IMAGE_MUST_DIFFER_FROM_CANDIDATE" >&2
      exit 1
    fi
    if ! git merge-base --is-ancestor "$revision" "$RELEASE_SHA"; then
      echo "ERROR=ROLLBACK_IMAGE_REVISION_IS_NOT_RELEASE_ANCESTOR" >&2
      exit 1
    fi
    ;;
esac

certificate_identity="https://github.com/${GITHUB_REPOSITORY}/.github/workflows/release-readiness.yml@refs/heads/${RELEASE_BRANCH}"
cosign verify \
  --certificate-identity "$certificate_identity" \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  "$image_ref" >/dev/null

gh attestation verify "oci://$image_ref" --repo "$GITHUB_REPOSITORY" >/dev/null

echo "IMAGE_VERIFICATION=PASS"
echo "IMAGE_REFERENCE=$image_ref"
echo "IMAGE_REVISION=$revision"
echo "IMAGE_RELATIONSHIP=$relationship"
