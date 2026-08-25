import cronParser from 'cron-parser';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { ScheduledJob } from '../types/index.js';
import { wsHub } from '../ws/websocket.hub.js';

export interface CreateScheduledJobDTO {
  project_id: string;
  queue_id: string;
  name: string;
  cron_expression: string;
  timezone?: string;
  payload?: any;
}

export class CronSchedulerService {
  private static timer: NodeJS.Timeout | null = null;
  private static isRunning = false;

  public static start(intervalMs = 2000): void {
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

  /**
   * Main cron evaluation tick.
   */
  public static tick(): void {
    try {
      const now = new Date().toISOString();
      const dueJobs = db.queryAll<ScheduledJob>(
        'SELECT * FROM scheduled_jobs WHERE is_active = 1 AND next_run_at <= ?',
        [now]
      );

      for (const schedule of dueJobs) {
        this.executeScheduledJobInstance(schedule);
      }
    } catch (err) {
      console.error('Error during CronSchedulerService tick:', err);
    }
  }

  private static executeScheduledJobInstance(schedule: ScheduledJob): void {
    db.transaction(() => {
      const jobId = uuidv4();
      const now = new Date().toISOString();

      // 1. Create Job execution instance
      db.run(
        `INSERT INTO jobs (
           id, queue_id, project_id, name, job_type, status, priority,
           payload, lease_timeout_ms, attempt_count, max_retries, retry_delay_ms,
           run_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'cron', 'queued', 5, ?, 30000, 0, 3, 1000, ?, ?, ?)`,
        [
          jobId,
          schedule.queue_id,
          schedule.project_id,
          `${schedule.name} (Recurring)`,
          schedule.payload || '{}',
          now,
          now,
          now
        ]
      );

      // 2. Calculate next run at
      let nextRun = new Date(Date.now() + 60000).toISOString();
      try {
        const interval = cronParser.parseExpression(schedule.cron_expression, {
          currentDate: new Date(),
          tz: schedule.timezone || 'UTC'
        });
        nextRun = interval.next().toDate().toISOString();
      } catch (err) {
        console.error(`Invalid cron expression for schedule ${schedule.id}:`, err);
      }

      // 3. Update scheduled job definition
      db.run(
        `UPDATE scheduled_jobs
         SET last_run_at = ?, next_run_at = ?, total_runs = total_runs + 1, updated_at = ?
         WHERE id = ?`,
        [now, nextRun, now, schedule.id]
      );

      const createdJob = db.queryOne('SELECT * FROM jobs WHERE id = ?', [jobId]);
      if (createdJob) {
        wsHub.broadcast('job:created', createdJob);
      }
    });
  }

  public static createSchedule(dto: CreateScheduledJobDTO): ScheduledJob {
    // Validate cron expression
    let nextRun: Date;
    try {
      const interval = cronParser.parseExpression(dto.cron_expression, {
        currentDate: new Date(),
        tz: dto.timezone || 'UTC'
      });
      nextRun = interval.next().toDate();
    } catch (err: any) {
      throw new Error(`Invalid cron expression '${dto.cron_expression}': ${err.message}`);
    }

    const id = uuidv4();
    const payloadJson = typeof dto.payload === 'string' ? dto.payload : JSON.stringify(dto.payload || {});

    db.run(
      `INSERT INTO scheduled_jobs (
         id, project_id, queue_id, name, cron_expression, timezone,
         payload, is_active, next_run_at, total_runs, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        id,
        dto.project_id,
        dto.queue_id,
        dto.name,
        dto.cron_expression,
        dto.timezone || 'UTC',
        payloadJson,
        nextRun.toISOString()
      ]
    );

    return this.getScheduleById(id)!;
  }

  public static getScheduleById(id: string): ScheduledJob | null {
    return db.queryOne<ScheduledJob>(
      `SELECT s.*, q.name as queue_name
       FROM scheduled_jobs s
       JOIN queues q ON s.queue_id = q.id
       WHERE s.id = ?`,
      [id]
    );
  }

  public static listSchedules(projectId: string): ScheduledJob[] {
    return db.queryAll<ScheduledJob>(
      `SELECT s.*, q.name as queue_name
       FROM scheduled_jobs s
       JOIN queues q ON s.queue_id = q.id
       WHERE s.project_id = ?
       ORDER BY s.next_run_at ASC`,
      [projectId]
    );
  }

  public static toggleSchedule(id: string, isActive: boolean): ScheduledJob {
    db.run(
      'UPDATE scheduled_jobs SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [isActive ? 1 : 0, id]
    );
    return this.getScheduleById(id)!;
  }

  public static deleteSchedule(id: string): boolean {
    const res = db.run('DELETE FROM scheduled_jobs WHERE id = ?', [id]);
    return res.changes > 0;
  }
}
