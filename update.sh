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

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/network-dashboard"
APP_NAME="netdashboard"
VENV_DIR="${APP_DIR}/.venv"

# Determine the service user. Reuse the one persisted at install time
# (.service_user) so it stays consistent no matter how this script is
# invoked (via `sudo` as a regular user, or from a root shell directly).
SERVICE_USER_FILE="${APP_DIR}/.service_user"
if [[ -f "$SERVICE_USER_FILE" ]]; then
    SERVICE_USER="$(cat "$SERVICE_USER_FILE")"
else
    SERVICE_USER="${SUDO_USER:-}"
    if [[ -z "$SERVICE_USER" || "$SERVICE_USER" == "root" ]]; then
        SERVICE_USER="www-data"
    fi
fi

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()    { echo -e "${BLUE}[*]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }

# ── Sanity checks ─────────────────────────────────────────────────
[[ ! -d "$APP_DIR" ]]  && { warn "${APP_DIR} introuvable — relancez install.sh."; exit 1; }
[[ ! -d "$VENV_DIR" ]] && { warn "Virtualenv absent — relancez install.sh."; exit 1; }

# ── Git pull ─────────────────────────────────────────────────────
if [[ -d "${SOURCE_DIR}/.git" ]]; then
    # Avoid "detected dubious ownership" when the repo is owned by a
    # different user than the one running this script (e.g. sudo as root
    # on a directory owned by your regular user).
    git config --global --add safe.directory "${SOURCE_DIR}"
    # Ignore file-mode-only changes (e.g. a stray `chmod +x update.sh`),
    # which git would otherwise treat as a local modification and block the pull.
    git -C "${SOURCE_DIR}" config core.fileMode false
    info "Pulling latest changes from Git..."
    if ! git -C "${SOURCE_DIR}" pull; then
        warn "git pull failed — discarding local changes in ${SOURCE_DIR} and retrying..."
        git -C "${SOURCE_DIR}" reset --hard HEAD
        git -C "${SOURCE_DIR}" pull
    fi
    success "Repository up to date"
else
    warn "No .git directory found in ${SOURCE_DIR} — skipping git pull."
fi

# ── Sync source → /opt/network-dashboard ─────────────────────────
if command -v rsync &>/dev/null; then
    info "Synchronisation des fichiers vers ${APP_DIR}..."
    rsync -a --exclude='.git' --exclude='.venv' --exclude='netdashboard.db' --exclude='public_ip.db' --exclude='uploads/' \
        "${SOURCE_DIR}/" "${APP_DIR}/"
    chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR" 2>/dev/null || true
    success "Fichiers synchronisés dans ${APP_DIR}"
else
    warn "rsync introuvable — copie manuelle requise vers ${APP_DIR}"
fi

# ── Python dependencies ───────────────────────────────────────────
if [[ -f "${APP_DIR}/requirements.txt" ]]; then
    info "Mise à jour des dépendances Python..."
    "$VENV_DIR/bin/pip" install --quiet --upgrade -r "${APP_DIR}/requirements.txt"
    success "Dépendances Python à jour"
fi

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
