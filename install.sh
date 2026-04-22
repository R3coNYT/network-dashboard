#!/usr/bin/env bash
# ================================================================
# NetDashboard — install.sh
# Configure nginx + Flask avec SSL auto-signé
# Usage : sudo bash install.sh
# Compatible : Debian/Ubuntu, RHEL/CentOS/Fedora
# ================================================================
set -euo pipefail

# ── Root check ───────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    echo "[!] Ce script doit être exécuté en tant que root : sudo bash install.sh"
    exit 1
fi

# ── Variables ─────────────────────────────────────────────────────
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/network-dashboard"
APP_NAME="netdashboard"

# Determine the user who called sudo (to run the service under)
SERVICE_USER="${SUDO_USER:-}"
if [[ -z "$SERVICE_USER" || "$SERVICE_USER" == "root" ]]; then
    SERVICE_USER="www-data"
fi

SSL_DIR="/etc/ssl/${APP_NAME}"
NGINX_AVAIL="/etc/nginx/sites-available/${APP_NAME}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${APP_NAME}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"
RENEW_SCRIPT="/usr/local/bin/${APP_NAME}-renew-cert.sh"
VENV_DIR="${APP_DIR}/.venv"
LOG_DIR="/var/log/${APP_NAME}"
CERT_DAYS=15   # Days before the self-signed cert expires

# Terminal colours
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[*]${NC} $*"; }
success() { echo -e "${GREEN}[✓]${NC} $*"; }
warn()    { echo -e "${YELLOW}[!]${NC} $*"; }
die()     { echo -e "${RED}[✗]${NC} $*"; exit 1; }

# ── Detect package manager ────────────────────────────────────────
if   command -v apt-get &>/dev/null; then PM="apt"
elif command -v dnf     &>/dev/null; then PM="dnf"
elif command -v yum     &>/dev/null; then PM="yum"
else die "Aucun gestionnaire de paquets supporté (apt/dnf/yum)."; fi

pkg_install() {
    case "$PM" in
        apt)    apt-get install -y -qq "$@" ;;
        dnf)    dnf install -y -q    "$@" ;;
        yum)    yum install -y -q    "$@" ;;
    esac
}

info "Gestionnaire de paquets : ${PM}"
info "Répertoire source : ${SOURCE_DIR}"
info "Répertoire d'installation : ${APP_DIR}"
info "Utilisateur du service : ${SERVICE_USER}"
echo ""

# ── nginx ─────────────────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
    info "Installation de nginx..."
    [[ "$PM" == "apt" ]] && apt-get update -qq
    pkg_install nginx
    success "nginx installé"
else
    success "nginx déjà présent : $(nginx -v 2>&1 | head -1)"
fi

# ── Copie des fichiers dans /opt/network-dashboard ───────────────
info "Copie des fichiers vers ${APP_DIR}..."
mkdir -p "$APP_DIR"
rsync -a --exclude='.git' --exclude='.venv' --exclude='netdashboard.db' \
    "${SOURCE_DIR}/" "${APP_DIR}/"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR" 2>/dev/null || true
success "Fichiers copiés dans ${APP_DIR}"

# ── Python 3 + venv ───────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    info "Installation de Python 3..."
    [[ "$PM" == "apt" ]] && apt-get update -qq
    case "$PM" in
        apt)      pkg_install python3 python3-pip python3-venv ;;
        dnf|yum)  pkg_install python3 python3-pip ;;
    esac
    success "Python 3 installé"
else
    success "Python 3 déjà présent : $(python3 --version)"
fi

# Ensure the venv module is available
if ! python3 -c "import venv" &>/dev/null; then
    [[ "$PM" == "apt" ]] && pkg_install python3-venv
fi

info "Création de l'environnement virtuel Python..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "${APP_DIR}/requirements.txt"
success "Dépendances Python installées"

# ── openssl ────────────────────────────────────────────────────────
if ! command -v openssl &>/dev/null; then
    pkg_install openssl
fi

# ── SSL certificate ────────────────────────────────────────────────
mkdir -p "$SSL_DIR"
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"

info "Génération du certificat SSL auto-signé (${CERT_DAYS} jours)..."

