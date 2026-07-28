#!/usr/bin/env bash
# ================================================================
# NetDashboard — install.sh
# Sets up nginx + Flask with a self-signed SSL certificate
# Usage: sudo bash install.sh
# Compatible with: Debian/Ubuntu, RHEL/CentOS/Fedora
# ================================================================
set -euo pipefail

# ── Root check ───────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
    echo "[!] This script must be run as root: sudo bash install.sh"
    exit 1
fi

# ── Variables ─────────────────────────────────────────────────────
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/opt/network-dashboard"
APP_NAME="netdashboard"

# Determine the service user. Reuse the one from a previous install (stored
# in .service_user) so reruns stay consistent no matter how the script is
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
else die "No supported package manager found (apt/dnf/yum)."; fi

pkg_install() {
    case "$PM" in
        apt)    apt-get install -y -qq "$@" ;;
        dnf)    dnf install -y -q    "$@" ;;
        yum)    yum install -y -q    "$@" ;;
    esac
}

info "Package manager: ${PM}"
info "Source directory: ${SOURCE_DIR}"
info "Install directory: ${APP_DIR}"
info "Service user: ${SERVICE_USER}"
echo ""

# ── nginx ─────────────────────────────────────────────────────────
if ! command -v nginx &>/dev/null; then
    info "Installing nginx..."
    [[ "$PM" == "apt" ]] && apt-get update -qq
    pkg_install nginx
    success "nginx installed"
else
    success "nginx already present: $(nginx -v 2>&1 | head -1)"
fi

# ── Copy files into /opt/network-dashboard ───────────────────────
info "Copying files to ${APP_DIR}..."
mkdir -p "$APP_DIR"
rsync -a --exclude='.git' --exclude='.venv' --exclude='netdashboard.db' --exclude='public_ip.db' \
    "${SOURCE_DIR}/" "${APP_DIR}/"
echo "$SERVICE_USER" > "$SERVICE_USER_FILE"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$APP_DIR" 2>/dev/null || true
success "Files copied to ${APP_DIR}"

# ── Python 3 + venv ───────────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    info "Installing Python 3..."
    [[ "$PM" == "apt" ]] && apt-get update -qq
    case "$PM" in
        apt)      pkg_install python3 python3-pip python3-venv ;;
        dnf|yum)  pkg_install python3 python3-pip ;;
    esac
    success "Python 3 installed"
else
    success "Python 3 already present: $(python3 --version)"
fi

# Ensure the venv module is available
if ! python3 -c "import venv" &>/dev/null; then
    [[ "$PM" == "apt" ]] && pkg_install python3-venv
fi

info "Creating Python virtual environment..."
python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -r "${APP_DIR}/requirements.txt"
success "Python dependencies installed"

# ── openssl ────────────────────────────────────────────────────────
if ! command -v openssl &>/dev/null; then
    pkg_install openssl
fi

# ── SSL certificate ────────────────────────────────────────────────
mkdir -p "$SSL_DIR"
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"

info "Generating self-signed SSL certificate (${CERT_DAYS} days)..."

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
success "SSL certificate generated (${SSL_DIR})"

# ── nginx configuration ──────────────────────────────
info "Writing nginx configuration..."

# Create sites-available / sites-enabled dirs if they don't exist
# (needed on some minimal distros)
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled

