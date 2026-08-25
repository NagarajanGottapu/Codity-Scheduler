import { Router } from 'express';
import { JobService } from '../services/job.service.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// List jobs with filtering and pagination
router.get('/', authenticate, (req: AuthenticatedRequest, res) => {
  const projectId = (req.query.project_id as string) || 'project-default';
  const queueId = req.query.queue_id as string;
  const status = req.query.status as string;
  const jobType = req.query.job_type as string;
  const search = req.query.search as string;
  const priority = req.query.priority ? parseInt(req.query.priority as string, 10) : undefined;
  const batchId = req.query.batch_id as string;
  const dagId = req.query.dag_id as string;
  const page = req.query.page ? parseInt(req.query.page as string, 10) : 1;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;

  const result = JobService.listJobs({
    project_id: projectId,
    queue_id: queueId,
    status,
    job_type: jobType,
    search,
    priority,
    batch_id: batchId,
    dag_id: dagId,
    page,
    limit
  });

  res.json({ success: true, ...result });
});

// Get job details with execution history and logs
router.get('/:id', authenticate, (req, res) => {
  const job = JobService.getJobById(req.params.id as string);
  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found' });
    return;
  }
  res.json({ success: true, data: job });
});

// Create single job (Immediate, Delayed, Scheduled, Idempotent)
router.post('/', authenticate, requireRole(['admin', 'developer']), (req: AuthenticatedRequest, res) => {
  try {
    const {
      project_id = 'project-default',
      queue_id,
      name,
      job_type,
      payload,
      priority,
      run_at,
      idempotency_key,
      max_retries,
      retry_delay_ms,
      lease_timeout_ms
    } = req.body;

    if (!queue_id || !name) {
      res.status(400).json({ success: false, error: 'queue_id and name are required' });
      return;
    }

    const { job, isDuplicate } = JobService.createJob({
      project_id,
      queue_id,
      name,
      job_type,
      payload,
      priority,
      run_at,
      idempotency_key,
      max_retries,
      retry_delay_ms,
      lease_timeout_ms
    });

    res.status(isDuplicate ? 200 : 201).json({
      success: true,
      data: job,
      isDuplicate,
      message: isDuplicate ? 'Idempotent request: returning existing job' : 'Job created successfully'
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Create batch of jobs
router.post('/batch', authenticate, requireRole(['admin', 'developer']), (req: AuthenticatedRequest, res) => {
  try {
    const {
      project_id = 'project-default',
      queue_id,
      batch_name = 'Batch Task',
      items
    } = req.body;

    if (!queue_id || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({ success: false, error: 'queue_id and non-empty items array are required' });
      return;
    }

    const result = JobService.createBatch(project_id, queue_id, batch_name, items);
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Cancel job
router.post('/:id/cancel', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  try {
    const job = JobService.cancelJob(req.params.id as string);
    res.json({ success: true, data: job, message: 'Job cancelled successfully' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Manually retry a failed/dead-letter job
router.post('/:id/retry', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  try {
    const job = JobService.manualRetry(req.params.id as string);
    res.json({ success: true, data: job, message: 'Job re-queued for execution' });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
