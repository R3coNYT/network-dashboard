#!/usr/bin/env bash
# ================================================================
# NetDashboard — update.sh
# Met à jour les dépendances Python, recharge nginx et redémarre Flask.
# Usage : sudo bash update.sh
# ================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "[!] Ce script doit être exécuté en tant que root : sudo bash update.sh"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_NAME="netdashboard"
VENV_DIR="${SCRIPT_DIR}/.venv"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[*]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }

# ── Sanity checks ─────────────────────────────────────────────────
[[ ! -f "${SCRIPT_DIR}/server.py" ]]      && warn "server.py introuvable — l'installation a peut-être échoué."
[[ ! -d "$VENV_DIR" ]]                    && warn "Virtualenv absent — relancez install.sh."

# ── Python dependencies ───────────────────────────────────────────
if [[ -f "${SCRIPT_DIR}/requirements.txt" && -d "$VENV_DIR" ]]; then
    info "Mise à jour des dépendances Python..."
    "$VENV_DIR/bin/pip" install --quiet --upgrade -r "${SCRIPT_DIR}/requirements.txt"
    success "Dépendances Python à jour"
fi

# ── Static files: nothing to copy — nginx serves from SCRIPT_DIR directly ──
info "Fichiers statiques (index.html, styles.css, script.js) en place dans : ${SCRIPT_DIR}"

# ── nginx ─────────────────────────────────────────────────────────
info "Validation de la configuration nginx..."
if nginx -t 2>/dev/null; then
    success "Configuration nginx valide"
    systemctl reload nginx
    success "nginx rechargé"
else
    warn "Erreur dans la configuration nginx — rechargement annulé. Corrigez puis relancez."
    exit 1
fi

# ── Flask service ─────────────────────────────────────────────────
info "Redémarrage du service Flask (${APP_NAME})..."
if systemctl is-enabled --quiet "${APP_NAME}.service" 2>/dev/null; then
    systemctl restart "${APP_NAME}.service"
    success "Service ${APP_NAME} redémarré"
else
    warn "Service ${APP_NAME} non trouvé — relancez install.sh pour l'enregistrer."
fi

echo ""
success "Mise à jour terminée !"
