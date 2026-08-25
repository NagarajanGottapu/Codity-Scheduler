import { db } from '../db/database.js';
import { Job, Worker } from '../types/index.js';
import { DLQService } from './dlq.service.js';
import { wsHub } from '../ws/websocket.hub.js';

export class LeaseRecoveryService {
  private static timer: NodeJS.Timeout | null = null;
  private static isRunning = false;

  public static start(intervalMs = 4000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  public static stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
  }

  public static tick(): void {
    try {
      this.detectZombieWorkers();
      this.recoverExpiredLeases();
    } catch (err) {
      console.error('Error during LeaseRecoveryService tick:', err);
    }
  }

  /**
   * Detect workers whose heartbeats have stopped and mark them as 'dead'.
   */
  public static detectZombieWorkers(heartbeatTimeoutMs = 15000): number {
    return db.transaction(() => {
      const cutoff = new Date(Date.now() - heartbeatTimeoutMs).toISOString();

      const deadWorkers = db.queryAll<Worker>(
        "SELECT * FROM workers WHERE status IN ('active', 'busy', 'draining') AND last_heartbeat_at < ?",
        [cutoff]
      );

      for (const worker of deadWorkers) {
        db.run("UPDATE workers SET status = 'dead', active_jobs_count = 0 WHERE id = ?", [worker.id]);
        wsHub.broadcast('worker:status_changed', { workerId: worker.id, status: 'dead' });
      }

      return deadWorkers.length;
    });
  }

  /**
   * Reclaim jobs held by dead workers or where lease has expired.
   */
  public static recoverExpiredLeases(): number {
    return db.transaction(() => {
      const now = new Date().toISOString();

      // Find jobs in claimed/running whose assigned worker is dead or whose lease is expired
      const stuckJobs = db.queryAll<Job>(
        `SELECT j.*, w.status as worker_status
         FROM jobs j
         LEFT JOIN workers w ON j.worker_id = w.id
         WHERE j.status IN ('claimed', 'running')
           AND (
             w.status = 'dead'
             OR w.id IS NULL
             OR datetime(j.claimed_at, '+' || (j.lease_timeout_ms / 1000) || ' seconds') < datetime('now')
           )`
      );

      for (const job of stuckJobs) {
        const reason = `Worker node lease expired or worker crashed while in state '${job.status}'`;

        if (job.attempt_count >= job.max_retries) {
          // Exceeded max retries -> route to Dead Letter Queue
          DLQService.moveToDLQ(job, reason, 'LeaseTimeout: No heartbeat received from worker within allocated budget');
          wsHub.broadcast('dlq:alert', { jobId: job.id, reason });
        } else {
          // Re-queue job for another worker to pick up
          db.run(
            `UPDATE jobs
             SET status = 'queued',
                 worker_id = NULL,
                 claimed_at = NULL,
                 started_at = NULL,
                 run_at = CURRENT_TIMESTAMP,
                 error_message = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [reason, job.id]
          );

          // Append to job execution logs
          db.run(
            `INSERT INTO job_logs (id, job_id, level, message, timestamp)
             VALUES (?, ?, 'warn', ?, CURRENT_TIMESTAMP)`,
            [`log-rec-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, job.id, `[Lease Recovery] ${reason}. Job successfully re-queued.`]
          );

          const recovered = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [job.id]);
          if (recovered) {
            wsHub.broadcast('job:status_changed', recovered);
          }
        }
      }

      return stuckJobs.length;
    });
  }
}
