import { Telegraf } from 'telegraf';
import { config } from './config';
import { exec } from 'child_process';

const bot = new Telegraf(config.bot.token);

async function checkHealth() {
  try {
    // Botun Telegram API'sine erişip erişemediğini kontrol et
    await bot.telegram.getMe();
    console.log(`[${new Date().toISOString()}] Health Check: PASSED`);
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Health Check: FAILED`, error);
    
    // Eğer bot yanıt vermiyorsa PM2 ile yeniden başlat
    exec('pm2 restart tg-bot', (err, stdout, stderr) => {
      if (err) {
        console.error('Watchdog: Failed to restart bot', err);
        return;
      }
      console.log('Watchdog: Bot restarted successfully due to health check failure');
    });
  }
}

// Her 5 dakikada bir kontrol et
setInterval(checkHealth, 5 * 60 * 1000);
checkHealth();
console.log('Watchdog: Monitoring started...');
