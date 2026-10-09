#!/usr/bin/env bash
# "Deploy all": regenerate DOKUMENTASI.md, run the tests, apply Supabase
# migrations, deploy the Supabase api function, push main to both GitHub
# remotes (GitHub Pages publishes from origin). Run from a clean tree on
# main after committing your work: npm run deploy:all
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT_REF=josptpfisrsdjeggkqke
PAGES_REPO=kukuh-haryobismoko/sayakaya-analytics
OFFICE_USER=kukuh-sayakaya

branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$branch" != "main" ]; then
  echo "deploy-all: on '$branch', not main. Switch to main first." >&2; exit 1
fi
# Only committed code gets deployed; the generated document is the one file
# this script may change and commit itself.
if [ -n "$(git status --porcelain -- . ':(exclude)DOKUMENTASI.md')" ]; then
  echo "deploy-all: uncommitted changes. Commit or stash them first:" >&2
  git status --short -- . ':(exclude)DOKUMENTASI.md' >&2; exit 1
fi

echo "== 1/6 Documentation"
node scripts/generate-docs.js
if [ -n "$(git status --porcelain -- DOKUMENTASI.md)" ]; then
  git add DOKUMENTASI.md
  git commit -q -m "Regenerate project documentation"
  echo "committed DOKUMENTASI.md"
fi

echo "== 2/6 Tests"
npm test --silent

echo "== 3/6 Supabase migrations (before the function that may need them)"
supabase migration list --linked
supabase db push --linked --yes

echo "== 4/6 Supabase api function"
supabase functions deploy api --project-ref "$PROJECT_REF"

echo "== 5/6 Push origin (GitHub Pages) and kantor"
# Each remote with its own gh account; the macOS keychain credential works
# for neither.
git -c credential.helper= -c "credential.helper=!gh auth git-credential" push origin main
git -c credential.helper= -c "credential.helper=!f() { echo username=$OFFICE_USER; echo \"password=\$(gh auth token --user $OFFICE_USER)\"; }; f" push kantor main

echo "== 6/6 GitHub Pages run (publishes only when public/ changed)"
gh run list -R "$PAGES_REPO" -L 2 || true
echo "deploy-all: done."
