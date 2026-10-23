#!/usr/bin/env bash
# Verify and fast-forward the configured repository. Never embeds credentials or rewrites history.
set -euo pipefail
cd "$(dirname "$0")"
npm test
npm run check
if [ -n "$(git status --porcelain)" ]; then
  echo "Hay cambios sin commit. Revisa y guarda los cambios antes de publicar."
  exit 1
fi
branch="$(git branch --show-current)"
if [ -z "$branch" ]; then
  echo "Selecciona una rama antes de publicar."
  exit 1
fi
git push -u origin "$branch"
echo "Rama publicada. GitHub Pages publica la rama configurada en Settings / Pages."
