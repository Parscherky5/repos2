import { Telegraf } from 'telegraf';
import { config } from './config';
import { exec } from 'child_process';
import { createWriteStream, mkdirSync } from 'fs';

const bot = new Telegraf(config.bot.token);
let consecutiveFailures = 0;
const MAX_FAILURES = 3;

mkdirSync('logs', { recursive: true });
const logStream = createWriteStream('logs/watchdog.log', { flags: 'a' });

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  logStream.write(line + '\n');
}

async function checkHealth(): Promise<void> {
  try {
    const me = await bot.telegram.getMe();
    log(`Health OK — bot: @${me.username}`);
    consecutiveFailures = 0;
  } catch (error: any) {
    consecutiveFailures++;
    log(`Health FAILED (${consecutiveFailures}/${MAX_FAILURES}): ${error?.message}`);

    if (consecutiveFailures >= MAX_FAILURES) {
      log('Restarting bot via PM2...');
      exec('pm2 restart tg-bot', (err, stdout) => {
        if (err) {
          log(`Restart failed: ${err.message}`);
        } else {
          log(`Restart initiated: ${stdout.trim()}`);
          consecutiveFailures = 0;
        }
      });
    }
  }
}

// Her 5 dakikada bir kontrol et
setInterval(() => { void checkHealth(); }, 5 * 60 * 1000);
void checkHealth();
log('Watchdog started — checking every 5 minutes');

