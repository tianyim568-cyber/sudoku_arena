#!/bin/bash
set -e

echo "=== Sudoku Arena Deployment ==="
echo "Starting deployment on $(hostname)..."

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

# Create database and user
echo "[4/8] Setting up database..."
sudo -u postgres psql -c "CREATE USER sudoku_user WITH PASSWORD 'sudoku_password';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE sudoku_arena OWNER sudoku_user;" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE sudoku_arena TO sudoku_user;" 2>/dev/null || true

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

# Create .env
cat > /opt/sudoku-arena/server/.env <<EOF
NODE_ENV=production
JWT_SECRET=${JWT_SECRET}
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=sudoku_arena
PG_USER=sudoku_user
PG_PASSWORD=sudoku_password
PORT=3001
CORS_ORIGINS=http://39.96.84.142
JWT_EXPIRES_IN=24h
PG_SSL=false
EOF

# Setup Nginx
echo "[8/8] Configuring Nginx..."
cp /opt/sudoku-arena/deploy/nginx-sudoku-arena.conf /etc/nginx/sites-available/sudoku-arena
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
echo "Visit: http://39.96.84.142"
echo ""
echo "Useful commands:"
echo "  systemctl status sudoku-arena   — check app status"
echo "  journalctl -u sudoku-arena -f   — view logs"
echo "  systemctl restart sudoku-arena  — restart app"
