#!/usr/bin/env bash
# deploy.sh — manual redeploy / rollback helper
# Usage:  ./deploy.sh X.Y.Z
#
# Requires on the local machine:
#   - SSH access to the VPS (key in ~/.ssh/id_ed25519 or SSH_KEY env)
#   - VPS_HOST / VPS_USER env vars, or edit the defaults below.
#
# [manual-owner]: set VPS_HOST, VPS_USER, and ensure ~/.ssh known_hosts has the VPS.

set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: ./deploy.sh X.Y.Z" >&2
  exit 1
fi

VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-}"

if [[ -z "$VPS_HOST" || -z "$VPS_USER" ]]; then
  echo "Set VPS_HOST and VPS_USER env vars before running." >&2
  exit 1
fi

SSH="ssh ${VPS_USER}@${VPS_HOST}"
SCP="scp -r"

echo "==> Copying infra/ to VPS /opt/statok/"
$SCP infra/. "${VPS_USER}@${VPS_HOST}:/opt/statok/"

echo "==> Deploying version $VERSION"
$SSH bash -s <<EOF
set -e
sed -i "s/^STATOK_VERSION=.*/STATOK_VERSION=${VERSION}/" /opt/statok/.env
cd /opt/statok
docker compose -f docker-compose.yml pull
docker compose -f docker-compose.yml up -d --remove-orphans
EOF

echo "==> Polling health..."
for i in $(seq 1 24); do
  STATUS=$(curl -sf https://api.statok.simk.in.ua/health | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [[ "$STATUS" == "ok" ]]; then
    echo "Health check passed. Deployed $VERSION."
    exit 0
  fi
  echo "  Attempt $i/24: not ready yet, waiting 5s..."
  sleep 5
done

echo "ERROR: health check timed out after 120s" >&2
exit 1
