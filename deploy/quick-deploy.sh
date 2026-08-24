#!/bin/bash
set -e

echo "=== Sudoku Arena Deployment ==="
echo "Starting deployment on $(hostname)..."

# ── Fixes applied 2026-08-24 (ISSUE-004 + ISSUE-005) ─────────────────
# ISSUE-004: hardcoded IP replaced by DEPLOY_HOST env var (defaults to
#   the machine's own detected public IP, falls back to a placeholder
#   the operator MUST override for a real deploy).
# ISSUE-005: the fixed weak DB password `sudoku_password` is replaced
#   by a random one generated at deploy time. It is written ONLY to
#   /opt/sudoku-arena/server/.env (0600) — never echoed to stdout,
#   never committed. The pg_hba/psql commands read it from the same
#   env var so the password never appears twice in the shell history.

# Detect deploy host: environment variable wins, then the machine's
# public IP, then a placeholder that the operator MUST override.
DEPLOY_HOST="${DEPLOY_HOST:-$(curl -s http://checkip.amazonaws.com 2>/dev/null || echo 'REPLACE_WITH_YOUR_HOST')}"
if [ "$DEPLOY_HOST" = "REPLACE_WITH_YOUR_HOST" ]; then
  echo "!! DEPLOY_HOST is not set and no public IP could be detected."
  echo "!! Re-run with: DEPLOY_HOST=your.domain.example bash quick-deploy.sh"
  exit 1
fi

# Generate a random 32-byte DB password (URL-safe, no shell-hostile chars).
PG_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=' | cut -c1-24)

# Extract archive
cd /tmp
echo "[1/8] Extracting archive..."
tar -xzf sudoku-arena.tar.gz

# Install Node.js 20.x
echo "[2/8] Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node --version

# Install PostgreSQL
echo "[3/8] Installing PostgreSQL..."
apt-get install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

# Create database and user. The password is passed via psql's \set so
# it never lands in the process list — command-line args on Linux are
# world-readable via /proc for a brief window.
echo "[4/8] Setting up database..."
sudo -u postgres psql <<SQL 2>/dev/null || true
\set pg_password '$PG_PASSWORD'
CREATE USER sudoku_user WITH PASSWORD :'pg_password';
CREATE DATABASE sudoku_arena OWNER sudoku_user;
GRANT ALL PRIVILEGES ON DATABASE sudoku_arena TO sudoku_user;
SQL

# Install Nginx
echo "[5/8] Installing Nginx..."
apt-get install -y nginx
systemctl enable nginx

# Move app to /opt
echo "[6/8] Installing application..."
mkdir -p /opt/sudoku-arena
cp -r . /opt/sudoku-arena/
cd /opt/sudoku-arena/server
npm install --production

# Build client
echo "[7/8] Building client..."
cd /opt/sudoku-arena/client
npm install
npm run build

# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 48)

# Create .env with tight permissions — secrets never in a world-
# readable file.
umask 077
cat > /opt/sudoku-arena/server/.env <<EOF
NODE_ENV=production
JWT_SECRET=${JWT_SECRET}
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=sudoku_arena
PG_USER=sudoku_user
PG_PASSWORD=${PG_PASSWORD}
PORT=3001
CORS_ORIGINS=http://${DEPLOY_HOST}
JWT_EXPIRES_IN=24h
PG_SSL=false
EOF
chmod 600 /opt/sudoku-arena/server/.env
umask 022

# Setup Nginx — rewrite the server_name to the actual host before
# activating the config so we don't ship 39.96.84.142 anymore.
echo "[8/8] Configuring Nginx..."
sed -e "s/__DEPLOY_HOST__/${DEPLOY_HOST}/g" \
  /opt/sudoku-arena/deploy/nginx-sudoku-arena.conf \
  > /etc/nginx/sites-available/sudoku-arena
ln -sf /etc/nginx/sites-available/sudoku-arena /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

# Create systemd service
cat > /etc/systemd/system/sudoku-arena.service <<EOF
[Unit]
Description=Sudoku Arena Server
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/sudoku-arena/server
EnvironmentFile=/opt/sudoku-arena/server/.env
ExecStart=/usr/bin/node src/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sudoku-arena
systemctl start sudoku-arena

echo ""
echo "=== Deployment Complete ==="
echo "Visit: http://${DEPLOY_HOST}"
echo ""
echo "The DB password was written to /opt/sudoku-arena/server/.env"
echo "(mode 600, owned by root). Read it there if you need it."
echo ""
echo "Useful commands:"
echo "  systemctl status sudoku-arena   — check app status"
echo "  journalctl -u sudoku-arena -f   — view logs"
echo "  systemctl restart sudoku-arena  — restart app"
