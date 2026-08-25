import { Router } from 'express';
import { WorkflowService } from '../services/workflow.service.js';
import { authenticate, AuthenticatedRequest, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// List workflows for project
router.get('/', authenticate, (req: AuthenticatedRequest, res) => {
  const projectId = (req.query.project_id as string) || 'project-default';
  const workflows = WorkflowService.listWorkflows(projectId);
  res.json({ success: true, data: workflows });
});

// Get workflow by ID
router.get('/:id', authenticate, (req, res) => {
  const workflow = WorkflowService.getWorkflowById(req.params.id as string);
  if (!workflow) {
    res.status(404).json({ success: false, error: 'Workflow DAG not found' });
    return;
  }
  res.json({ success: true, data: workflow });
});

// Create and trigger a DAG workflow
router.post('/', authenticate, requireRole(['admin', 'developer']), (req: AuthenticatedRequest, res) => {
  try {
    const {
      project_id = 'project-default',
      name,
      description,
      nodes,
      edges
    } = req.body;

    if (!name || !Array.isArray(nodes) || nodes.length === 0) {
      res.status(400).json({ success: false, error: 'name and non-empty nodes array are required' });
      return;
    }

    const workflow = WorkflowService.createWorkflow({
      project_id,
      name,
      description,
      nodes,
      edges: edges || []
    });

    res.status(201).json({ success: true, data: workflow });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
