#!/usr/bin/env bash
# Safe production deploy for app.mejmosefajn.org
#
# IMPORTANT: never rsync --delete over server/, and always exclude server/uploads/.
# server/uploads/ is gitignored and lives ONLY on the production server (user
# avatars, project images, post images, DM audio). A `--delete` sync from a dev
# checkout would wipe it. This script avoids that class of mistake.

set -euo pipefail

REMOTE="root@app.mejmosefajn.org"
REMOTE_DIR="/opt/apps/mejmosefajn"
SSH_OPTS="-o StrictHostKeyChecking=accept-new"

echo "==> Building frontend"
npm run build

echo "==> Syncing src/ (safe: --delete OK, no uploads here)"
rsync -az --delete --exclude='.env' -e "ssh $SSH_OPTS" src/ "$REMOTE:$REMOTE_DIR/src/"

echo "==> Syncing dist/ (safe: --delete OK)"
rsync -az --delete -e "ssh $SSH_OPTS" dist/ "$REMOTE:$REMOTE_DIR/dist/"

echo "==> Syncing server/ (NO --delete, EXCLUDE uploads — protects user files)"
rsync -az --exclude='uploads/' --exclude='uploads/**' --exclude='.env' \
  -e "ssh $SSH_OPTS" server/ "$REMOTE:$REMOTE_DIR/server/"

echo "==> Rebuilding container"
ssh $SSH_OPTS "$REMOTE" "cd $REMOTE_DIR && docker compose -f docker-compose.prod.yml up -d --build"

echo "==> Done."
