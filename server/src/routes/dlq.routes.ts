import { Router } from 'express';
import { DLQService } from '../services/dlq.service.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// List DLQ entries with filtering and AI diagnosis
router.get('/', authenticate, (req: AuthenticatedRequest, res) => {
  const projectId = (req.query.project_id as string) || 'project-default';
  const status = req.query.status as string;
  const queueId = req.query.queue_id as string;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

  const result = DLQService.list(projectId, status, queueId, page, limit);
  res.json({ success: true, ...result });
});

// Replay a single failed job
router.post('/:id/replay', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  try {
    const job = DLQService.replayJob(req.params.id as string);
    res.json({ success: true, data: job, message: 'Job replayed from Dead Letter Queue' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Bulk replay unresolved failed jobs
router.post('/bulk-replay', authenticate, requireRole(['admin', 'developer']), (req: AuthenticatedRequest, res) => {
  try {
    const { project_id = 'project-default', queue_id } = req.body;
    const replayedCount = DLQService.bulkReplay(project_id, queue_id);
    res.json({ success: true, count: replayedCount, message: `Successfully replayed ${replayedCount} jobs` });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Purge DLQ entries
router.delete('/purge', authenticate, requireRole(['admin']), (req: AuthenticatedRequest, res) => {
  const { project_id = 'project-default', dlq_id } = req.body;
  const purgedCount = DLQService.purge(project_id, dlq_id);
  res.json({ success: true, count: purgedCount, message: `Purged ${purgedCount} DLQ records` });
});

export default router;
