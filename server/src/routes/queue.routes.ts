import { Router } from 'express';
import { QueueService } from '../services/queue.service.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// List queues for project
router.get('/', authenticate, (req: AuthenticatedRequest, res) => {
  const projectId = (req.query.project_id as string) || 'project-default';
  const queues = QueueService.listQueues(projectId);
  res.json({ success: true, data: queues });
});

// Get queue by ID
router.get('/:id', authenticate, (req, res) => {
  const queue = QueueService.getQueueById(req.params.id as string);
  if (!queue) {
    res.status(404).json({ success: false, error: 'Queue not found' });
    return;
  }
  res.json({ success: true, data: queue });
});

// Create new queue
router.post('/', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  try {
    const {
      project_id = 'project-default',
      name,
      description,
      priority,
      concurrency_limit,
      rate_limit_per_min,
      rate_limit_burst,
      retry_policy_id,
      tags
    } = req.body;

    if (!name) {
      res.status(400).json({ success: false, error: 'Queue name is required' });
      return;
    }

    const queue = QueueService.createQueue({
      project_id,
      name,
      description,
      priority,
      concurrency_limit,
      rate_limit_per_min,
      rate_limit_burst,
      retry_policy_id,
      tags
    });

    res.status(201).json({ success: true, data: queue });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Update queue
router.put('/:id', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  try {
    const queue = QueueService.updateQueue(req.params.id as string, req.body);
    res.json({ success: true, data: queue });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Pause queue
router.post('/:id/pause', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  try {
    const queue = QueueService.pauseQueue(req.params.id as string);
    res.json({ success: true, data: queue, message: 'Queue paused successfully' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Resume queue
router.post('/:id/resume', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  try {
    const queue = QueueService.resumeQueue(req.params.id as string);
    res.json({ success: true, data: queue, message: 'Queue resumed successfully' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get queue live statistics
router.get('/:id/stats', authenticate, (req, res) => {
  const stats = QueueService.getQueueStats(req.params.id as string);
  res.json({ success: true, data: stats });
});

// Delete queue
router.delete('/:id', authenticate, requireRole(['admin']), (req, res) => {
  const ok = QueueService.deleteQueue(req.params.id as string);
  if (!ok) {
    res.status(404).json({ success: false, error: 'Queue not found' });
    return;
  }
  res.json({ success: true, message: 'Queue deleted successfully' });
});

export default router;
