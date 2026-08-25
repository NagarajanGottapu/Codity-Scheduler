import { Router } from 'express';
import { db } from '../db/database.js';
import { workerManager } from '../services/worker.manager.js';
import { authenticate, AuthenticatedRequest } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/system', authenticate, (req: AuthenticatedRequest, res) => {
  const projectId = (req.query.project_id as string) || 'project-default';

  // Aggregate job counts by status
  const jobCounts = db.queryAll<{ status: string; count: number }>(
    'SELECT status, COUNT(*) as count FROM jobs WHERE project_id = ? GROUP BY status',
    [projectId]
  );

  const statusMap: Record<string, number> = {
    queued: 0,
    scheduled: 0,
    claimed: 0,
    running: 0,
    completed: 0,
    failed: 0,
    dead_letter: 0,
    cancelled: 0
  };

  for (const item of jobCounts) {
    statusMap[item.status] = item.count;
  }

  // Latency & duration averages
  const durationStats = db.queryOne<{ avg_duration: number; p95_duration: number; min_duration: number; max_duration: number }>(
    `SELECT
       AVG(duration_ms) as avg_duration,
       MIN(duration_ms) as min_duration,
       MAX(duration_ms) as max_duration
     FROM job_executions
     WHERE status = 'completed' AND duration_ms IS NOT NULL`
  );

  // Hourly throughput for the last 12 hours
  const hourlyThroughput = db.queryAll<{ hour: string; count: number }>(
    `SELECT strftime('%H:00', completed_at) as hour, COUNT(*) as count
     FROM jobs
     WHERE project_id = ? AND status = 'completed' AND completed_at >= datetime('now', '-12 hours')
     GROUP BY strftime('%H:00', completed_at)
     ORDER BY hour ASC`,
    [projectId]
  );

  const clusterStats = workerManager.getClusterStats();

  res.json({
    success: true,
    data: {
      jobCounts: statusMap,
      totalJobs: Object.values(statusMap).reduce((a, b) => a + b, 0),
      activeExecuting: statusMap.running + statusMap.claimed,
      durationStats: {
        avgMs: Math.round(durationStats?.avg_duration || 0),
        minMs: durationStats?.min_duration || 0,
        maxMs: durationStats?.max_duration || 0
      },
      hourlyThroughput,
      clusterStats
    }
  });
});

export default router;
