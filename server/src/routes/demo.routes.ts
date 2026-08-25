import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { JobService } from '../services/job.service.js';
import { WorkflowService } from '../services/workflow.service.js';
import { LeaseRecoveryService } from '../services/lease.recovery.js';
import { authenticate } from '../middleware/auth.middleware.js';

const router = Router();

// Demo 1: High-concurrency stress test
router.post('/stress-test', authenticate, (req, res) => {
  const { count = 30, project_id = 'project-default' } = req.body;
  const queues = db.queryAll<{ id: string; name: string }>('SELECT id, name FROM queues WHERE project_id = ?', [project_id]);

  if (queues.length === 0) {
    res.status(400).json({ success: false, error: 'No queues available for demo' });
    return;
  }

  const createdJobs = [];
  const batchId = `stress_${Date.now()}`;

  for (let i = 1; i <= count; i++) {
    const queue = queues[i % queues.length];
    const priority = Math.floor(Math.random() * 9) + 1; // 1 to 10
    const duration = Math.floor(Math.random() * 600) + 200;

    const { job } = JobService.createJob({
      project_id,
      queue_id: queue.id,
      name: `Benchmark Task #${i} [P:${priority}]`,
      priority,
      batch_id: batchId,
      payload: {
        task_index: i,
        work_duration_ms: duration,
        dataset_chunk: `data_shard_${i}_000`,
        benchmark_id: batchId
      }
    });

    createdJobs.push(job);
  }

  res.json({
    success: true,
    count: createdJobs.length,
    batch_id: batchId,
    message: `Spawned ${createdJobs.length} concurrent benchmark jobs across ${queues.length} queues!`
  });
});

// Demo 2: Failure & AI DLQ simulation
router.post('/simulate-failure', authenticate, (req, res) => {
  const { project_id = 'project-default', failure_type = 'RATE_LIMIT' } = req.body;
  const queue = db.queryOne<{ id: string }>('SELECT id FROM queues WHERE project_id = ? LIMIT 1', [project_id]);

  if (!queue) {
    res.status(400).json({ success: false, error: 'No queue found' });
    return;
  }

  const failureTypes = [
    { type: 'RATE_LIMIT', name: 'Third-party API Sync (Rate Limited 429)' },
    { type: 'DATABASE_DEADLOCK', name: 'Financial Transaction Commit (DB Deadlock)' },
    { type: 'AUTH_ERROR', name: 'OAuth Token Exchange (Invalid JWT 401)' },
    { type: 'OOM', name: 'Image Shard Transformation (Heap OOM)' }
  ];

  const selected = failureTypes.find((f) => f.type === failure_type) || failureTypes[0];

  const { job } = JobService.createJob({
    project_id,
    queue_id: queue.id,
    name: selected.name,
    priority: 8,
    max_retries: 2, // will retry 2 times before routing to DLQ with AI diagnosis
    retry_delay_ms: 800,
    payload: {
      simulate_failure: true,
      failure_type: selected.type,
      work_duration_ms: 300
    }
  });

  res.json({
    success: true,
    data: job,
    message: `Simulated failure job queued. It will retry using Exponential Backoff and automatically route to DLQ with AI Root Cause analysis upon max attempts.`
  });
});

