import { Router } from 'express';
import { CronSchedulerService } from '../services/cron.scheduler.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// List scheduled jobs for project
router.get('/', authenticate, (req: AuthenticatedRequest, res) => {
  const projectId = (req.query.project_id as string) || 'project-default';
  const schedules = CronSchedulerService.listSchedules(projectId);
  res.json({ success: true, data: schedules });
});

// Create scheduled job
router.post('/', authenticate, requireRole(['admin', 'developer']), (req: AuthenticatedRequest, res) => {
  try {
    const {
      project_id = 'project-default',
      queue_id,
      name,
      cron_expression,
      timezone,
      payload
    } = req.body;

    if (!queue_id || !name || !cron_expression) {
      res.status(400).json({ success: false, error: 'queue_id, name, and cron_expression are required' });
      return;
    }

    const created = CronSchedulerService.createSchedule({
      project_id,
      queue_id,
      name,
      cron_expression,
      timezone,
      payload
    });

    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Toggle schedule active/paused
router.post('/:id/toggle', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  try {
    const { is_active } = req.body;
    const updated = CronSchedulerService.toggleSchedule(req.params.id as string, is_active ?? true);
    res.json({ success: true, data: updated });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Delete schedule
router.delete('/:id', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  const ok = CronSchedulerService.deleteSchedule(req.params.id as string);
  if (!ok) {
    res.status(404).json({ success: false, error: 'Schedule not found' });
    return;
  }
  res.json({ success: true, message: 'Schedule deleted successfully' });
});

export default router;
