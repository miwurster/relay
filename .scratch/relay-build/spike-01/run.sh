#!/usr/bin/env bash
# PROTOTYPE — spike 01. Throwaway. One command to run the whole spike.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SANDCASTLE="${SANDCASTLE:-$HOME/work/sandbox/sandcastle}"
QC_CATALOG="${QC_CATALOG:-$HOME/work/kipu/qc-catalog}"
IMAGE_NAME="${IMAGE_NAME:-relay-spike01:local}"

UID_HOST="$(id -u)"
GID_HOST="$(id -g)"

echo "===== build sandbox image (UID/GID aligned: ${UID_HOST}:${GID_HOST}) ====="
docker build \
  --build-arg "AGENT_UID=${UID_HOST}" \
  --build-arg "AGENT_GID=${GID_HOST}" \
  -t "${IMAGE_NAME}" \
  -f "${HERE}/Dockerfile.spike" \
  "${HERE}"

echo "===== detect docker.sock GID as seen INSIDE a container ====="
SOCKET_GID="$(docker run --rm -v /var/run/docker.sock:/var/run/docker.sock alpine:3 \
  stat -c '%g' /var/run/docker.sock)"
echo "socket in-container gid = ${SOCKET_GID}"

echo "===== run spike (sandcastle dist: ${SANDCASTLE}) ====="
# Import sandcastle from its local built dist via a node_modules symlink, so the
# package's own subpath exports (@ai-hero/sandcastle/sandboxes/docker) resolve.
mkdir -p "${HERE}/node_modules/@ai-hero"
ln -sfn "${SANDCASTLE}" "${HERE}/node_modules/@ai-hero/sandcastle"

cd "${HERE}"
# Use sandcastle's own tsx (offline, no npx fetch needed).
TSX="${SANDCASTLE}/node_modules/.bin/tsx"
IMAGE_NAME="${IMAGE_NAME}" \
QC_CATALOG="${QC_CATALOG}" \
SOCKET_GID="${SOCKET_GID}" \
  "${TSX}" "${HERE}/spike.ts"
