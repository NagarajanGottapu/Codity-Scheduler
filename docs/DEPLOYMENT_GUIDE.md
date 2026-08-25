# Production Deployment Guide

The **Codity Distributed Job Scheduler** is packaged for instant deployment across cloud providers, container orchestration clusters, or standalone Virtual Private Servers (VPS).

---

## 🐳 Option 1: Docker & Docker Compose (Recommended)

The platform includes a production-ready, multi-stage [`Dockerfile`](../Dockerfile) and [`docker-compose.yml`](../docker-compose.yml).

### Steps:
1. **Build and start container in detached mode**:
   ```bash
   docker compose up -d --build
   ```

2. **Verify running containers**:
   ```bash
   docker compose ps
   ```

3. **Check live container logs**:
   ```bash
   docker compose logs -f
   ```

4. **Access the platform**:
   - Web Dashboard & API: `http://localhost:4000`
   - WebSocket Live Stream: `ws://localhost:4000/ws`

5. **Stop container**:
   ```bash
   docker compose down
   ```

---

## ☁️ Option 2: 1-Click Cloud Deployment on Render

This repository includes a [`render.yaml`](../render.yaml) blueprint specification with persistent disk storage.

### Steps:
1. Push your repository to **GitHub** or **GitLab**.
2. Log into [Render.com](https://render.com).
3. Click **New +** &rarr; **Blueprint** &rarr; Connect your repository.
4. Render will automatically detect `render.yaml`, build the application (`npm run build`), attach persistent disk storage, and deploy the live web service on a secure `https://<your-subdomain>.onrender.com` URL with SSL out of the box!

---

## 🚆 Option 3: Deploy on Railway / Fly.io

### Railway:
1. Install the Railway CLI: `npm install -g @railway/cli`
2. Run in project directory:
   ```bash
   railway login
   railway init
   railway up
   ```
3. Add a persistent volume under `/app/data` in the Railway dashboard.

### Fly.io:
1. Install `flyctl`: `brew install flyctl` or `curl -L https://fly.io/install.sh | sh`
2. Launch app:
   ```bash
   fly launch
   fly volumes create scheduler_data --size 1
   fly deploy
   ```

---

## 🖥️ Option 4: Deploy on Linux VPS (Ubuntu / Debian / AWS EC2 / DigitalOcean)

### Step 1: Install Node.js 22+ & PM2
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pm2
```

### Step 2: Clone and Build
```bash
git clone <your-repo-url> /var/www/codity-scheduler
cd /var/www/codity-scheduler
npm run install:all
npm run build
```

### Step 3: Start with PM2 Process Manager
```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

### Step 4: Configure Nginx (Reverse Proxy with WebSocket support)
Create `/etc/nginx/sites-available/scheduler`:
```nginx
server {
    listen 80;
    server_name scheduler.yourdomain.com;

    location / {
        proxy_pass http://localhost:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and reload Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/scheduler /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

## 🔒 Production Environment Variables

| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `NODE_ENV` | `production` | Enables production optimizations and disables debug traces |
| `PORT` | `4000` | HTTP and WebSocket server listening port |
| `JWT_SECRET` | *(auto-generated)* | 256-bit secret key for signing auth tokens |
