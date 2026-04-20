import pool from '../db';
import { JobType, JobStatus, BackgroundJob } from '../types';
import { logger } from '../utils/logger';

export class JobService {
  /**
   * Job kuyruğuna ekle.
   * dedupKey verilirse — aynı key'de zaten PENDING/PROCESSING job varsa yeni ekleme.
   */
  async enqueue<T extends object>(
    type: JobType,
    payload: T,
    runAfter: Date = new Date(),
    maxAttempts = 5,
    dedupKey?: string,
    entityId?: string
  ): Promise<string | null> {

    if (dedupKey) {
      const [existing] = await pool.execute(
        `SELECT id FROM background_jobs
         WHERE dedup_key = ? AND status IN ('PENDING','PROCESSING')
         LIMIT 1`,
        [dedupKey]
      );
      if ((existing as any[]).length > 0) {
        logger.debug('Job deduplicated — already exists', { type, dedupKey });
        return null;
      }
    }

    try {
      const [result] = await pool.execute(
        `INSERT INTO background_jobs
           (type, entity_id, dedup_key, payload, status, run_after, max_attempts)
         VALUES (?, ?, ?, ?, 'PENDING', ?, ?)`,
        [
          type,
          entityId ?? null,
          dedupKey ?? null,
          JSON.stringify(payload),
          this.formatDate(runAfter),
          maxAttempts,
        ]
      );
      const id = String((result as any).insertId);
      logger.debug('Job enqueued', { type, id, dedupKey, runAfter });
      return id;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Duplicate entry') || msg.includes('uq_dedup')) {
        logger.debug('Job insert deduplicated by unique constraint', { type, dedupKey });
        return null;
      }
      throw err;
    }
  }

  async claimJobs(instanceId: string, batchSize = 5): Promise<BackgroundJob[]> {
    const batchKey = `${instanceId}:${Date.now()}:${Math.random().toString(36).slice(2)}`;

    await pool.execute(
      `UPDATE background_jobs
       SET status = 'PENDING', locked_by = NULL, locked_until = NULL
       WHERE status = 'PROCESSING' AND locked_until < NOW()`
    );

    await pool.execute(
      `UPDATE background_jobs
       SET status        = 'PROCESSING',
           locked_by     = ?,
           locked_until  = DATE_ADD(NOW(), INTERVAL 2 MINUTE),
           attempts      = attempts + 1
       WHERE status      = 'PENDING'
         AND run_after   <= NOW()
         AND attempts    < max_attempts
       ORDER BY created_at ASC
       LIMIT ?`,
      [batchKey, batchSize]
    );

    const [rows] = await pool.execute(
      `SELECT * FROM background_jobs WHERE locked_by = ? AND status = 'PROCESSING'`,
      [batchKey]
    );
    return (rows as any[]).map(this.mapRow);
  }

  async markDone(jobId: string): Promise<void> {
    await pool.execute(
      `UPDATE background_jobs SET status = 'DONE', locked_by = NULL WHERE id = ?`,
      [jobId]
    );
  }

  async markFailed(jobId: string, error: string, retryAfterSeconds?: number): Promise<void> {
    if (retryAfterSeconds) {
      const runAfter = new Date(Date.now() + retryAfterSeconds * 1000);
      await pool.execute(
        `UPDATE background_jobs
         SET status = 'PENDING', locked_by = NULL, locked_until = NULL,
             last_error = ?, run_after = ?
         WHERE id = ?`,
        [error.slice(0, 2000), this.formatDate(runAfter), jobId]
      );
    } else {
      await pool.execute(
        `UPDATE background_jobs
         SET status = 'FAILED', last_error = ?, locked_by = NULL
         WHERE id = ?`,
        [error.slice(0, 2000), jobId]
      );
    }
  }

  private formatDate(d: Date): string {
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  private mapRow(row: any): BackgroundJob {
    return {
      id: String(row.id),
      type: row.type as JobType,
      payload: JSON.parse(row.payload),
      status: row.status as JobStatus,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      runAfter: new Date(row.run_after),
      lockedUntil: row.locked_until ? new Date(row.locked_until) : null,
      lockedBy: row.locked_by ?? null,
      lastError: row.last_error ?? null,
      createdAt: new Date(row.created_at),
    };
  }
}

export const jobService = new JobService();