// Demo 3: Trigger Multi-Stage DAG Workflow
router.post('/trigger-dag', authenticate, (req, res) => {
  const { project_id = 'project-default' } = req.body;
  const queue = db.queryOne<{ id: string }>('SELECT id FROM queues WHERE project_id = ? LIMIT 1', [project_id]);

  if (!queue) {
    res.status(400).json({ success: false, error: 'No queue found' });
    return;
  }

  const workflow = WorkflowService.createWorkflow({
    project_id,
    name: `ETL Data Pipeline - Run #${Date.now().toString().slice(-4)}`,
    description: 'Production 4-Stage Data Extraction, Transformation, Validation, and Storage Pipeline',
    nodes: [
      {
        name: 'Stage 1: Ingest Raw Data',
        step_name: 'ingest_raw',
        queue_id: queue.id,
        payload: { source: 's3://analytics-lake/raw', chunk_size_mb: 250, work_duration_ms: 700 }
      },
      {
        name: 'Stage 2A: Cleanse & Normalize',
        step_name: 'cleanse_data',
        queue_id: queue.id,
        payload: { strip_pii: true, deduplicate: true, work_duration_ms: 600 }
      },
      {
        name: 'Stage 2B: Validate Schema & Types',
        step_name: 'validate_schema',
        queue_id: queue.id,
        payload: { strict_mode: true, work_duration_ms: 500 }
      },
      {
        name: 'Stage 3: Load to Data Warehouse',
        step_name: 'load_warehouse',
        queue_id: queue.id,
        payload: { target_table: 'fact_orders_daily', work_duration_ms: 800 }
      }
    ],
    edges: [
      { from_step: 'ingest_raw', to_step: 'cleanse_data' },
      { from_step: 'ingest_raw', to_step: 'validate_schema' },
      { from_step: 'cleanse_data', to_step: 'load_warehouse' },
      { from_step: 'validate_schema', to_step: 'load_warehouse' }
    ]
  });

  res.status(201).json({
    success: true,
    data: workflow,
    message: 'DAG Workflow triggered! Root step (Stage 1) is running; Stages 2A & 2B will trigger in parallel upon completion, followed by Stage 3.'
  });
});

// Demo 4: Zombie Worker & Lease Recovery Simulation
router.post('/simulate-zombie-recovery', authenticate, (req, res) => {
  const { project_id = 'project-default' } = req.body;
  const queue = db.queryOne<{ id: string }>('SELECT id FROM queues WHERE project_id = ? LIMIT 1', [project_id]);
  if (!queue) {
    res.status(400).json({ success: false, error: 'No queue found' });
    return;
  }

  // 1. Create a dummy dead worker
  const zombieWorkerId = `zombie-worker-${uuidv4().substring(0, 6)}`;
  const staleHeartbeat = new Date(Date.now() - 30000).toISOString(); // 30s ago (exceeded 15s timeout)

  db.run(
    `INSERT INTO workers (id, name, hostname, ip_address, status, concurrency, active_jobs_count, tags, last_heartbeat_at, started_at, metrics)
     VALUES (?, 'Zombie-Node (Crashed)', 'node-crashed', '127.0.0.1', 'active', 1, 1, '["default"]', ?, ?, '{}')`,
    [zombieWorkerId, staleHeartbeat, staleHeartbeat]
  );

  // 2. Assign a stuck claimed job to this zombie worker
  const stuckJobId = uuidv4();
  db.run(
    `INSERT INTO jobs (id, queue_id, project_id, name, job_type, status, priority, payload, claimed_at, started_at, lease_timeout_ms, worker_id, attempt_count, max_retries, retry_delay_ms, run_at, created_at, updated_at)
     VALUES (?, ?, ?, 'Stuck Job on Crashed Node', 'immediate', 'running', 10, '{"data": "critical_order"}', ?, ?, 5000, ?, 1, 3, 1000, ?, ?, ?)`,
    [stuckJobId, queue.id, project_id, staleHeartbeat, staleHeartbeat, zombieWorkerId, staleHeartbeat, staleHeartbeat, staleHeartbeat]
  );

  // 3. Immediately trigger LeaseRecoveryService
  const deadWorkersDetected = LeaseRecoveryService.detectZombieWorkers(15000);
  const recoveredJobs = LeaseRecoveryService.recoverExpiredLeases();

  const recoveredJob = db.queryOne('SELECT * FROM jobs WHERE id = ?', [stuckJobId]);

  res.json({
    success: true,
    deadWorkersDetected,
    recoveredJobs,
    job: recoveredJob,
    message: `Zombie worker '${zombieWorkerId}' was detected as dead and its orphaned job was atomically recovered back to 'queued' state!`
  });
});

export default router;
