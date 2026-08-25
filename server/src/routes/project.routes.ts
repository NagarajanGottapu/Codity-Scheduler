import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.middleware.js';
import { Project, RetryPolicy } from '../types/index.js';

const router = Router();

// List all projects
router.get('/', authenticate, (req: AuthenticatedRequest, res) => {
  const orgId = req.user?.orgId || 'org-default';
  const projects = db.queryAll<Project>('SELECT * FROM projects WHERE org_id = ? ORDER BY name ASC', [orgId]);
  res.json({ success: true, data: projects });
});

// Create project
router.post('/', authenticate, requireRole(['admin', 'developer']), (req: AuthenticatedRequest, res) => {
  const { name, slug, description } = req.body;
  if (!name) {
    res.status(400).json({ success: false, error: 'Project name is required' });
    return;
  }

  const id = uuidv4();
  const orgId = req.user?.orgId || 'org-default';
  const projectSlug = slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  try {
    db.run(
      `INSERT INTO projects (id, org_id, name, slug, description, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [id, orgId, name, projectSlug, description || '']
    );

    // Create default retry policy for this project
    const policyId = uuidv4();
    db.run(
      `INSERT INTO retry_policies (id, project_id, name, strategy, base_delay_ms, max_delay_ms, max_retries, jitter_factor)
       VALUES (?, ?, 'Default Exponential', 'exponential', 1000, 60000, 3, 0.2)`,
      [policyId, id]
    );

    // Create default general queue
    const queueId = uuidv4();
    db.run(
      `INSERT INTO queues (id, project_id, retry_policy_id, name, description, priority, concurrency_limit, rate_limit_per_min, rate_limit_burst, is_paused)
       VALUES (?, ?, ?, 'default', 'Default background queue', 5, 5, 120, 20, 0)`,
      [queueId, id, policyId]
    );

    const created = db.queryOne<Project>('SELECT * FROM projects WHERE id = ?', [id]);
    res.status(201).json({ success: true, data: created });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Get retry policies for a project
router.get('/:id/retry-policies', authenticate, (req, res) => {
  const policies = db.queryAll<RetryPolicy>(
    'SELECT * FROM retry_policies WHERE project_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );
  res.json({ success: true, data: policies });
});

// Create retry policy
router.post('/:id/retry-policies', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  const { name, strategy = 'exponential', base_delay_ms = 1000, max_delay_ms = 60000, max_retries = 3, jitter_factor = 0.2 } = req.body;
  if (!name) {
    res.status(400).json({ success: false, error: 'Policy name is required' });
    return;
  }

  const id = uuidv4();
  db.run(
    `INSERT INTO retry_policies (id, project_id, name, strategy, base_delay_ms, max_delay_ms, max_retries, jitter_factor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, req.params.id, name, strategy, base_delay_ms, max_delay_ms, max_retries, jitter_factor]
  );

  const created = db.queryOne<RetryPolicy>('SELECT * FROM retry_policies WHERE id = ?', [id]);
  res.status(201).json({ success: true, data: created });
});

export default router;