cat > "$NGINX_AVAIL" <<NGINX
# NetDashboard — nginx configuration
# Generated by install.sh on $(date '+%Y-%m-%d %H:%M:%S')

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

    client_max_body_size 6m;

    # Gzip compression
    gzip              on;
    gzip_vary         on;
    gzip_proxied      any;
    gzip_comp_level   6;
    gzip_min_length   1024;
    gzip_types        text/plain text/css text/javascript application/javascript
                      application/json image/svg+xml;

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
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # ── Static: JS ────────────────────────────────────────────────
    location ~* \.js\$ {
        try_files \$uri =404;
        add_header Cache-Control "public, max-age=31536000, immutable";
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
        client_max_body_size  6m;
    }

    # ── Uploaded images ──────────────────────────────────────────
    location /uploads/ {
        alias ${APP_DIR}/uploads/;
        add_header Cache-Control "public, max-age=31536000, immutable";
        add_header X-Content-Type-Options "nosniff" always;
    }

    # ── Block sensitive files ─────────────────────────────────────
    # Hidden files/dirs anywhere in the path (.git, .env, .venv...)
    location ~ /\. {
        deny all;
        return 404;
    }

    # Backend source, data and config files, regardless of position
    location ~* \.(db|py|sh|ya?ml|md|txt|cfg|ini|conf|lock)\$ {
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
    warn "nginx 'default' site disabled"
fi

# Validate nginx config
nginx -t 2>/dev/null && success "nginx configuration valid" || die "nginx error — fix the config before continuing."

# ── Log directory ───────────────────────────────────────────
mkdir -p "$LOG_DIR"
chown "${SERVICE_USER}:${SERVICE_USER}" "$LOG_DIR" 2>/dev/null || true

# ── systemd service (Flask) ────────────────────────────
info "Creating systemd service ${APP_NAME}..."

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
success "Service ${APP_NAME} started"

# ── Start / reload nginx ──────────────────────────────────────────
if systemctl is-active --quiet nginx; then
    systemctl reload nginx
    success "nginx reloaded"
else
    systemctl enable --quiet nginx
    systemctl start nginx
    success "nginx started"
fi

# ── Certificate renewal script ────────────────────────────────────
info "Creating SSL renewal script..."

cat > "$RENEW_SCRIPT" <<'RENEW'
#!/usr/bin/env bash
# NetDashboard — self-signed SSL certificate renewal
# Called by cron every 2 weeks
set -euo pipefail

APP_NAME="netdashboard"
SSL_DIR="/etc/ssl/${APP_NAME}"
CERT_DAYS=15
LOG="/var/log/${APP_NAME}/cert-renewal.log"
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"

echo "$(date '+%Y-%m-%d %H:%M:%S') — Starting SSL renewal..." >> "$LOG"

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

echo "$(date '+%Y-%m-%d %H:%M:%S') — Certificate renewed (valid for ${CERT_DAYS} days)." >> "$LOG"
RENEW

chmod +x "$RENEW_SCRIPT"
success "Renewal script: ${RENEW_SCRIPT}"

# ── cron.d entry (1st and 15th of each month at 03:00 = ~every 2 weeks) ──
CRON_FILE="/etc/cron.d/${APP_NAME}-cert"
cat > "$CRON_FILE" <<CRON
# NetDashboard — SSL renewal every 2 weeks
# Runs on the 1st and 15th of each month at 03:00
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 3 1,15 * * root ${RENEW_SCRIPT} >> /var/log/${APP_NAME}/cert-renewal.log 2>&1
CRON
chmod 644 "$CRON_FILE"
success "Cron job configured (1st and 15th of the month at 03:00)"

# ── cron.d entry: public IP check (twice a day: midnight + noon) ─
CRON_IP_FILE="/etc/cron.d/${APP_NAME}-public-ip"
cat > "$CRON_IP_FILE" <<CRON
# NetDashboard — public IP check 2x/day (00:00 and 12:00)
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
0 0,12 * * * ${SERVICE_USER} ${VENV_DIR}/bin/python ${APP_DIR}/check_public_ip.py >> /var/log/${APP_NAME}/public-ip.log 2>&1
CRON
chmod 644 "$CRON_IP_FILE"
success "Cron job configured (public IP check at 00:00 and 12:00)"

# Run it once immediately so the dashboard has data right away
sudo -u "${SERVICE_USER}" "${VENV_DIR}/bin/python" "${APP_DIR}/check_public_ip.py" >> "${LOG_DIR}/public-ip.log" 2>&1 || warn "Initial public IP check failed (will be retried by cron)."

# ── Summary ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════${NC}"
echo -e "${BOLD}${GREEN}   NetDashboard installed successfully!${NC}"
echo -e "${BOLD}${GREEN}══════════════════════════════════════════════${NC}"
echo ""
SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"
echo -e "  HTTPS access     : ${BLUE}https://${SERVER_IP}${NC}"
echo -e "  App installed    : ${APP_DIR}"
echo -e "  Flask logs       : ${LOG_DIR}/flask.log"
echo -e "  nginx logs       : /var/log/nginx/${APP_NAME}_access.log"
echo -e "  Certificate      : ${SSL_DIR}/cert.pem"
echo -e "  Cert renewal     : 1st and 15th of the month at 03:00"
echo -e "  Public IP check  : 00:00 and 12:00 (logs: ${LOG_DIR}/public-ip.log)"
echo ""
echo -e "  ${YELLOW}Note: self-signed certificate — your browser will show"
echo -e "  a security warning. Accept the exception to access the site.${NC}"
echo ""
