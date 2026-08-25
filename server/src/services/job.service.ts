import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { Job, JobExecution, JobLog, JobStatus, JobType, Queue, RetryPolicy } from '../types/index.js';
import { wsHub } from '../ws/websocket.hub.js';

export interface CreateJobDTO {
  project_id: string;
  queue_id: string;
  name: string;
  job_type?: JobType;
  payload?: any;
  priority?: number;
  run_at?: string | Date;
  idempotency_key?: string;
  max_retries?: number;
  retry_delay_ms?: number;
  lease_timeout_ms?: number;
  batch_id?: string;
}

export interface ListJobsQuery {
  project_id: string;
  queue_id?: string;
  status?: string;
  job_type?: string;
  search?: string;
  priority?: number;
  batch_id?: string;
  dag_id?: string;
  page?: number;
  limit?: number;
}

export class JobService {
  /**
   * Create a single job (Immediate, Delayed, Scheduled, or Idempotent).
   */
  public static createJob(dto: CreateJobDTO): { job: Job; isDuplicate: boolean } {
    return db.transaction(() => {
      // 1. Check Idempotency Key
      if (dto.idempotency_key) {
        const existing = db.queryOne<Job>(
          'SELECT * FROM jobs WHERE project_id = ? AND idempotency_key = ?',
          [dto.project_id, dto.idempotency_key]
        );
        if (existing) {
          return { job: existing, isDuplicate: true };
        }
      }

      // 2. Fetch Queue and its Retry Policy
      const queue = db.queryOne<Queue>('SELECT * FROM queues WHERE id = ?', [dto.queue_id]);
      if (!queue) {
        throw new Error(`Queue with ID '${dto.queue_id}' does not exist`);
      }

      let maxRetries = dto.max_retries ?? 3;
      let retryDelayMs = dto.retry_delay_ms ?? 1000;

      if (queue.retry_policy_id) {
        const policy = db.queryOne<RetryPolicy>(
          'SELECT * FROM retry_policies WHERE id = ?',
          [queue.retry_policy_id]
        );
        if (policy) {
          maxRetries = dto.max_retries ?? policy.max_retries;
          retryDelayMs = dto.retry_delay_ms ?? policy.base_delay_ms;
        }
      }

      const jobId = uuidv4();
      const now = new Date();
      const runAtDate = dto.run_at ? new Date(dto.run_at) : now;
      const isDelayed = runAtDate.getTime() > now.getTime() + 1000;
      const initialStatus: JobStatus = isDelayed ? 'scheduled' : 'queued';
      const payloadStr = typeof dto.payload === 'string' ? dto.payload : JSON.stringify(dto.payload || {});
      const priority = dto.priority ?? queue.priority ?? 5;
      const leaseTimeout = dto.lease_timeout_ms ?? 30000;
      const jobType: JobType = dto.job_type || (isDelayed ? 'delayed' : 'immediate');

      db.run(
        `INSERT INTO jobs (
           id, queue_id, project_id, idempotency_key, name, job_type,
           status, priority, payload, run_at, lease_timeout_ms, attempt_count,
           max_retries, retry_delay_ms, batch_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          jobId,
          dto.queue_id,
          dto.project_id,
          dto.idempotency_key || null,
          dto.name,
          jobType,
          initialStatus,
          priority,
          payloadStr,
          runAtDate.toISOString(),
          leaseTimeout,
          maxRetries,
          retryDelayMs,
          dto.batch_id || null
        ]
      );

      const job = this.getJobById(jobId)!;
      wsHub.broadcast('job:created', job);
      return { job, isDuplicate: false };
    });
  }

  /**
   * Create a batch of jobs in a single atomic transaction.
   */
  public static createBatch(
    projectId: string,
    queueId: string,
    batchName: string,
    items: Array<{ name?: string; payload: any; priority?: number }>
  ): { batch_id: string; total: number; jobs: Job[] } {
    return db.transaction(() => {
      const batchId = `batch_${uuidv4().substring(0, 8)}`;
      const createdJobs: Job[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const res = this.createJob({
          project_id: projectId,
          queue_id: queueId,
          name: item.name || `${batchName} [#${i + 1}/${items.length}]`,
          job_type: 'batch',
          payload: item.payload,
          priority: item.priority,
          batch_id: batchId
        });
        createdJobs.push(res.job);
      }

      return {
        batch_id: batchId,
        total: createdJobs.length,
        jobs: createdJobs
      };
    });
  }

  public static getJobById(id: string): (Job & { executions?: JobExecution[]; logs?: JobLog[] }) | null {
    const job = db.queryOne<Job>(
      `SELECT j.*, q.name as queue_name, w.name as worker_name
       FROM jobs j
       JOIN queues q ON j.queue_id = q.id
       LEFT JOIN workers w ON j.worker_id = w.id
       WHERE j.id = ?`,
      [id]
    );

    if (!job) return null;

    job.executions = db.queryAll<JobExecution>(
      `SELECT je.*, w.name as worker_name
       FROM job_executions je
       LEFT JOIN workers w ON je.worker_id = w.id
       WHERE je.job_id = ?
       ORDER BY je.attempt_number ASC`,
      [id]
    );

    job.logs = db.queryAll<JobLog>(
      'SELECT * FROM job_logs WHERE job_id = ? ORDER BY timestamp ASC',
      [id]
    );

    return job;
  }

  public static listJobs(query: ListJobsQuery) {
    let sql = `
      SELECT j.*, q.name as queue_name, w.name as worker_name
      FROM jobs j
      JOIN queues q ON j.queue_id = q.id
      LEFT JOIN workers w ON j.worker_id = w.id
      WHERE j.project_id = ?
    `;
    const params: any[] = [query.project_id];

    if (query.queue_id) {
      sql += ' AND j.queue_id = ?';
      params.push(query.queue_id);
    }
    if (query.status && query.status !== 'all') {
      sql += ' AND j.status = ?';
      params.push(query.status);
    }
    if (query.job_type && query.job_type !== 'all') {
      sql += ' AND j.job_type = ?';
      params.push(query.job_type);
    }
    if (query.batch_id) {
      sql += ' AND j.batch_id = ?';
      params.push(query.batch_id);
    }
    if (query.dag_id) {
      sql += ' AND j.dag_id = ?';
      params.push(query.dag_id);
    }
    if (query.priority) {
      sql += ' AND j.priority = ?';
      params.push(query.priority);
    }
    if (query.search) {
      sql += ' AND (j.name LIKE ? OR j.payload LIKE ? OR j.id LIKE ?)';
      const term = `%${query.search}%`;
      params.push(term, term, term);
    }

    const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
    const countRow = db.queryOne<{ total: number }>(countSql, params);
    const total = countRow?.total || 0;

    const page = Math.max(1, query.page || 1);
    const limit = Math.max(1, Math.min(100, query.limit || 20));
    const offset = (page - 1) * limit;

    sql += ' ORDER BY j.created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const items = db.queryAll<Job>(sql, params);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }

  public static cancelJob(id: string): Job {
    return db.transaction(() => {
      const job = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [id]);
      if (!job) throw new Error('Job not found');

      if (['completed', 'running', 'claimed'].includes(job.status)) {
        throw new Error(`Cannot cancel job currently in status '${job.status}'`);
      }

      db.run(
        `UPDATE jobs
         SET status = 'cancelled', error_message = 'Cancelled by user', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [id]
      );

      const updated = this.getJobById(id)!;
      wsHub.broadcast('job:status_changed', updated);
      return updated;
    });
  }

  public static manualRetry(id: string): Job {
    return db.transaction(() => {
      const job = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [id]);
      if (!job) throw new Error('Job not found');

      db.run(
        `UPDATE jobs
         SET status = 'queued',
             attempt_count = 0,
             error_message = NULL,
             error_stack = NULL,
             worker_id = NULL,
             claimed_at = NULL,
             started_at = NULL,
             completed_at = NULL,
             run_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [id]
      );

      const updated = this.getJobById(id)!;
      wsHub.broadcast('job:status_changed', updated);
      return updated;
    });
  }
}
