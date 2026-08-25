import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { AIFailureDiagnosis, DeadLetterJob, Job } from '../types/index.js';

export class DLQService {
  /**
   * Move a failed job to the Dead Letter Queue with an AI Root Cause Diagnosis.
   */
  public static moveToDLQ(job: Job, failureReason: string, errorStack?: string): DeadLetterJob {
    return db.transaction(() => {
      const id = uuidv4();
      const diagnosis = this.generateAIDiagnosis(job.name, failureReason, errorStack, job.payload);
      const now = new Date().toISOString();

      // Update job status to dead_letter
      db.run(
        `UPDATE jobs
         SET status = 'dead_letter', error_message = ?, error_stack = ?, updated_at = ?
         WHERE id = ?`,
        [failureReason, errorStack || null, now, job.id]
      );

      // Insert or replace into dead_letter_queue
      db.run(
        `INSERT INTO dead_letter_queue (
           id, job_id, queue_id, project_id, failed_at, failure_reason,
           error_stack, payload, attempt_count, ai_root_cause_analysis, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unresolved')
         ON CONFLICT(job_id) DO UPDATE SET
           failed_at = excluded.failed_at,
           failure_reason = excluded.failure_reason,
           error_stack = excluded.error_stack,
           payload = excluded.payload,
           attempt_count = excluded.attempt_count,
           ai_root_cause_analysis = excluded.ai_root_cause_analysis,
           status = 'unresolved'`,
        [
          id,
          job.id,
          job.queue_id,
          job.project_id,
          now,
          failureReason,
          errorStack || null,
          job.payload,
          job.attempt_count,
          JSON.stringify(diagnosis)
        ]
      );

      return db.queryOne<DeadLetterJob>(
        'SELECT dlq.*, j.name as job_name, q.name as queue_name FROM dead_letter_queue dlq JOIN jobs j ON dlq.job_id = j.id JOIN queues q ON dlq.queue_id = q.id WHERE dlq.id = ?',
        [id]
      )!;
    });
  }

  /**
   * AI-Powered Failure Diagnostic Engine.
   * Analyzes logs, error stack traces, and payloads to generate root cause summaries and remediation advice.
   */
  public static generateAIDiagnosis(
    jobName: string,
    errorMessage: string,
    errorStack?: string,
    payloadRaw?: string
  ): AIFailureDiagnosis {
    const combined = `${errorMessage || ''} ${errorStack || ''}`.toLowerCase();

    // 1. Rate Limit
    if (combined.includes('429') || combined.includes('rate limit') || combined.includes('too many requests') || combined.includes('throttled')) {
      return {
        category: 'RATE_LIMIT_EXCEEDED',
        root_cause: 'Downstream API / Service Rate Limit Threshold Breached (HTTP 429)',
        explanation: `The job '${jobName}' exceeded downstream service capacity limits. Repeated rapid requests caused the third-party endpoint to reject traffic with HTTP 429.`,
        recommended_action: 'Increase Queue Rate Limiter backoff factor or switch Retry Policy to Exponential Backoff with Jitter (base delay >= 5000ms).',
        confidence: 0.96,
        auto_remediable: true
      };
    }

    // 2. Database Connection / Lock Timeout
    if (
      combined.includes('database') ||
      combined.includes('sql') ||
      combined.includes('lock') ||
      combined.includes('timeout') ||
      combined.includes('deadlock') ||
      combined.includes('pool')
    ) {
      return {
        category: 'DATABASE_TIMEOUT',
        root_cause: 'Database Transaction Lock Contention or Connection Pool Starvation',
        explanation: `The worker encountered lock contention or timed out waiting for an available relational connection while executing '${jobName}'.`,
        recommended_action: 'Optimize transaction isolation level, ensure indexes on filtering columns, or raise the queue concurrency limit carefully.',
        confidence: 0.94,
        auto_remediable: true
      };
    }

    // 3. Network & Connection Partitions
    if (
      combined.includes('econnrefused') ||
      combined.includes('econnreset') ||
      combined.includes('etimedout') ||
      combined.includes('socket hang up') ||
      combined.includes('enotfound') ||
      combined.includes('fetch failed')
    ) {
      return {
        category: 'NETWORK_PARTITION',
        root_cause: 'Transient Network Partition or Unreachable Remote Host',
        explanation: `Socket connection was unexpectedly severed or the target DNS/IP endpoint did not respond within the worker timeout budget for '${jobName}'.`,
        recommended_action: 'Verify endpoint reachability and firewall rules. Replay job when remote gateway returns to healthy status.',
        confidence: 0.95,
        auto_remediable: true
      };
    }

    // 4. Authentication / Authorization
    if (combined.includes('401') || combined.includes('403') || combined.includes('unauthorized') || combined.includes('forbidden') || combined.includes('jwt') || combined.includes('token')) {
      return {
        category: 'AUTHENTICATION_FAILURE',
        root_cause: 'Expired Credentials or Invalid Access Permissions (HTTP 401/403)',
        explanation: `The job payload or worker credentials failed signature verification against the target service. Retrying without token refresh will continue to fail.`,
        recommended_action: 'Rotate and re-issue valid API keys or OAuth credentials in Project Settings before replaying this job.',
        confidence: 0.98,
        auto_remediable: false
      };
    }

    // 5. Memory / CPU Out of Bounds
    if (combined.includes('heap') || combined.includes('out of memory') || combined.includes('oom') || combined.includes('allocation failed')) {
      return {
        category: 'RESOURCE_EXHAUSTION',
        root_cause: 'Worker Memory Quota Exceeded (OOM)',
        explanation: `The job attempted to process an oversized dataset that exceeded worker node memory thresholds.`,
        recommended_action: 'Assign this queue to a worker tagged with "high-memory" or break the input batch into smaller chunked payloads.',
        confidence: 0.92,
        auto_remediable: false
      };
    }

    // 6. Schema / Payload Validation
    if (combined.includes('json') || combined.includes('syntaxerror') || combined.includes('cannot read property') || combined.includes('undefined') || combined.includes('null')) {
      return {
        category: 'PAYLOAD_SCHEMA_MISMATCH',
        root_cause: 'Missing Required JSON Attributes or Null-Pointer Property Access',
        explanation: `The job payload was malformed or missing key parameters required by the handler logic for '${jobName}'.`,
        recommended_action: 'Inspect payload JSON structure, add schema validation (Zod/JSONSchema) at ingestion, and update payload before re-queuing.',
        confidence: 0.91,
        auto_remediable: false
      };
    }

    // 7. Upstream 5xx
    if (combined.includes('500') || combined.includes('502') || combined.includes('503') || combined.includes('504') || combined.includes('bad gateway')) {
      return {
        category: 'EXTERNAL_SERVICE_5XX',
        root_cause: 'Downstream Upstream Server Crash (HTTP 5xx)',
        explanation: `The target service crashed or returned an internal server error while processing the request from '${jobName}'.`,
        recommended_action: 'Check upstream service health dashboard. Replay DLQ jobs once the upstream dependency is restored.',
        confidence: 0.93,
        auto_remediable: true
      };
    }

    // Fallback Unhandled Exception
    return {
      category: 'UNHANDLED_EXCEPTION',
      root_cause: `Unhandled Runtime Exception: ${errorMessage.slice(0, 100)}`,
      explanation: `Worker encountered an unexpected error during execution. Full stack trace is recorded for developer inspection.`,
      recommended_action: 'Review stack trace in Job Details view, apply bug fix, and replay the job.',
      confidence: 0.88,
      auto_remediable: false
    };
  }

