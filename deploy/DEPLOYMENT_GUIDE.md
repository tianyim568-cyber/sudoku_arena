# Alibaba Cloud Deployment Guide - Sudoku Arena

## Prerequisites
- Alibaba Cloud Lightweight Application Server (2 vCPU / 2GB RAM minimum)
- Ubuntu 20.04 LTS or later
- SSH access to the server

## Step 1: Prepare Local Archive

On your local machine, create a deployment archive:

```bash
cd /path/to/project_3
tar -czf sudoku-arena.tar.gz \
  --exclude='node_modules' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='.env.local' \
  --exclude='*.log' \
  --exclude='.claude' \
  .
```

## Step 2: Upload to Server

```bash
scp sudoku-arena.tar.gz root@YOUR_SERVER_IP:/tmp/
```

## Step 3: Run Deployment Script

SSH into your server and run the deployment script:

```bash
ssh root@YOUR_SERVER_IP
cd /tmp
# Upload deploy.sh first, then:
chmod +x deploy.sh
./deploy.sh
```

## Step 4: Configure Database Password

Update the PostgreSQL password:

```bash
# Generate a strong password
openssl rand -base64 24

# Update PostgreSQL
sudo -u postgres psql
ALTER USER sudoku_user WITH PASSWORD 'your_new_password';
\q

# Update .env file
nano /opt/sudoku-arena/server/.env
# Update the DATABASE_URL with your new password
```

## Step 5: Install and Configure Nginx

```bash
# Install Nginx
apt install -y nginx

# Copy configuration
cp /opt/sudoku-arena/deploy/nginx-sudoku-arena.conf /etc/nginx/sites-available/sudoku-arena
ln -s /etc/nginx/sites-available/sudoku-arena /etc/nginx/sites-enabled/
rm /etc/nginx/sites-enabled/default

# Test configuration
nginx -t

# Restart Nginx
systemctl restart nginx
```

## Step 6: Set Up Systemd Service

```bash
# Copy service file
cp /opt/sudoku-arena/deploy/sudoku-arena.service /etc/systemd/system/

# Set permissions
chown -R www-data:www-data /opt/sudoku-arena

# Reload systemd
systemctl daemon-reload

# Enable and start service
systemctl enable sudoku-arena
systemctl start sudoku-arena

# Check status
systemctl status sudoku-arena
```

## Step 7: Configure Firewall

```bash
# Enable UFW (if not already enabled)
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable

# Check status
ufw status
```

## Step 8: Verify Deployment

```bash
# Check if server is running
curl http://localhost:3001/api/health

# Check via Nginx
curl http://YOUR_SERVER_IP/health

# Check logs
journalctl -u sudoku-arena -f
```

## Step 9: Set Up Domain (Optional)

1. Point your domain A record to your server IP
2. Update `server_name` in nginx config
3. Update `CORS_ORIGINS` in `/opt/sudoku-arena/server/.env`
4. Install SSL certificate:

```bash
apt install -y certbot python3-certbot-nginx
certbot --nginx -d yourdomain.com
```

## Maintenance Commands

```bash
# Restart application
systemctl restart sudoku-arena

# View logs
journalctl -u sudoku-arena -f

# Stop application
systemctl stop sudoku-arena

# Update application
cd /opt/sudoku-arena
# Upload new archive to /tmp/sudoku-arena.tar.gz
tar -xzf /tmp/sudoku-arena.tar.gz -C /opt/sudoku-arena
cd server && npm install --production
cd ../client && npm install && npm run build
systemctl restart sudoku-arena
```

## Troubleshooting

### Application won't start
```bash
# Check logs
journalctl -u sudoku-arena -n 50

# Check if port is in use
netstat -tulpn | grep 3001

# Test manually
cd /opt/sudoku-arena/server
node src/index.js
```

### Database connection issues
```bash
# Check PostgreSQL is running
systemctl status postgresql

# Test connection
sudo -u postgres psql -d sudoku_arena

# Check .env file
cat /opt/sudoku-arena/server/.env
```

### Nginx errors
```bash
# Test configuration
nginx -t

# Check logs
tail -f /var/log/nginx/error.log

# Restart
systemctl restart nginx
```

## Security Checklist

- [ ] Changed PostgreSQL password from default
- [ ] Generated strong JWT_SECRET
- [ ] Updated CORS_ORIGINS to your domain
- [ ] Configured firewall (UFW)
- [ ] Set up SSL certificate (if using domain)
- [ ] Removed default passwords from .env.example
- [ ] Verified health check endpoint works

## Performance Optimization (Optional)

### Enable Node.js clustering
Install PM2 and use ecosystem config:

```bash
npm install -g pm2
```

Create `/opt/sudoku-arena/server/ecosystem.config.js`:

```javascript
module.exports = {
  apps: [{
    name: 'sudoku-arena',
    script: 'src/index.js',
    instances: 'max',
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    }
  }]
};
```

Then run:
```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup
```
