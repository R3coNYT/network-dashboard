#!/usr/bin/env bash
# ================================================================
# NetDashboard — update.sh
# Updates Python dependencies, reloads nginx and restarts Flask.
# Usage: sudo bash update.sh
# ================================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "[!] This script must be run as root: sudo bash update.sh"
    exit 1
fi

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/network-dashboard"
APP_NAME="netdashboard"
VENV_DIR="${APP_DIR}/.venv"
LOG_DIR="/var/log/${APP_NAME}"

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
[[ ! -d "$APP_DIR" ]]  && { warn "${APP_DIR} not found — run install.sh first."; exit 1; }
[[ ! -d "$VENV_DIR" ]] && { warn "Virtualenv missing — run install.sh first."; exit 1; }

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
    info "Syncing files to ${APP_DIR}..."
    rsync -a --exclude='.git' --exclude='.venv' --exclude='netdashboard.db' --exclude='public_ip.db' --exclude='uploads/' \
        "${SOURCE_DIR}/" "${APP_DIR}/"
    chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR" 2>/dev/null || true
    success "Files synced to ${APP_DIR}"
else
    warn "rsync not found — manual copy to ${APP_DIR} required"
fi

# ── Python dependencies ───────────────────────────────────────────
if [[ -f "${APP_DIR}/requirements.txt" ]]; then
    info "Updating Python dependencies..."
    "$VENV_DIR/bin/pip" install --quiet --upgrade -r "${APP_DIR}/requirements.txt"
    success "Python dependencies up to date"
fi

# ── nginx ─────────────────────────────────────────────────────────
info "Validating nginx configuration..."
if nginx -t 2>/dev/null; then
    success "nginx configuration valid"
    systemctl reload nginx
    success "nginx reloaded"
else
    warn "Error in nginx configuration — reload aborted. Fix it and re-run."
    exit 1
fi

# ── Flask service ─────────────────────────────────────────────────
info "Restarting Flask service (${APP_NAME})..."
if systemctl is-enabled --quiet "${APP_NAME}.service" 2>/dev/null; then
    systemctl restart "${APP_NAME}.service"
    success "Service ${APP_NAME} restarted"
else
    warn "Service ${APP_NAME} not found — run install.sh to register it."
fi

# ── Self-heal log dir + cron jobs ─────────────────────────────────
# The cron.d files embed SERVICE_USER at generation time. If it ever
# changes (e.g. after a manual chown fix) they'd silently keep running
# — and failing — as the old user. Regenerate them here so they always
# match the current SERVICE_USER and log directory ownership.
mkdir -p "$LOG_DIR"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$LOG_DIR" 2>/dev/null || true

RENEW_SCRIPT="/usr/local/bin/${APP_NAME}-renew-cert.sh"
if [[ -f "$RENEW_SCRIPT" ]]; then
    cat > "/etc/cron.d/${APP_NAME}-cert" <<CRON
# NetDashboard — SSL renewal every 2 weeks
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 3 1,15 * * root ${RENEW_SCRIPT} >> ${LOG_DIR}/cert-renewal.log 2>&1
CRON
    chmod 644 "/etc/cron.d/${APP_NAME}-cert"
fi

if [[ -f "${APP_DIR}/check_public_ip.py" ]]; then
    cat > "/etc/cron.d/${APP_NAME}-public-ip" <<CRON
# NetDashboard — public IP check 2x/day (00:00 and 12:00)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 0,12 * * * ${SERVICE_USER} ${VENV_DIR}/bin/python ${APP_DIR}/check_public_ip.py >> ${LOG_DIR}/public-ip.log 2>&1
CRON
    chmod 644 "/etc/cron.d/${APP_NAME}-public-ip"
fi
success "Cron jobs re-synced with service user '${SERVICE_USER}'"

# ── Self-heal executable bit ──────────────────────────────────────
# Ensure update.sh/install.sh stay executable even if a future git
# operation (pull/reset/checkout) resets the mode bit.
chmod +x "${APP_DIR}/update.sh" "${APP_DIR}/install.sh" 2>/dev/null || true

echo ""
success "Update complete!"
