import { v4 as uuidv4 } from 'uuid';
import os from 'node:os';
import { db } from '../db/database.js';
import { Job, JobExecution, Queue, Worker, WorkerStatus } from '../types/index.js';
import { RetryService } from '../services/retry.service.js';
import { DLQService } from '../services/dlq.service.js';
import { WorkflowService } from '../services/workflow.service.js';
import { RateLimiterService } from '../services/rate_limiter.service.js';
import { wsHub } from '../ws/websocket.hub.js';

export interface WorkerOptions {
  id?: string;
  name?: string;
  concurrency?: number;
  tags?: string[];
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
}

export class WorkerNode {
  public readonly id: string;
  public readonly name: string;
  public readonly concurrency: number;
  public readonly tags: string[];
  private status: WorkerStatus = 'active';
  private pollIntervalMs: number;
  private heartbeatIntervalMs: number;

  private pollTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private activeJobs: Map<string, AbortController> = new Map();
  private isShuttingDown = false;

  constructor(options: WorkerOptions = {}) {
    this.id = options.id || `worker-${uuidv4().substring(0, 8)}`;
    this.name = options.name || `Worker-${this.id.slice(-4)}`;
    this.concurrency = options.concurrency || 5;
    this.tags = options.tags || ['default'];
    this.pollIntervalMs = options.pollIntervalMs || 500;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs || 3000;
  }

  /**
   * Start worker loops: register in DB, start heartbeats, and start job polling.
   */
  public async start(): Promise<void> {
    this.registerWorker();
    this.startHeartbeat();
    this.startPolling();
  }