  /**
   * Replay a single job from DLQ back to the queue.
   */
  public static replayJob(dlqId: string): Job {
    return db.transaction(() => {
      const dlq = db.queryOne<DeadLetterJob>('SELECT * FROM dead_letter_queue WHERE id = ?', [dlqId]);
      if (!dlq) {
        throw new Error('DLQ entry not found');
      }

      const now = new Date().toISOString();

      // Reset job to queued with fresh attempt counts and run_at
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
             run_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [now, now, dlq.job_id]
      );

      // Mark DLQ entry as replayed
      db.run(
        `UPDATE dead_letter_queue
         SET status = 'replayed', replayed_at = ?
         WHERE id = ?`,
        [now, dlqId]
      );

      return db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [dlq.job_id])!;
    });
  }

  /**
   * Bulk replay all unresolved DLQ entries for a project or queue.
   */
  public static bulkReplay(projectId: string, queueId?: string): number {
    return db.transaction(() => {
      let sql = "SELECT id FROM dead_letter_queue WHERE project_id = ? AND status = 'unresolved'";
      const params: any[] = [projectId];
      if (queueId) {
        sql += ' AND queue_id = ?';
        params.push(queueId);
      }

      const entries = db.queryAll<{ id: string }>(sql, params);
      for (const entry of entries) {
        this.replayJob(entry.id);
      }
      return entries.length;
    });
  }

  /**
   * Purge DLQ entries.
   */
  public static purge(projectId: string, dlqId?: string): number {
    if (dlqId) {
      const res = db.run('DELETE FROM dead_letter_queue WHERE id = ? AND project_id = ?', [dlqId, projectId]);
      return res.changes;
    }
    const res = db.run('DELETE FROM dead_letter_queue WHERE project_id = ?', [projectId]);
    return res.changes;
  }

  /**
   * List DLQ entries with pagination and filtering.
   */
  public static list(projectId: string, status?: string, queueId?: string, page = 1, limit = 20) {
    let sql = `
      SELECT dlq.*, j.name as job_name, q.name as queue_name, j.priority
      FROM dead_letter_queue dlq
      JOIN jobs j ON dlq.job_id = j.id
      JOIN queues q ON dlq.queue_id = q.id
      WHERE dlq.project_id = ?
    `;
    const params: any[] = [projectId];

    if (status && status !== 'all') {
      sql += ' AND dlq.status = ?';
      params.push(status);
    }
    if (queueId) {
      sql += ' AND dlq.queue_id = ?';
      params.push(queueId);
    }

    const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
    const countRow = db.queryOne<{ total: number }>(countSql, params);
    const total = countRow?.total || 0;

    sql += ' ORDER BY dlq.failed_at DESC LIMIT ? OFFSET ?';
    params.push(limit, (page - 1) * limit);

    const items = db.queryAll<any>(sql, params).map((item) => ({
      ...item,
      ai_root_cause_analysis: item.ai_root_cause_analysis ? JSON.parse(item.ai_root_cause_analysis) : null
    }));

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    };
  }
}
