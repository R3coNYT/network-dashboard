#!/usr/bin/env python3
"""NetDashboard — Flask API backend with SQLite persistence."""

import os
import uuid
import sqlite3
import logging
from flask import Flask, request, jsonify, send_from_directory

# ── Configuration ────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DB_PATH    = os.path.join(BASE_DIR, 'netdashboard.db')
STATIC_DIR = BASE_DIR

app = Flask(__name__, static_folder=STATIC_DIR)
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
log = logging.getLogger('netdashboard')

# ── Database ──────────────────────────────────────────────────────

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA foreign_keys = ON')
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript('''
            CREATE TABLE IF NOT EXISTS categories (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                color        TEXT NOT NULL DEFAULT '#6366f1',
                is_protected INTEGER NOT NULL DEFAULT 0,
                sort_order   INTEGER NOT NULL DEFAULT 0,
                created_at   TEXT NOT NULL DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS apps (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                url         TEXT NOT NULL,
                port        TEXT,
                category_id TEXT NOT NULL DEFAULT 'uncategorized',
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                FOREIGN KEY (category_id) REFERENCES categories(id) ON UPDATE CASCADE
            );

            INSERT OR IGNORE INTO categories (id, name, color, is_protected, sort_order)
            VALUES ('uncategorized', 'Non classé', '#64748b', 1, 0);
        ''')
        conn.commit()
    log.info('Database ready at %s', DB_PATH)


def row_to_dict(row):
    return dict(row) if row else None


def new_id(prefix=''):
    return prefix + uuid.uuid4().hex[:12]

# ── Categories ────────────────────────────────────────────────────

@app.route('/api/categories', methods=['GET'])
def api_get_categories():
    with get_db() as conn:
        rows = conn.execute(
            'SELECT * FROM categories ORDER BY is_protected DESC, sort_order, name'
        ).fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route('/api/categories', methods=['POST'])
def api_create_category():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    cat_id = new_id('cat')
    color  = data.get('color', '#6366f1')
    with get_db() as conn:
        conn.execute(
            'INSERT INTO categories (id, name, color, is_protected) VALUES (?, ?, ?, 0)',
            (cat_id, name, color)
        )
        conn.commit()
        row = conn.execute('SELECT * FROM categories WHERE id = ?', (cat_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route('/api/categories/<cat_id>', methods=['DELETE'])
def api_delete_category(cat_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM categories WHERE id = ?', (cat_id,)).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        if row['is_protected']:
            return jsonify({'error': 'Cannot delete a protected category'}), 403
        moved = conn.execute(
            'SELECT COUNT(*) FROM apps WHERE category_id = ?', (cat_id,)
        ).fetchone()[0]
        conn.execute(
            "UPDATE apps SET category_id = 'uncategorized' WHERE category_id = ?", (cat_id,)
        )
        conn.execute('DELETE FROM categories WHERE id = ?', (cat_id,))
        conn.commit()
    return jsonify({'ok': True, 'moved': moved})

# ── Apps ──────────────────────────────────────────────────────────

@app.route('/api/apps', methods=['GET'])
def api_get_apps():
    with get_db() as conn:
        rows = conn.execute('SELECT * FROM apps ORDER BY created_at').fetchall()
    return jsonify([row_to_dict(r) for r in rows])


@app.route('/api/apps', methods=['POST'])
def api_create_app():
    data = request.get_json(silent=True) or {}
    name = (data.get('name') or '').strip()
    url  = (data.get('url')  or '').strip()
    if not name or not url:
        return jsonify({'error': 'Name and URL are required'}), 400
    app_id = new_id('app')
    port   = (str(data.get('port') or '')).strip() or None
    cat_id = (data.get('category_id') or 'uncategorized').strip()
    with get_db() as conn:
        if not conn.execute('SELECT 1 FROM categories WHERE id = ?', (cat_id,)).fetchone():
            cat_id = 'uncategorized'
        conn.execute(
            'INSERT INTO apps (id, name, url, port, category_id) VALUES (?, ?, ?, ?, ?)',
            (app_id, name, url, port, cat_id)
        )
        conn.commit()
        row = conn.execute('SELECT * FROM apps WHERE id = ?', (app_id,)).fetchone()
    return jsonify(row_to_dict(row)), 201


@app.route('/api/apps/<app_id>', methods=['PUT'])
def api_update_app(app_id):
    data = request.get_json(silent=True) or {}
    with get_db() as conn:
        existing = conn.execute('SELECT * FROM apps WHERE id = ?', (app_id,)).fetchone()
        if not existing:
            return jsonify({'error': 'Not found'}), 404
        name   = (data.get('name')        or existing['name']).strip()
        url    = (data.get('url')         or existing['url']).strip()
        port   = (str(data.get('port') or '')).strip() or None
        cat_id = (data.get('category_id') or existing['category_id']).strip()
        if not conn.execute('SELECT 1 FROM categories WHERE id = ?', (cat_id,)).fetchone():
            cat_id = 'uncategorized'
        conn.execute(
            'UPDATE apps SET name=?, url=?, port=?, category_id=? WHERE id=?',
            (name, url, port, cat_id, app_id)
        )
        conn.commit()
        row = conn.execute('SELECT * FROM apps WHERE id = ?', (app_id,)).fetchone()
    return jsonify(row_to_dict(row))


@app.route('/api/apps/<app_id>', methods=['DELETE'])
def api_delete_app(app_id):
    with get_db() as conn:
        row = conn.execute('SELECT * FROM apps WHERE id = ?', (app_id,)).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        conn.execute('DELETE FROM apps WHERE id = ?', (app_id,))
        conn.commit()
    return jsonify({'ok': True})

# ── Static files (dev fallback — nginx handles this in production) ─

@app.route('/', defaults={'path': ''})
@app.route('/<path:path>')
def serve_static(path):
    if path.startswith('api/'):
        return jsonify({'error': 'Not found'}), 404
    target = path or 'index.html'
    full   = os.path.join(STATIC_DIR, target)
    if os.path.isfile(full):
        return send_from_directory(STATIC_DIR, target)
    return send_from_directory(STATIC_DIR, 'index.html')

# ── Entry point ───────────────────────────────────────────────────

if __name__ == '__main__':
    init_db()
    app.run(host='127.0.0.1', port=5000, debug=False)
