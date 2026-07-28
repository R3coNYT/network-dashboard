# NetDashboard

A full-stack personal dashboard to centralize all your network services (homelab, servers, web apps…).  
Glassmorphism dark UI, drag & drop, SQLite persistence, served by nginx over HTTPS.

---

## Features

- **Add applications** — name, URL/IP, optional port, category, description, image
- **Clickable cards** — open the app in a new tab
- **Edit** — update any field of an existing app
- **Categories** — create with a customizable accent color, rename, reorder
- **Drag & drop** — move cards between categories or reorder categories; positions are persisted
- **SQLite persistence** — all data survives restarts
- **Flask REST API** — lightweight backend, no ORM
- **Self-signed HTTPS** — RSA 4096 certificate, auto-renewed every 2 weeks via cron
- **Image upload** — upload app icons directly from your device (max 5 MB)
- **Public IP monitoring** — checks your public IP twice a day (00:00 and 12:00), logs every change, and flashes a red alert in the header when the IP differs from the last one you confirmed

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | HTML5 · CSS3 (glassmorphism) · Vanilla JavaScript |
| Backend | Python 3 · Flask |
| Database | SQLite 3 |
| Web server | nginx (reverse proxy + static files) |
| TLS | OpenSSL (self-signed certificate) |

---

## Structure

```
network-dashboard/          ← Git repository (anywhere on disk)
├── index.html
├── styles.css
├── script.js
├── server.py
├── check_public_ip.py
├── requirements.txt
├── install.sh
└── update.sh

/opt/network-dashboard/     ← install directory (copied by install.sh)
├── index.html
├── styles.css
├── script.js
├── server.py
├── check_public_ip.py
├── requirements.txt
├── uploads/                ← uploaded app images
├── .venv/                  ← Python virtualenv
├── netdashboard.db         ← SQLite database (created on first start)
└── public_ip.db            ← Public IP history (created by check_public_ip.py)
```

---

## Installation

> Requires: Linux (Debian/Ubuntu or RHEL/CentOS/Fedora), must run as **root**.

```bash
cd /opt
sudo git clone https://github.com/R3coNYT/network-dashboard.git
cd network-dashboard
sudo bash install.sh
```

`install.sh` automatically:

1. Copies all files to **`/opt/network-dashboard/`**
2. Installs **nginx** (if missing)
3. Installs **Python 3** + virtualenv + dependencies
4. Generates a **self-signed SSL certificate** (RSA 4096, SAN localhost + IP)
5. Configures **nginx**:
   - Port 80 → 301 HTTPS redirect
   - Port 443 → static files served from `/opt/network-dashboard/` + `/api/` proxied to Flask (max body 6 MB)
   - Security headers (HSTS, X-Frame-Options, CSP…)
6. Creates a **systemd service** `netdashboard` (Flask, auto-start on boot)
7. Sets up a **cron job** for certificate renewal (1st and 15th of each month at 03:00)
8. Sets up a **cron job** for public IP monitoring (00:00 and 12:00 daily) and runs an initial check immediately

At the end of the script, the access URL is displayed:

```
HTTPS access: https://<SERVER_IP>
```

> The browser will show a security warning (self-signed certificate) — accept the exception to access the site.

---

## Update

```bash
cd /path/to/network-dashboard
sudo git pull
sudo bash update.sh
```

`update.sh` syncs the repository to `/opt/network-dashboard/` (via `rsync`, preserving the database and uploaded images), updates Python dependencies, validates and reloads nginx, then restarts Flask.

---

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/categories` | List all categories |
| `POST` | `/api/categories` | Create a category |
| `PUT` | `/api/categories/reorder` | Reorder categories |
| `PUT` | `/api/categories/:id` | Rename a category |
| `DELETE` | `/api/categories/:id` | Delete (apps are moved to "Uncategorized") |
| `GET` | `/api/apps` | List all applications |
| `POST` | `/api/apps` | Create an application |
| `PUT` | `/api/apps/:id` | Update an application |
| `PUT` | `/api/apps/reorder` | Reorder apps (and/or move between categories) |
| `DELETE` | `/api/apps/:id` | Delete an application |
| `POST` | `/api/upload` | Upload an image (multipart/form-data, max 5 MB) |
| `GET` | `/api/public-ip` | Current public IP, iteration count, last fetch time and confirmation status |
| `POST` | `/api/public-ip/confirm` | Confirm the current public IP as trusted (body: `{"ip": "1.2.3.4"}`) |

---

## Logs

| File | Content |
|---|---|
| `/var/log/netdashboard/flask.log` | Flask stdout |
| `/var/log/netdashboard/flask-error.log` | Flask errors |
| `/var/log/netdashboard/cert-renewal.log` | SSL renewals |
| `/var/log/netdashboard/public-ip.log` | Public IP checks (cron) |
| `/var/log/nginx/netdashboard_access.log` | nginx access log |
| `/var/log/nginx/netdashboard_error.log` | nginx error log |

---

## Local development

Without nginx, run Flask directly:

```bash
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python server.py
# → http://127.0.0.1:5000
```