SSL_CNF="$(mktemp /tmp/${APP_NAME}_ssl_XXXX.cnf)"
cat > "$SSL_CNF" <<CNF
[req]
distinguished_name = req_dn
x509_extensions    = v3_req
prompt             = no

[req_dn]
CN = ${APP_NAME}
O  = NetDashboard
C  = FR

[v3_req]
keyUsage         = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @sans

[sans]
DNS.1 = localhost
DNS.2 = ${APP_NAME}.local
IP.1  = 127.0.0.1
IP.2  = ${SERVER_IP}
CNF

openssl req -x509 -newkey rsa:4096 \
    -keyout "${SSL_DIR}/key.pem" \
    -out    "${SSL_DIR}/cert.pem" \
    -days   "${CERT_DAYS}" \
    -nodes \
    -config "${SSL_CNF}" \
    2>/dev/null

rm -f "$SSL_CNF"
chmod 600 "${SSL_DIR}/key.pem"
chmod 644 "${SSL_DIR}/cert.pem"
success "Certificat SSL généré (${SSL_DIR})"

# ── nginx configuration ────────────────────────────────────────────
info "Écriture de la configuration nginx..."

# Create sites-available / sites-enabled dirs if they don't exist
# (needed on some minimal distros)
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

cat > "$NGINX_AVAIL" <<NGINX
# NetDashboard — nginx configuration
# Généré par install.sh le $(date '+%Y-%m-%d %H:%M:%S')

# ── HTTP → HTTPS redirect ─────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name _;
    return 301 https://\$host\$request_uri;
}

# ── HTTPS ─────────────────────────────────────────────────────────
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name _;

    ssl_certificate     ${SSL_DIR}/cert.pem;
    ssl_certificate_key ${SSL_DIR}/key.pem;

    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305;
    ssl_prefer_server_ciphers off;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 1d;

    # Security headers
    add_header X-Frame-Options        "SAMEORIGIN"           always;
    add_header X-Content-Type-Options "nosniff"              always;
    add_header X-XSS-Protection       "1; mode=block"        always;
    add_header Referrer-Policy        "strict-origin-when-cross-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    root  ${APP_DIR};
    index index.html;

    # ── Static: HTML ──────────────────────────────────────────────
    location = / {
        try_files /index.html =404;
        add_header Cache-Control "no-cache";
    }

    location ~* \.html\$ {
        try_files \$uri =404;
        add_header Cache-Control "no-cache";
    }

    # ── Static: CSS ───────────────────────────────────────────────
    location ~* \.css\$ {
        try_files \$uri =404;
        add_header Cache-Control "public, max-age=86400";
    }

    # ── Static: JS ────────────────────────────────────────────────
    location ~* \.js\$ {
        try_files \$uri =404;
        add_header Cache-Control "public, max-age=86400";
    }

    # ── API proxy → Flask ─────────────────────────────────────────
    location /api/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout    30s;
        proxy_connect_timeout  5s;
    }

    # ── Block sensitive files ─────────────────────────────────────
    location ~ /\.(git|env|venv|db|py|sh|yaml|yml|md)\$ {
        deny all;
        return 404;
    }

    location ~* \.(txt)\$ {
        deny all;
        return 404;
    }

    location = /favicon.ico { log_not_found off; access_log off; }
    location = /robots.txt  { log_not_found off; access_log off; }

    access_log /var/log/nginx/${APP_NAME}_access.log;
    error_log  /var/log/nginx/${APP_NAME}_error.log warn;
}
NGINX

# Enable site
ln -sf "$NGINX_AVAIL" "$NGINX_ENABLED"

# Disable default site if present
if [[ -f /etc/nginx/sites-enabled/default ]]; then
    rm -f /etc/nginx/sites-enabled/default
    warn "Site nginx 'default' désactivé"
fi

# Validate nginx config
nginx -t 2>/dev/null && success "Configuration nginx valide" || die "Erreur nginx — corrigez la config avant de continuer."

# ── Log directory ──────────────────────────────────────────────────
mkdir -p "$LOG_DIR"
chown "${SERVICE_USER}:${SERVICE_USER}" "$LOG_DIR" 2>/dev/null || true

# ── systemd service (Flask) ───────────────────────────────────────
info "Création du service systemd ${APP_NAME}..."

