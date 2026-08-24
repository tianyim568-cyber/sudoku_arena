#!/bin/bash
# Deployment script for Alibaba Cloud Lightweight Server
# Run this script as root or with sudo

set -e

PUBLIC_IP="${DEPLOY_HOST:-$(curl -s http://checkip.amazonaws.com 2>/dev/null)}"
if [ -z "$PUBLIC_IP" ]; then
  echo "!! Could not detect public IP and DEPLOY_HOST is not set." >&2
  echo "!! Re-run with: DEPLOY_HOST=your.domain.example bash $0" >&2
  exit 1
fi
DB_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=')

echo "=== Sudoku Arena Deployment Script ==="
echo "Server IP: ${PUBLIC_IP}"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Please run as root or with sudo"
  exit 1
fi

# Create swap file (important for 1 GiB servers)
echo "[1/11] Setting up swap file..."
if [ ! -f /swapfile ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "2 GB swap file created"
else
  echo "Swap file already exists, skipping"
fi

# Update system
echo "[2/11] Updating system packages..."
apt update -y && apt upgrade -y

# Install Node.js 20.x
echo "[3/11] Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
echo "Node.js $(node --version) installed"

# Install PostgreSQL
echo "[4/11] Installing PostgreSQL..."
apt install -y postgresql postgresql-contrib
systemctl start postgresql
systemctl enable postgresql

# Create database and user
echo "[5/11] Setting up database..."
sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='sudoku_user'" | grep -q 1 || sudo -u postgres psql -c "CREATE USER sudoku_user WITH PASSWORD '${DB_PASSWORD}';"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='sudoku_arena'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE sudoku_arena OWNER sudoku_user;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE sudoku_arena TO sudoku_user;"

# Install Nginx
echo "[6/11] Installing Nginx..."
apt install -y nginx
systemctl enable nginx

# Create app directory and extract
# echo "[7/11] Setting up application..."
# mkdir -p /opt/sudoku-arena

# if [ -f /tmp/sudoku-arena.tar.gz ]; then
#   echo "Extracting from /tmp/sudoku-arena.tar.gz ..."
#   tar -xzf /tmp/sudoku-arena.tar.gz -C /opt/sudoku-arena --strip-components=1
# else
#   echo "ERROR: /tmp/sudoku-arena.tar.gz not found"
#   echo "Please upload your application archive first"
#   exit 1
# fi

# Install dependencies and build client
echo "[8/11] Installing server dependencies..."
cd /opt/sudoku-arena/server
npm install --production || { echo "Server npm install failed"; exit 1; }

echo "[9/11] Building client..."
cd /opt/sudoku-arena/client
npm install || { echo "Client npm install failed"; exit 1; }
npm run build || { echo "Client build failed"; exit 1; }

# Generate strong JWT secret
JWT_SECRET=$(openssl rand -base64 48)

# Create production .env file
echo "[10/11] Configuring environment..."
cat > /opt/sudoku-arena/server/.env <<EOF
NODE_ENV=production
JWT_SECRET=${JWT_SECRET}
JWT_EXPIRES_IN=24h
PORT=3001
PG_HOST=localhost
PG_PORT=5432
PG_DATABASE=sudoku_arena
PG_USER=sudoku_user
PG_PASSWORD=${DB_PASSWORD}
CORS_ORIGINS=http://${PUBLIC_IP}
PG_SSL=false
EOF

# Configure Nginx
echo "[11/11] Configuring Nginx and starting app..."
cat > /etc/nginx/sites-available/sudoku-arena <<EOF
server {
    listen 80;
    server_name ${PUBLIC_IP};

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_types text/plain text/css text/xml text/javascript application/x-javascript application/xml+rss application/json application/javascript;

    location / {
        root /opt/sudoku-arena/client/dist;
        try_files \$uri \$uri/ /index.html;
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    location /socket.io {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location /health {
        proxy_pass http://localhost:3001/api/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        access_log off;
    }

    location ~ /\. {
        deny all;
        access_log off;
        log_not_found off;
    }
}
EOF

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
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sudoku-arena
systemctl start sudoku-arena

# Wait a moment and check status
sleep 3
echo ""
echo "=== Deployment Complete ==="
echo ""
echo "App status:"
systemctl status sudoku-arena --no-pager -l 2>/dev/null || true
echo ""
echo "Health check:"
curl -s http://localhost:3001/api/health 2>/dev/null || echo "App still starting..."
echo ""
echo "Visit: http://${PUBLIC_IP}"
echo ""
echo "Useful commands:"
echo "  systemctl status sudoku-arena   — check app status"
echo "  journalctl -u sudoku-arena -f   — view logs"
echo "  systemctl restart sudoku-arena  — restart app"
