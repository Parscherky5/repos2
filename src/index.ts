import { launchBot, bot } from './bot';
import { JobPoller } from './workers/JobPoller';
import { config } from './config';
import { logger } from './utils/logger';
import pool from './db';

async function main(): Promise<void> {
  logger.info('Starting tg-crypto-marketplace', {
    nodeEnv: config.nodeEnv,
    instanceId: config.app.instanceId,
  });

  // Start the Telegram bot
  await launchBot();

  // Start the background job poller
  const poller = new JobPoller();
  poller.start();

  // Graceful shutdown handler
  const shutdown = async (signal: string): Promise<void> => {
    logger.info(`${signal} received — shutting down gracefully`);

    // Stop accepting new Telegram updates
    bot.stop(signal);

    // Stop the job poller (no new polls after this)
    poller.stop();

    // Close the database pool
    try {
      await pool.end();
      logger.info('Database pool closed');
    } catch (err) {
      logger.error('Error closing database pool', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT',  () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.error('Fatal startup error', {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
  });
  process.exit(1);
});