cat > "$SERVICE_FILE" <<SERVICE
[Unit]
Description=NetDashboard Flask API
After=network.target
Wants=network-online.target

[Service]
Type=simple
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
ExecStart=${VENV_DIR}/bin/python ${APP_DIR}/server.py
Restart=on-failure
RestartSec=5
StandardOutput=append:${LOG_DIR}/flask.log
StandardError=append:${LOG_DIR}/flask-error.log
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --quiet "${APP_NAME}.service"
systemctl restart "${APP_NAME}.service"
success "Service ${APP_NAME} démarré"

# ── Start / reload nginx ──────────────────────────────────────────
if systemctl is-active --quiet nginx; then
    systemctl reload nginx
    success "nginx rechargé"
else
    systemctl enable --quiet nginx
    systemctl start nginx
    success "nginx démarré"
fi

# ── Certificate renewal script ────────────────────────────────────
info "Création du script de renouvellement SSL..."

cat > "$RENEW_SCRIPT" <<'RENEW'
#!/usr/bin/env bash
# NetDashboard — renouvellement du certificat SSL auto-signé
# Appelé par cron toutes les 2 semaines
set -euo pipefail

APP_NAME="netdashboard"
SSL_DIR="/etc/ssl/${APP_NAME}"
CERT_DAYS=15
LOG="/var/log/${APP_NAME}/cert-renewal.log"
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Début du renouvellement SSL..." >> "$LOG"

SSL_CNF="$(mktemp /tmp/${APP_NAME}_renew_XXXX.cnf)"
cat > "$SSL_CNF" <<CNF
[req]
distinguished_name = req_dn
x509_extensions    = v3_req
prompt             = no

[req_dn]
CN = ${APP_NAME}
O  = NetDashboard
C  = FR

[v3_req]
keyUsage         = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectAltName   = @sans

[sans]
DNS.1 = localhost
DNS.2 = ${APP_NAME}.local
IP.1  = 127.0.0.1
IP.2  = ${SERVER_IP}
CNF

openssl req -x509 -newkey rsa:4096 \
    -keyout "${SSL_DIR}/key.pem" \
    -out    "${SSL_DIR}/cert.pem" \
    -days   "${CERT_DAYS}" \
    -nodes \
    -config "${SSL_CNF}" \
    2>/dev/null

rm -f "$SSL_CNF"
chmod 600 "${SSL_DIR}/key.pem"
chmod 644 "${SSL_DIR}/cert.pem"

nginx -s reload

echo "$(date '+%Y-%m-%d %H:%M:%S') — Certificat renouvelé (valide ${CERT_DAYS} jours)." >> "$LOG"
RENEW

chmod +x "$RENEW_SCRIPT"
success "Script de renouvellement : ${RENEW_SCRIPT}"

# ── cron.d entry (1er et 15 de chaque mois à 03h00 = ~toutes les 2 semaines) ──
CRON_FILE="/etc/cron.d/${APP_NAME}-cert"
cat > "$CRON_FILE" <<CRON
# NetDashboard — renouvellement SSL toutes les 2 semaines
# Lance le 1er et le 15 de chaque mois à 03h00
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 3 1,15 * * root ${RENEW_SCRIPT} >> /var/log/${APP_NAME}/cert-renewal.log 2>&1
CRON
chmod 644 "$CRON_FILE"
success "Tâche cron configurée (1er et 15 du mois à 03h00)"

# ── Summary ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   NetDashboard installé avec succès !${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════${NC}"
echo ""
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"
echo -e "  Accès HTTPS      : ${BLUE}https://${SERVER_IP}${NC}"
echo -e "  App installée    : ${APP_DIR}"
echo -e "  Logs Flask       : ${LOG_DIR}/flask.log"
echo -e "  Logs nginx       : /var/log/nginx/${APP_NAME}_access.log"
echo -e "  Certificat       : ${SSL_DIR}/cert.pem"
echo -e "  Renouvellement cert : 1er et 15 du mois à 03h00"
echo ""
echo -e "  ${YELLOW}Note : certificat auto-signé — votre navigateur affichera"
echo -e "  un avertissement de sécurité. Acceptez l'exception pour accéder au site.${NC}"
echo ""
