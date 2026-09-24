#!/usr/bin/env bash
# ==============================================================================
# Platform - Ubuntu 24.04 Production Server Bootstrap Script
# Target: 6 GB RAM / 4 vCPU / 60 GB SSD
# ==============================================================================

set -euo pipefail

echo "======================================================================"
echo "Starting Ubuntu 24.04 LTS Server Bootstrap for Platform"
echo "======================================================================"

# 1. Update and Upgrade Packages
echo "Updating APT packages..."
export DEBIAN_FRONTEND=noninteractive
apt update && apt upgrade -y
apt install -y curl wget git ufw fail2ban ca-certificates gnupg lsb-release htop jq

# 2. Configure 4GB Swap Space (Vital for 6GB RAM Stability)
if [ ! -f /swapfile ]; then
    echo "Creating 4GB Swap file for RAM buffer..."
    fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab

    # Optimize swappiness (10 is ideal for servers with SSD)
    sysctl vm.swappiness=10
    echo 'vm.swappiness=10' >> /etc/sysctl.conf
    echo 'vm.vfs_cache_pressure=50' >> /etc/sysctl.conf
    echo "Swap configured: 4GB active."
else
    echo "Swapfile already exists. Skipping."
fi

# 3. Configure UFW Firewall
echo "Configuring UFW Firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp comment 'HTTP Caddy'
ufw allow 443/tcp comment 'HTTPS Caddy'
ufw allow 443/udp comment 'HTTP/3 QUIC'
# Enable UFW non-interactively
echo "y" | ufw enable
ufw status verbose

# 4. Configure Fail2ban
echo "Enabling Fail2ban for SSH brute-force protection..."
systemctl enable fail2ban
systemctl start fail2ban

# 5. Install Official Docker Engine & Compose
if ! command -v docker &> /dev/null; then
    echo "Installing Docker Engine..."
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      tee /etc/apt/sources.list.d/docker.list > /dev/null

    apt update
    apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

    systemctl enable docker
    systemctl start docker
    echo "Docker installed successfully."
else
    echo "Docker already installed."
fi

# 6. Create Deployment Directories
echo "Setting up deployment folders at /opt/app..."
mkdir -p /opt/app/caddy
mkdir -p /opt/app/backups
mkdir -p /opt/app/scripts
mkdir -p /opt/app/releases

# Set timezone
timedatectl set-timezone Europe/Istanbul

echo "======================================================================"
echo "Server Bootstrap Completed!"
echo "   - Host: Ubuntu 24.04 LTS"
echo "   - RAM Buffer: 6GB RAM + 4GB Swap"
echo "   - Firewall: UFW Enabled (22, 80, 443)"
echo "   - Docker: Active"
echo "   - App Dir: /opt/app"
echo "======================================================================"
