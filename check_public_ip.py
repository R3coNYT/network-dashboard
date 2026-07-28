#!/usr/bin/env python3
"""NetDashboard — Public IP checker.

Fetches the current public IP address (via a bash `curl` command) and logs
it into public_ip.db. Meant to be run twice a day (00:00 and 12:00) by cron —
see install.sh for the cron job definition.

Usage: python3 check_public_ip.py
"""

import os
import re
import subprocess
import sqlite3
import sys
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH  = os.path.join(BASE_DIR, 'public_ip.db')

IPV4_RE = re.compile(r'^(?:\d{1,3}\.){3}\d{1,3}$')

# Fallback chain of bash commands used to fetch the public IPv4 address.
IP_COMMANDS = [
    "curl -s -4 --max-time 5 https://api.ipify.org",
    "curl -s -4 --max-time 5 https://ifconfig.me/ip",
    "curl -s -4 --max-time 5 https://icanhazip.com",
]


def is_valid_ipv4(ip):
    if not IPV4_RE.match(ip):
        return False
    return all(0 <= int(part) <= 255 for part in ip.split('.'))


def fetch_public_ip():
    for cmd in IP_COMMANDS:
        try:
            result = subprocess.run(
                ['bash', '-c', cmd],
                capture_output=True, text=True, timeout=8
            )
            ip = result.stdout.strip()
            if result.returncode == 0 and is_valid_ipv4(ip):
                return ip
        except Exception:
            continue
    return None


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db(conn):
    conn.executescript('''
        CREATE TABLE IF NOT EXISTS public_ip (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            ip         TEXT NOT NULL UNIQUE,
            iteration  INTEGER NOT NULL DEFAULT 1,
            last_fetch TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS last_confirmed_ip (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ip TEXT NOT NULL
        );
    ''')
    conn.commit()


def record_ip(conn, ip):
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    row = conn.execute('SELECT id FROM public_ip WHERE ip = ?', (ip,)).fetchone()
    if row:
        conn.execute(
            'UPDATE public_ip SET iteration = iteration + 1, last_fetch = ? WHERE ip = ?',
            (now, ip)
        )
    else:
        conn.execute(
            'INSERT INTO public_ip (ip, iteration, last_fetch) VALUES (?, 1, ?)',
            (ip, now)
        )
    conn.commit()


def main():
    ip = fetch_public_ip()
    if not ip:
        print(f"{datetime.now():%Y-%m-%d %H:%M:%S} — ERROR: could not fetch public IP", file=sys.stderr)
        sys.exit(1)

    conn = get_db()
    try:
        init_db(conn)
        record_ip(conn, ip)
    finally:
        conn.close()

    print(f"{datetime.now():%Y-%m-%d %H:%M:%S} — Public IP recorded: {ip}")


if __name__ == '__main__':
    main()
