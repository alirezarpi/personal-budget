#!/usr/bin/env bash
#
# Build Monat and push it to Docker Hub as :latest and :<commit>.
#
#   docker login            # once, as alirezarpi
#   ./scripts/publish.sh
#
# MONAT_REPO and PLATFORMS override the defaults below.

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

REPO="${MONAT_REPO:-alirezarpi/monat}"
PLATFORMS="${PLATFORMS:-linux/amd64}"   # the landing server; add linux/arm64 for ARM hosts

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Commit your changes first: the image is tagged with the commit it was built from." >&2
  exit 1
fi
SHA="$(git rev-parse --short HEAD)"

docker buildx build --platform "${PLATFORMS}" \
  --label org.opencontainers.image.revision="$(git rev-parse HEAD)" \
  -t "${REPO}:${SHA}" -t "${REPO}:latest" --push .

echo "Pushed ${REPO}:${SHA} and ${REPO}:latest"
