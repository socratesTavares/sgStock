#!/usr/bin/env bash
# =============================================================================
# Script de Instalação e Deploy Automatizado: sgStock em Ubuntu Server
# =============================================================================

set -e

echo "🚀 Iniciando preparação do servidor Ubuntu para o sgStock..."

# 1. Atualização do sistema
sudo apt update && sudo apt upgrade -y

# 2. Instalação de dependências essenciais
sudo apt install -y curl git build-essential nginx ufw postgresql postgresql-contrib

# 3. Instalação do Node.js LTS (v20.x ou v22.x) via NodeSource
if ! command -v node &> /dev/null; then
    echo "📦 Instalando Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# 4. Instalação global do PM2
sudo npm install -g pm2

# 5. Criar diretório de logs do PM2
mkdir -p /var/www/sgStock/backend/logs

# 6. Instalação de dependências do backend e execução de migrações
echo "📦 Instalando pacotes npm no backend..."
cd /var/www/sgStock/backend
npm install --production

echo "🔄 Executando migrações na base de dados..."
npm run migrate

# 7. Iniciar processo com PM2 usando o ficheiro de ecossistema
echo "⚡ Inicializando aplicação com PM2..."
pm2 start ecosystem.config.js --env production
pm2 save

# 8. Configurar PM2 para inicialização automática no boot do Ubuntu
pm2 startup systemd -u $USER --hp $HOME || true

# 9. Configurar Nginx
echo "🌐 Configurando Nginx como Proxy Reverso..."
sudo cp /var/www/sgStock/backend/nginx/sgstock.conf /etc/nginx/sites-available/sgstock
sudo ln -sf /etc/nginx/sites-available/sgstock /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

# 10. Configuração do Firewall UFW
echo "🛡️ Configurando Firewall (UFW)..."
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw --force enable

echo "=========================================================="
echo "✅ Deploy concluído com sucesso!"
echo "👉 Status da aplicação: pm2 status"
echo "👉 Logs em tempo real: pm2 logs sgstock-api"
echo "=========================================================="
