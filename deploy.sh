#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════
#  BernAudio — Publicador automático en GitHub Pages
#  Uso:  bash deploy.sh
#  Hace TODO: crea el repo "bernaudio", sube el código y
#  activa GitHub Pages. Solo pide tu usuario y un token PAT.
# ═══════════════════════════════════════════════════════════════
set -euo pipefail
cd "$(dirname "$0")"

REPO_NAME="bernaudio"
BRANCH="main"
API="https://api.github.com"

echo ""
echo "  🎛️  BernAudio → GitHub Pages"
echo "  ─────────────────────────────────────────────"

# ── 1. Usuario ────────────────────────────────────────────────
read -rp "  Tu usuario de GitHub: " GH_USER
if [ -z "$GH_USER" ]; then echo "  ✗ Usuario requerido"; exit 1; fi

# ── 2. Token (oculto mientras se escribe) ─────────────────────
echo "  → Crea un token en: https://github.com/settings/tokens/new?scopes=repo&description=BernAudio"
read -rsp "  Pega tu token PAT (entrada oculta): " GH_TOKEN; echo ""
if [ -z "$GH_TOKEN" ]; then echo "  ✗ Token requerido"; exit 1; fi
AUTH="Authorization: token $GH_TOKEN"

# ── 3. Validar token ──────────────────────────────────────────
LOGIN=$(curl -sf -H "$AUTH" "$API/user" | grep -m1 '"login"' | cut -d'"' -f4) || {
  echo "  ✗ Token inválido o sin conexión. Revísalo e inténtalo de nuevo."; exit 1; }
echo "  ✓ Autenticado como $LOGIN"

# ── 4. Crear el repo si no existe ─────────────────────────────
CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "$AUTH" "$API/repos/$GH_USER/$REPO_NAME")
if [ "$CODE" = "404" ]; then
  echo "  → Creando repositorio $REPO_NAME…"
  curl -sf -X POST -H "$AUTH" "$API/user/repos" -d "{
    \"name\":\"$REPO_NAME\",
    \"description\":\"Medición y alineación de audio profesional en tiempo real — BernAudio\",
    \"homepage\":\"https://$GH_USER.github.io/$REPO_NAME/\",
    \"private\":false
  }" > /dev/null
  echo "  ✓ Repositorio creado (público)"
else
  echo "  ✓ El repositorio ya existe (HTTP $CODE)"
fi

# ── 5. Commit + push ──────────────────────────────────────────
git init -b "$BRANCH" >/dev/null 2>&1 || git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"
git add -A
git commit -m "BernAudio — landing oficial (deploy automático)" >/dev/null 2>&1 && echo "  ✓ Commit creado" || echo "  • Sin cambios nuevos que commitear"
git remote remove origin >/dev/null 2>&1 || true
git remote add origin "https://$GH_USER:$GH_TOKEN@github.com/$GH_USER/$REPO_NAME.git"
echo "  → Subiendo código…"
git push -u origin "$BRANCH" --force   # fuerza primera subida aunque el repo se creara con README
# Quitamos el token del remote por seguridad (queda solo en este push)
git remote set-url origin "https://github.com/$GH_USER/$REPO_NAME.git"
echo "  ✓ Código en GitHub (token ya eliminado del remote)"

# ── 6. Activar GitHub Pages ───────────────────────────────────
PCODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST -H "$AUTH" \
  "$API/repos/$GH_USER/$REPO_NAME/pages" \
  -d "{\"source\":{\"branch\":\"$BRANCH\",\"path\":\"/\"}}")
case "$PCODE" in
  201|409) echo "  ✓ GitHub Pages activado (rama $BRANCH, carpeta /)" ;;
  *)       echo "  • Pages respondió HTTP $PCODE — si no se activó, hazlo en Settings → Pages → Branch: $BRANCH / (root)" ;;
esac

echo ""
echo "  🎉 LISTO. En 1–2 minutos tu landing estará viva en:"
echo "     https://$GH_USER.github.io/$REPO_NAME/"
echo ""
