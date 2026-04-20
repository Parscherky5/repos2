import { BackgroundJob, JobType } from '../types';
import { jobService } from '../services/JobService';
import { config } from '../config';
import { logger } from '../utils/logger';
import { isEmergencyStopActive } from '../redis';
import { handleVerifyPayment } from './handlers/verifyPayment';
import { handleExpireReservation } from './handlers/expireReservation';
import { handleDeliverStock } from './handlers/deliverStock';

export class JobPoller {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private polling = false;

  start(): void {
    if (this.intervalId) return;
    logger.info('Job poller starting', { intervalMs: config.app.jobPollIntervalMs });
    // Run an initial poll immediately, then on every interval tick
    void this.poll();
    this.intervalId = setInterval(() => void this.poll(), config.app.jobPollIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('Job poller stopped');
  }

  private async poll(): Promise<void> {
    if (this.polling) return; // skip overlapping polls

    try {
      const emergencyStop = await isEmergencyStopActive();
      if (emergencyStop) {
        logger.warn('Emergency stop active — skipping job poll');
        return;
      }

      this.polling = true;
      const jobs = await jobService.claimJobs(config.app.instanceId);

      if (jobs.length > 0) {
        logger.info(`Claimed ${jobs.length} job(s)`);
        await Promise.all(jobs.map((job) => this.process(job)));
      }
    } catch (err) {
      logger.error('Job poll cycle error', {
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.polling = false;
    }
  }

  private async process(job: BackgroundJob): Promise<void> {
    logger.debug('Processing job', { id: job.id, type: job.type, attempt: job.attempts });
    try {
      switch (job.type) {
        case JobType.VERIFY_PAYMENT:
          await handleVerifyPayment(job);
          break;
        case JobType.EXPIRE_RESERVATION:
          await handleExpireReservation(job);
          break;
        case JobType.DELIVER_STOCK:
          await handleDeliverStock(job);
          break;
        default:
          logger.warn('Unknown job type — marking failed', { type: job.type, id: job.id });
          await jobService.markFailed(job.id, `Unknown job type: ${String(job.type)}`);
          return;
      }

      await jobService.markDone(job.id);
      logger.debug('Job completed', { id: job.id, type: job.type });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Job processing failed', { id: job.id, type: job.type, error: errorMsg });

      const hasRetriesLeft = job.attempts < job.maxAttempts;
      // Errors that start with these prefixes are permanent failures — no retry
      const isPermanent =
        errorMsg.startsWith('INVALID_TRANSITION') ||
        errorMsg.startsWith('ORDER_NOT_FOUND') ||
        errorMsg.startsWith('STOCK_ITEM_NOT_FOUND') ||
        errorMsg.startsWith('Unsupported currency');

      if (!isPermanent && hasRetriesLeft) {
        // Exponential back-off: 60s, 120s, 240s, …
        const retryAfter = 60 * 2 ** (job.attempts - 1);
        await jobService.markFailed(job.id, errorMsg, retryAfter);
      } else {
        await jobService.markFailed(job.id, errorMsg);
      }
    }
  }
}
