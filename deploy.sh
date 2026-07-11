#!/usr/bin/env bash
# Deploy app.mejmosefajn.org THROUGH GIT.
#
# Pushing to `main` triggers GitHub Actions (.github/workflows/deploy.yml),
# which SSHes to the VPS, fast-forwards /opt/apps/mejmosefajn to origin/main,
# rebuilds the Docker image and restarts the container.
#
# This REPLACES the old direct-rsync deploy. That version copied the local
# working tree straight onto the production box, bypassing git — which is why
# the server tree kept drifting out of sync with the repo. Git is now the single
# source of truth: nothing reaches production that isn't committed and pushed.
#
# server/uploads/ (user avatars, images, DM audio) lives ONLY on the server and
# is gitignored, so a git-based deploy can never touch it.

set -euo pipefail

BRANCH="main"

# 1) Refuse to deploy uncommitted work — it would silently NOT ship.
if [ -n "$(git status --porcelain)" ]; then
  echo "✗ Uncommitted changes present. Commit them first — only committed code deploys:"
  git status --short
  exit 1
fi

# 2) Local type-check gate: fail here rather than after a broken image is built.
echo "==> Type-checking"
npm run typecheck

# 3) Push → GitHub Actions runs the deploy on the VPS.
echo "==> Pushing $BRANCH -> triggers GitHub Actions deploy"
git push origin "$BRANCH"

echo "==> Pushed. Follow the deploy with:  gh run watch"
