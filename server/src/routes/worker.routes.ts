import { Router } from 'express';
import { workerManager } from '../services/worker.manager.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// List all workers
router.get('/', authenticate, (req, res) => {
  const workers = workerManager.listWorkers();
  res.json({ success: true, data: workers });
});

// Cluster aggregate telemetry
router.get('/stats/cluster', authenticate, (req, res) => {
  const stats = workerManager.getClusterStats();
  res.json({ success: true, data: stats });
});

// Get specific worker
router.get('/:id', authenticate, (req, res) => {
  const worker = workerManager.getWorker(req.params.id as string);
  if (!worker) {
    res.status(404).json({ success: false, error: 'Worker not found' });
    return;
  }
  res.json({ success: true, data: worker });
});

// Dynamically spawn a new worker node
router.post('/spawn', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const { name, concurrency = 5, tags = ['default'] } = req.body;
    const worker = await workerManager.spawnWorker(name, concurrency, tags);
    res.status(201).json({
      success: true,
      data: {
        id: worker.id,
        name: worker.name,
        concurrency: worker.concurrency,
        tags: worker.tags
      },
      message: `Worker ${worker.name} successfully spawned and started polling.`
    });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// Stop / drain a worker node
router.post('/:id/stop', authenticate, requireRole(['admin']), async (req, res) => {
  try {
    const ok = await workerManager.stopWorker(req.params.id as string);
    if (!ok) {
      res.status(404).json({ success: false, error: 'Worker not found or already offline' });
      return;
    }
    res.json({ success: true, message: `Worker ${req.params.id} gracefully drained and stopped.` });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});

export default router;
