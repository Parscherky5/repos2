module.exports = {
  apps: [
    {
      name: 'tg-bot',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/pm2-error.log',
      out_file: 'logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    },
    {
      name: 'tg-watchdog',
      script: 'dist/watchdog.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '100M',
      error_file: 'logs/watchdog-error.log',
      out_file: 'logs/watchdog-out.log',
    },
  ],
};
