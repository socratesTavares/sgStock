module.exports = {
  apps: [{
    name: 'sgstock-api',
    script: 'server.js',
    instances: process.env.PM2_INSTANCES || 'max', // Utiliza todos os núcleos da CPU do servidor
    exec_mode: 'cluster',                           // Zero downtime nos reloads
    watch: false,
    max_memory_restart: '500M',                     // Reinicia automaticamente se houver memory leak acima de 500MB
    kill_timeout: 8000,                             // Dá 8 segundos para o graceful shutdown fechar transações e pool
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/pm2-err.log',
    out_file: './logs/pm2-out.log',
    merge_logs: true,
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_development: {
      NODE_ENV: 'development',
      PORT: 3000
    }
  }]
};
