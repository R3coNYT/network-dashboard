# NetDashboard

Dashboard personnel full-stack pour centraliser tous vos services réseau (homelab, serveurs, apps web…).  
Interface glassmorphism dark, drag & drop, persistance SQLite, servi par nginx en HTTPS.

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
network-dashboard/
├── index.html          # Interface principale
├── styles.css          # Design glassmorphism dark
├── script.js           # Logique frontend + appels API
├── server.py           # API REST Flask
├── requirements.txt    # Dépendances Python
├── install.sh          # Installation complète (root)
└── update.sh           # Mise à jour (root)
```

---

## Installation

> Requiert : Linux (Debian/Ubuntu ou RHEL/CentOS/Fedora), exécution en **root**.

```bash
git clone https://github.com/R3coNYT/network-dashboard.git
cd network-dashboard
sudo bash install.sh
```

`install.sh` effectue automatiquement :

1. Installation de **nginx** (si absent)
2. Installation de **Python 3** + virtualenv + dépendances
3. Génération d'un **certificat SSL auto-signé** (RSA 4096, SAN localhost + IP)
4. Configuration **nginx** :
   - Port 80 → redirection 301 HTTPS
   - Port 443 → fichiers statiques servis directement + `/api/` proxifié vers Flask
   - Headers de sécurité (HSTS, X-Frame-Options, CSP…)
5. Création d'un **service systemd** `netdashboard` (Flask, démarrage automatique)
6. Tâche **cron** de renouvellement du certificat (1er et 15 de chaque mois à 03h00)

À la fin du script, l'URL d'accès est affichée :

```
Accès HTTPS : https://<IP_DU_SERVEUR>
```

> Le navigateur affichera un avertissement de sécurité (certificat auto-signé) — acceptez l'exception pour accéder au site.

---

## Mise à jour

```bash
cd network-dashboard
git pull
sudo bash update.sh
```

`update.sh` met à jour les dépendances Python, revalide la configuration nginx, recharge nginx et redémarre Flask.

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
