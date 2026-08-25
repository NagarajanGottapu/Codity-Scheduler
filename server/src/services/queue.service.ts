import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { Queue, QueueStats, RetryPolicy } from '../types/index.js';
import { wsHub } from '../ws/websocket.hub.js';

export interface CreateQueueDTO {
  project_id: string;
  name: string;
  description?: string;
  priority?: number;
  concurrency_limit?: number;
  rate_limit_per_min?: number;
  rate_limit_burst?: number;
  retry_policy_id?: string | null;
  tags?: string[];
}

export interface UpdateQueueDTO {
  name?: string;
  description?: string;
  priority?: number;
  concurrency_limit?: number;
  rate_limit_per_min?: number;
  rate_limit_burst?: number;
  retry_policy_id?: string | null;
  tags?: string[];
  is_paused?: boolean;
}

export class QueueService {
  public static createQueue(dto: CreateQueueDTO): Queue {
    return db.transaction(() => {
      const id = uuidv4();
      const tagsJson = JSON.stringify(dto.tags || ['default']);
      const priority = dto.priority ?? 5;
      const concurrency = dto.concurrency_limit ?? 5;
      const rateLimitPerMin = dto.rate_limit_per_min ?? 120;
      const rateLimitBurst = dto.rate_limit_burst ?? 20;

      db.run(
        `INSERT INTO queues (
           id, project_id, retry_policy_id, name, description, priority,
           concurrency_limit, rate_limit_per_min, rate_limit_burst, is_paused, tags,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          id,
          dto.project_id,
          dto.retry_policy_id || null,
          dto.name,
          dto.description || '',
          priority,
          concurrency,
          rateLimitPerMin,
          rateLimitBurst,
          tagsJson
        ]
      );

      const queue = this.getQueueById(id)!;
      wsHub.broadcast('queue:updated', queue);
      return queue;
    });
  }

  public static getQueueById(id: string): Queue | null {
    const queue = db.queryOne<Queue>('SELECT * FROM queues WHERE id = ?', [id]);
    if (!queue) return null;

    queue.stats = this.getQueueStats(id);
    if (queue.retry_policy_id) {
      queue.retry_policy = db.queryOne<RetryPolicy>(
        'SELECT * FROM retry_policies WHERE id = ?',
        [queue.retry_policy_id]
      ) || undefined;
    }

    return queue;
  }

  public static listQueues(projectId: string): Queue[] {
    const queues = db.queryAll<Queue>(
      'SELECT * FROM queues WHERE project_id = ? ORDER BY priority DESC, created_at ASC',
      [projectId]
    );

    return queues.map((q) => {
      q.stats = this.getQueueStats(q.id);
      if (q.retry_policy_id) {
        q.retry_policy = db.queryOne<RetryPolicy>(
          'SELECT * FROM retry_policies WHERE id = ?',
          [q.retry_policy_id]
        ) || undefined;
      }
      return q;
    });
  }

  public static updateQueue(id: string, dto: UpdateQueueDTO): Queue {
    return db.transaction(() => {
      const current = this.getQueueById(id);
      if (!current) throw new Error('Queue not found');

      const name = dto.name !== undefined ? dto.name : current.name;
      const description = dto.description !== undefined ? dto.description : current.description;
      const priority = dto.priority !== undefined ? dto.priority : current.priority;
      const concurrency = dto.concurrency_limit !== undefined ? dto.concurrency_limit : current.concurrency_limit;
      const rateLimitPerMin = dto.rate_limit_per_min !== undefined ? dto.rate_limit_per_min : current.rate_limit_per_min;
      const rateLimitBurst = dto.rate_limit_burst !== undefined ? dto.rate_limit_burst : current.rate_limit_burst;
      const retryPolicyId = dto.retry_policy_id !== undefined ? dto.retry_policy_id : current.retry_policy_id;
      const isPaused = dto.is_paused !== undefined ? (dto.is_paused ? 1 : 0) : current.is_paused;
      const tags = dto.tags !== undefined ? JSON.stringify(dto.tags) : current.tags;

      db.run(
        `UPDATE queues
         SET name = ?, description = ?, priority = ?, concurrency_limit = ?,
             rate_limit_per_min = ?, rate_limit_burst = ?, retry_policy_id = ?,
             is_paused = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          name,
          description,
          priority,
          concurrency,
          rateLimitPerMin,
          rateLimitBurst,
          retryPolicyId,
          isPaused,
          tags,
          id
        ]
      );

      const updated = this.getQueueById(id)!;
      wsHub.broadcast('queue:updated', updated);
      return updated;
    });
  }

  public static pauseQueue(id: string): Queue {
    return this.updateQueue(id, { is_paused: true });
  }

  public static resumeQueue(id: string): Queue {
    return this.updateQueue(id, { is_paused: false });
  }

  public static deleteQueue(id: string): boolean {
    const res = db.run('DELETE FROM queues WHERE id = ?', [id]);
    return res.changes > 0;
  }

  public static getQueueStats(queueId: string): QueueStats {
    const counts = db.queryAll<{ status: string; count: number }>(
      'SELECT status, COUNT(*) as count FROM jobs WHERE queue_id = ? GROUP BY status',
      [queueId]
    );

    let queued = 0;
    let scheduled = 0;
    let running = 0;
    let completed = 0;
    let failed = 0;
    let dead_letter = 0;

    for (const row of counts) {
      if (row.status === 'queued') queued = row.count;
      else if (row.status === 'scheduled') scheduled = row.count;
      else if (row.status === 'claimed' || row.status === 'running') running += row.count;
      else if (row.status === 'completed') completed = row.count;
      else if (row.status === 'failed') failed = row.count;
      else if (row.status === 'dead_letter') dead_letter = row.count;
    }

    // Average latency of completed executions in this queue
    const latencyRow = db.queryOne<{ avg_latency: number }>(
      `SELECT AVG(duration_ms) as avg_latency
       FROM job_executions je
       JOIN jobs j ON je.job_id = j.id
       WHERE j.queue_id = ? AND je.status = 'completed' AND je.duration_ms IS NOT NULL`,
      [queueId]
    );

    // Throughput in last 60 seconds
    const throughputRow = db.queryOne<{ recent_count: number }>(
      `SELECT COUNT(*) as recent_count
       FROM jobs
       WHERE queue_id = ? AND status = 'completed'
       AND completed_at >= datetime('now', '-1 minute')`,
      [queueId]
    );

    return {
      queued,
      scheduled,
      running,
      completed,
      failed,
      dead_letter,
      total_processed: completed + failed + dead_letter,
      avg_latency_ms: Math.round(latencyRow?.avg_latency || 0),
      throughput_per_min: throughputRow?.recent_count || 0
    };
  }
}
