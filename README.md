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
├── requirements.txt
├── install.sh
└── update.sh

/opt/network-dashboard/     ← install directory (copied by install.sh)
├── index.html
├── styles.css
├── script.js
├── server.py
├── requirements.txt
├── uploads/                ← uploaded app images
├── .venv/                  ← Python virtualenv
└── netdashboard.db         ← SQLite database (created on first start)
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

---

## Logs

| File | Content |
|---|---|
| `/var/log/netdashboard/flask.log` | Flask stdout |
| `/var/log/netdashboard/flask-error.log` | Flask errors |
| `/var/log/netdashboard/cert-renewal.log` | SSL renewals |
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


---

## Fonctionnalités

- **Ajout d'applications** — nom, URL/IP, port optionnel, catégorie
- **Cartes cliquables** — ouvrent l'app dans un nouvel onglet
- **Édition** — modification de toutes les infos d'une app existante
- **Catégories** — création avec couleur d'accent personnalisable
- **Drag & Drop** — déplacez une carte d'une catégorie à l'autre, la position est sauvegardée
- **Persistance SQLite** — toutes les données survivent aux redémarrages
- **API REST Flask** — backend léger, zéro ORM
- **HTTPS auto-signé** — certificat RSA 4096, renouvellement automatique toutes les 2 semaines via cron

---

## Stack

| Couche | Technologie |
|---|---|
| Frontend | HTML5 · CSS3 (glassmorphism) · JavaScript natif |
| Backend | Python 3 · Flask |
| Base de données | SQLite 3 |
| Serveur web | nginx (reverse proxy + static) |
| TLS | OpenSSL (certificat auto-signé) |

---

## Structure

```
network-dashboard/          ← dépôt Git (n'importe où)
├── index.html
├── styles.css
├── script.js
├── server.py
├── requirements.txt
├── install.sh
└── update.sh

/opt/network-dashboard/     ← répertoire d'installation (copié par install.sh)
├── index.html
├── styles.css
├── script.js
├── server.py
├── requirements.txt
├── .venv/                  ← virtualenv Python
└── netdashboard.db         ← base de données SQLite (créée au démarrage)
```

---

## Installation

> Requiert : Linux (Debian/Ubuntu ou RHEL/CentOS/Fedora), exécution en **root**.

```bash
cd /opt
sudo git clone https://github.com/R3coNYT/network-dashboard.git
cd network-dashboard
sudo bash install.sh
```

`install.sh` effectue automatiquement :

1. Copie de tous les fichiers dans **`/opt/network-dashboard/`**
2. Installation de **nginx** (si absent)
3. Installation de **Python 3** + virtualenv + dépendances
4. Génération d'un **certificat SSL auto-signé** (RSA 4096, SAN localhost + IP)
5. Configuration **nginx** :
   - Port 80 → redirection 301 HTTPS
   - Port 443 → fichiers statiques servis depuis `/opt/network-dashboard/` + `/api/` proxifié vers Flask
   - Headers de sécurité (HSTS, X-Frame-Options, CSP…)
6. Création d'un **service systemd** `netdashboard` (Flask, démarrage automatique)
7. Tâche **cron** de renouvellement du certificat (1er et 15 de chaque mois à 03h00)

À la fin du script, l'URL d'accès est affichée :

```
Accès HTTPS : https://<IP_DU_SERVEUR>
```

> Le navigateur affichera un avertissement de sécurité (certificat auto-signé) — acceptez l'exception pour accéder au site.

---

## Mise à jour

```bash
cd /opt/network-dashboard
sudo git pull
sudo bash update.sh
```

`update.sh` synchronise le dépôt vers `/opt/network-dashboard/` (via `rsync`), met à jour les dépendances Python, revalide la configuration nginx, recharge nginx et redémarre Flask.

---

## API

| Méthode | Endpoint | Description |
|---|---|---|
| `GET` | `/api/categories` | Liste toutes les catégories |
| `POST` | `/api/categories` | Crée une catégorie |
| `DELETE` | `/api/categories/:id` | Supprime (les apps sont déplacées dans "Non classé") |
| `GET` | `/api/apps` | Liste toutes les applications |
| `POST` | `/api/apps` | Crée une application |
| `PUT` | `/api/apps/:id` | Modifie une application (nom, URL, port, catégorie) |
| `DELETE` | `/api/apps/:id` | Supprime une application |

---

## Logs

| Fichier | Contenu |
|---|---|
| `/var/log/netdashboard/flask.log` | Sortie standard Flask |
| `/var/log/netdashboard/flask-error.log` | Erreurs Flask |
| `/var/log/netdashboard/cert-renewal.log` | Renouvellements SSL |
| `/var/log/nginx/netdashboard_access.log` | Accès nginx |
| `/var/log/nginx/netdashboard_error.log` | Erreurs nginx |

---

## Développement local

Sans nginx, lancez Flask directement :

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
# → http://127.0.0.1:5000
```