  private registerWorker(): void {
    const hostname = os.hostname();
    const tagsJson = JSON.stringify(this.tags);
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO workers (id, name, hostname, ip_address, status, concurrency, active_jobs_count, tags, last_heartbeat_at, started_at, metrics)
       VALUES (?, ?, ?, '127.0.0.1', 'active', ?, 0, ?, ?, ?, '{}')
       ON CONFLICT(id) DO UPDATE SET
         status = 'active',
         last_heartbeat_at = excluded.last_heartbeat_at,
         concurrency = excluded.concurrency,
         tags = excluded.tags`,
      [this.id, this.name, hostname, this.concurrency, tagsJson, now, now]
    );

    wsHub.broadcast('worker:status_changed', { workerId: this.id, status: 'active', name: this.name });
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  private sendHeartbeat(): void {
    if (this.isShuttingDown && this.activeJobs.size === 0) return;

    try {
      const now = new Date().toISOString();
      const memUsage = process.memoryUsage();
      const memMb = Math.round((memUsage.heapUsed / 1024 / 1024) * 100) / 100;
      const cpus = os.cpus();
      const cpuPct = Math.min(100, Math.round(Math.random() * 15 + this.activeJobs.size * 10)); // realistic load simulation

      const metrics = JSON.stringify({
        memoryMb: memMb,
        cpuPct: cpuPct,
        uptimeSec: Math.round(process.uptime()),
        activeCount: this.activeJobs.size
      });

      db.run(
        `UPDATE workers
         SET last_heartbeat_at = ?,
             active_jobs_count = ?,
             status = ?,
             metrics = ?
         WHERE id = ?`,
        [now, this.activeJobs.size, this.status, metrics, this.id]
      );

      // Record telemetry history
      const hbId = uuidv4();
      db.run(
        `INSERT INTO worker_heartbeats (id, worker_id, status, active_jobs, cpu_pct, mem_mb, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [hbId, this.id, this.status, this.activeJobs.size, cpuPct, memMb, now]
      );

      wsHub.broadcast('worker:heartbeat', {
        workerId: this.id,
        name: this.name,
        status: this.status,
        activeJobs: this.activeJobs.size,
        concurrency: this.concurrency,
        cpuPct,
        memMb,
        timestamp: now
      });
    } catch (err) {
      console.error(`Heartbeat error on worker ${this.id}:`, err);
    }
  }

  private startPolling(): void {
    const poll = async () => {
      if (this.isShuttingDown) return;

      if (this.activeJobs.size < this.concurrency && this.status !== 'draining') {
        const availableSlots = this.concurrency - this.activeJobs.size;
        for (let i = 0; i < availableSlots; i++) {
          const claimedJob = this.claimNextJob();
          if (claimedJob) {
            this.executeJob(claimedJob);
          } else {
            break; // No more eligible jobs in queues right now
          }
        }
      }

      this.pollTimer = setTimeout(poll, this.pollIntervalMs);
    };

    poll();
  }

  /**
   * ATOMIC JOB CLAIMING ALGORITHM:
   * 1. Finds active unpaused queues matching worker tags.
   * 2. Verifies queue concurrency limit is not exceeded.
   * 3. Verifies queue rate limit has available capacity.
   * 4. Selects highest priority due job (status = 'queued' AND run_at <= NOW).
   * 5. Atomically claims job: updates status='claimed', worker_id, claimed_at inside transaction.
   */
  public claimNextJob(): Job | null {
    return db.transaction(() => {
      // Find candidate queues
      const queues = db.queryAll<Queue>('SELECT * FROM queues WHERE is_paused = 0 ORDER BY priority DESC');

      for (const queue of queues) {
        // 1. Check queue concurrency limit
        const activeInQueue = db.queryOne<{ count: number }>(
          "SELECT COUNT(*) as count FROM jobs WHERE queue_id = ? AND status IN ('claimed', 'running')",
          [queue.id]
        );

        if ((activeInQueue?.count || 0) >= queue.concurrency_limit) {
          continue; // Queue at max concurrency
        }

        // 2. Check queue rate limit
        const rateLimitResult = RateLimiterService.consume(
          `queue:${queue.id}`,
          queue.rate_limit_per_min / 60,
          queue.rate_limit_burst,
          1
        );

        if (!rateLimitResult.allowed) {
          continue; // Rate limit reached for this queue
        }

        // 3. Find top candidate job (Priority, then FIFO run_at, then created_at)
        const job = db.queryOne<Job>(
          `SELECT * FROM jobs
           WHERE queue_id = ? AND status = 'queued' AND datetime(run_at) <= datetime('now')
           ORDER BY priority DESC, datetime(run_at) ASC, datetime(created_at) ASC
           LIMIT 1`,
          [queue.id]
        );

        if (job) {
          const now = new Date().toISOString();

          // Atomically claim the job
          db.run(
            `UPDATE jobs
             SET status = 'claimed',
                 worker_id = ?,
                 claimed_at = ?,
                 attempt_count = attempt_count + 1,
                 updated_at = ?
             WHERE id = ? AND status = 'queued'`,
            [this.id, now, now, job.id]
          );

          // Fetch fresh claimed job
          const claimed = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [job.id]);
          return claimed;
        }
      }

      return null;
    });
  }

  /**
   * Execute the claimed job with timeout, log streaming, and retry/DLQ orchestration.
   */
  private async executeJob(job: Job): Promise<void> {
    const abortController = new AbortController();
    this.activeJobs.set(job.id, abortController);
    this.updateStatus();

    const executionId = uuidv4();
    const startTime = Date.now();
    const nowIso = new Date().toISOString();

    // 1. Transition job to 'running' and create execution attempt record
    db.transaction(() => {
      db.run(
        `UPDATE jobs
         SET status = 'running', started_at = ?, updated_at = ?
         WHERE id = ?`,
        [nowIso, nowIso, job.id]
      );

      db.run(
        `INSERT INTO job_executions (
           id, job_id, worker_id, attempt_number, status, started_at
         ) VALUES (?, ?, ?, ?, 'running', ?)`,
        [executionId, job.id, this.id, job.attempt_count, nowIso]
      );
    });

    this.log(job.id, executionId, 'info', `Job claimed by ${this.name}. Attempt ${job.attempt_count}/${job.max_retries}. Starting execution.`);
    const runningJob = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [job.id]);
    if (runningJob) {
      wsHub.broadcast('job:status_changed', runningJob);
    }

    try {
      // 2. Execute job handler logic
      const result = await this.runHandler(job, abortController.signal, (level, msg) => {
        this.log(job.id, executionId, level, msg);
      });

      const durationMs = Date.now() - startTime;
      const completedIso = new Date().toISOString();
      const resultJson = JSON.stringify(result ?? { success: true });

      // 3. Mark job as COMPLETED
      db.transaction(() => {
        db.run(
          `UPDATE jobs
           SET status = 'completed',
               result = ?,
               completed_at = ?,
               error_message = NULL,
               error_stack = NULL,
               updated_at = ?
           WHERE id = ?`,
          [resultJson, completedIso, completedIso, job.id]
        );

        db.run(
          `UPDATE job_executions
           SET status = 'completed',
               completed_at = ?,
               duration_ms = ?,
               cpu_usage_pct = ?,
               memory_usage_mb = ?,
               exit_code = 0,
               result_preview = ?
           WHERE id = ?`,
          [completedIso, durationMs, 12.5, 45.2, resultJson.slice(0, 500), executionId]
        );
      });

      this.log(job.id, executionId, 'info', `Job completed successfully in ${durationMs}ms.`);
      const completedJob = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [job.id]);
      if (completedJob) {
        wsHub.broadcast('job:status_changed', completedJob);
      }

      // 4. Trigger DAG downstream steps if part of a workflow
      if (job.dag_id) {
        WorkflowService.onStepCompleted(job.id);
      }
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const failedIso = new Date().toISOString();
      const errorMessage = err?.message || 'Unknown execution failure';
      const errorStack = err?.stack || '';

      this.log(job.id, executionId, 'error', `Execution failed: ${errorMessage}`);

      // 5. Check Retry Policy & DLQ Routing
      const queue = db.queryOne<Queue>('SELECT * FROM queues WHERE id = ?', [job.queue_id]);
      let retryPolicy = {
        strategy: 'exponential' as const,
        base_delay_ms: 1000,
        max_delay_ms: 60000,
        max_retries: job.max_retries || 3,
        jitter_factor: 0.2
      };

      if (queue?.retry_policy_id) {
        const policy = db.queryOne<any>('SELECT * FROM retry_policies WHERE id = ?', [queue.retry_policy_id]);
        if (policy) {
          retryPolicy = {
            strategy: policy.strategy,
            base_delay_ms: policy.base_delay_ms,
            max_delay_ms: policy.max_delay_ms,
            max_retries: policy.max_retries,
            jitter_factor: policy.jitter_factor
          };
        }
      }

      const retryCalc = RetryService.calculateNextRetry(retryPolicy, job.attempt_count);

      db.transaction(() => {
        db.run(
          `UPDATE job_executions
           SET status = 'failed',
               completed_at = ?,
               duration_ms = ?,
               exit_code = 1,
               error_message = ?,
               error_stack = ?
           WHERE id = ?`,
          [failedIso, durationMs, errorMessage, errorStack, executionId]
        );

        if (retryCalc.shouldRetry) {
          // Schedule for retry with backoff delay
          db.run(
            `UPDATE jobs
             SET status = 'scheduled',
                 run_at = ?,
                 retry_delay_ms = ?,
                 error_message = ?,
                 error_stack = ?,
                 worker_id = NULL,
                 claimed_at = NULL,
                 started_at = NULL,
                 updated_at = ?
             WHERE id = ?`,
            [retryCalc.nextRunAt.toISOString(), retryCalc.delayMs, errorMessage, errorStack, failedIso, job.id]
          );

          this.log(
            job.id,
            executionId,
            'warn',
            `Retry scheduled (attempt ${job.attempt_count + 1}/${retryPolicy.max_retries}) in ${retryCalc.delayMs}ms using ${retryPolicy.strategy} backoff.`
          );

          const scheduledJob = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [job.id]);
          if (scheduledJob) {
            wsHub.broadcast('job:status_changed', scheduledJob);
          }
        } else {
          // Max retries exceeded -> Route to Dead Letter Queue with AI analysis
          DLQService.moveToDLQ(job, errorMessage, errorStack);
          this.log(job.id, executionId, 'error', `Maximum retries (${job.max_retries}) exceeded. Job moved to Dead Letter Queue (DLQ).`);
          wsHub.broadcast('dlq:alert', { jobId: job.id, failureReason: errorMessage });

          if (job.dag_id) {
            WorkflowService.onStepFailed(job.id, errorMessage);
          }
        }
      });
    } finally {
      this.activeJobs.delete(job.id);
      this.updateStatus();
    }
  }

  /**
   * Execution Handler: executes simulated payload instructions, custom math, or intentional failure modes.
   */
  private async runHandler(
    job: Job,
    signal: AbortSignal,
    log: (level: 'info' | 'warn' | 'error' | 'debug', msg: string) => void
  ): Promise<any> {
    let payload: any = {};
    try {
      payload = JSON.parse(job.payload || '{}');
    } catch (e) {
      payload = {};
    }

    log('debug', `Loaded payload: ${JSON.stringify(payload)}`);

    // Check for simulated failure directive (for testing resilience, retries & DLQ)
    if (payload.simulate_failure) {
      const failureRate = payload.failure_rate ?? 1.0;
      if (Math.random() <= failureRate) {
        const errorType = payload.failure_type || 'TRANSIENT_TIMEOUT';
        const delay = payload.work_duration_ms || 800;
        await this.sleep(delay, signal);

        if (errorType === 'RATE_LIMIT') {
          throw new Error('HTTP 429: Too Many Requests from downstream API service.');
        } else if (errorType === 'DATABASE_DEADLOCK') {
          throw new Error('Database Error: SQLite transaction lock timeout / deadlock detected.');
        } else if (errorType === 'AUTH_ERROR') {
          throw new Error('HTTP 401: Unauthorized. Bearer token expired or invalid signature.');
        } else if (errorType === 'OOM') {
          throw new Error('ResourceExhaustion: JavaScript heap out of memory while buffering chunk.');
        } else {
          throw new Error(`Execution error [${errorType}]: Connection closed unexpectedly.`);
        }
      }
    }

    // Normal workload execution simulation
    const workDuration = payload.work_duration_ms || Math.floor(Math.random() * 800 + 400);
    log('info', `Processing workload for ${workDuration}ms...`);

    const steps = 3;
    for (let s = 1; s <= steps; s++) {
      if (signal.aborted) {
        throw new Error('Job execution aborted due to worker shutdown or timeout.');
      }
      await this.sleep(workDuration / steps, signal);
      log('info', `Step ${s}/${steps} completed: processing chunk.`);
    }

    return {
      success: true,
      processed_by: this.name,
      completed_at: new Date().toISOString(),
      summary: `Successfully processed ${job.name}`,
      payload_echo: payload
    };
  }

  private log(jobId: string, executionId: string, level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    const logId = `log-${uuidv4().substring(0, 12)}`;
    const now = new Date().toISOString();

    db.run(
      `INSERT INTO job_logs (id, job_id, execution_id, worker_id, level, message, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [logId, jobId, executionId, this.id, level, message, now]
    );

    wsHub.broadcast('job:log', {
      id: logId,
      jobId,
      executionId,
      workerId: this.id,
      workerName: this.name,
      level,
      message,
      timestamp: now
    });
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      if (signal) {
        signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Error('Aborted'));
        });
      }
    });
  }

  private updateStatus(): void {
    if (this.isShuttingDown) {
      this.status = 'draining';
    } else if (this.activeJobs.size >= this.concurrency) {
      this.status = 'busy';
    } else {
      this.status = 'active';
    }
  }

  /**
   * Graceful Worker Shutdown:
   * Sets status to draining, allows running jobs to finish within gracePeriodMs.
   */
  public async shutdown(gracePeriodMs = 5000): Promise<void> {
    this.isShuttingDown = true;
    this.status = 'draining';

    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }

    db.run("UPDATE workers SET status = 'draining' WHERE id = ?", [this.id]);
    wsHub.broadcast('worker:status_changed', { workerId: this.id, status: 'draining' });

    const start = Date.now();
    while (this.activeJobs.size > 0 && Date.now() - start < gracePeriodMs) {
      await new Promise((r) => setTimeout(r, 200));
    }

    // Cancel any still-hung jobs and release their leases
    for (const [jobId, controller] of this.activeJobs.entries()) {
      controller.abort();
      db.run(
        `UPDATE jobs
         SET status = 'queued', worker_id = NULL, claimed_at = NULL, started_at = NULL
         WHERE id = ?`,
        [jobId]
      );
    }

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.status = 'offline';
    db.run("UPDATE workers SET status = 'offline', active_jobs_count = 0 WHERE id = ?", [this.id]);
    wsHub.broadcast('worker:status_changed', { workerId: this.id, status: 'offline' });
  }
}
