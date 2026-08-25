import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseManager } from '../src/db/database.js';
import { RetryService } from '../src/services/retry.service.js';
import { RateLimiterService } from '../src/services/rate_limiter.service.js';
import { DistributedLockService } from '../src/services/distributed_lock.service.js';
import { DLQService } from '../src/services/dlq.service.js';
import { WorkflowService } from '../src/services/workflow.service.js';
import { WorkerNode } from '../src/worker/worker.node.js';
import { JobService } from '../src/services/job.service.js';
import { QueueService } from '../src/services/queue.service.js';
import { LeaseRecoveryService } from '../src/services/lease.recovery.js';
import { db } from '../src/db/database.js';
import { seedDatabase } from '../src/db/seed.js';

describe('Codity Distributed Job Scheduler - Test Suite', () => {
  beforeEach(() => {
    db.run("DELETE FROM job_logs");
    db.run("DELETE FROM job_executions");
    db.run("DELETE FROM dead_letter_queue");
    db.run("DELETE FROM workflow_edges");
    db.run("DELETE FROM workflow_dags");
    db.run("DELETE FROM jobs");
    seedDatabase();
  });

  describe('1. Retry Policy & Backoff Algorithms', () => {
    it('calculates fixed delay correctly', () => {
      const fixedPolicy = {
        strategy: 'fixed' as const,
        base_delay_ms: 3000,
        max_delay_ms: 10000,
        max_retries: 3,
        jitter_factor: 0
      };

      const attempt1 = RetryService.calculateNextRetry(fixedPolicy, 0);
      expect(attempt1.shouldRetry).toBe(true);
      expect(attempt1.delayMs).toBe(3000);

      const attempt2 = RetryService.calculateNextRetry(fixedPolicy, 1);
      expect(attempt2.shouldRetry).toBe(true);
      expect(attempt2.delayMs).toBe(3000);

      const maxAttempt = RetryService.calculateNextRetry(fixedPolicy, 3);
      expect(maxAttempt.shouldRetry).toBe(false);
    });

    it('calculates linear backoff correctly', () => {
      const linearPolicy = {
        strategy: 'linear' as const,
        base_delay_ms: 1000,
        max_delay_ms: 10000,
        max_retries: 4,
        jitter_factor: 0
      };

      const attempt1 = RetryService.calculateNextRetry(linearPolicy, 0);
      expect(attempt1.delayMs).toBe(1000);

      const attempt2 = RetryService.calculateNextRetry(linearPolicy, 1);
      expect(attempt2.delayMs).toBe(2000);

      const attempt3 = RetryService.calculateNextRetry(linearPolicy, 2);
      expect(attempt3.delayMs).toBe(3000);
    });

    it('calculates exponential backoff with jitter and respects max_delay', () => {
      const expPolicy = {
        strategy: 'exponential' as const,
        base_delay_ms: 1000,
        max_delay_ms: 5000,
        max_retries: 5,
        jitter_factor: 0.1
      };

      const attempt1 = RetryService.calculateNextRetry(expPolicy, 0);
      expect(attempt1.delayMs).toBeGreaterThanOrEqual(1000);

      const attempt2 = RetryService.calculateNextRetry(expPolicy, 1);
      expect(attempt2.delayMs).toBeGreaterThanOrEqual(2000);

      const attempt5 = RetryService.calculateNextRetry(expPolicy, 4);
      expect(attempt5.delayMs).toBeLessThanOrEqual(5000 + 100);
    });
  });

  describe('2. Rate Limiting (Token Bucket)', () => {
    it('allows tokens within capacity and throttles when exhausted', () => {
      const key = `test_bucket_${Date.now()}`;
      const refillRate = 2; // 2 tokens per sec
      const capacity = 5;

      // Consume 3 tokens -> should succeed
      const res1 = RateLimiterService.consume(key, refillRate, capacity, 3);
      expect(res1.allowed).toBe(true);
      expect(res1.tokensRemaining).toBe(2);

      // Consume 2 tokens -> should succeed
      const res2 = RateLimiterService.consume(key, refillRate, capacity, 2);
      expect(res2.allowed).toBe(true);
      expect(Math.round(res2.tokensRemaining)).toBe(0);

      // Consume 1 token when 0 remaining -> should be rejected with retryAfterMs
      const res3 = RateLimiterService.consume(key, refillRate, capacity, 1);
      expect(res3.allowed).toBe(false);
      expect(res3.retryAfterMs).toBeGreaterThan(0);
    });
  });

  describe('3. Distributed Locking (Mutex)', () => {
    it('acquires lock, blocks second owner, and releases lock', () => {
      const lockKey = `resource_mutex_${Date.now()}`;
      const ownerA = 'worker_node_A';
      const ownerB = 'worker_node_B';

      // Worker A acquires lock
      const lockA = DistributedLockService.acquireLock(lockKey, ownerA, 5000);
      expect(lockA.acquired).toBe(true);
      expect(lockA.fencingToken).toBe(1);

      // Worker B tries to acquire same lock -> must fail
      const lockB = DistributedLockService.acquireLock(lockKey, ownerB, 5000);
      expect(lockB.acquired).toBe(false);
      expect(lockB.ownerId).toBe(ownerA);

      // Worker A releases lock
      const released = DistributedLockService.releaseLock(lockKey, ownerA);
      expect(released).toBe(true);

      // Now Worker B can acquire lock
      const lockB2 = DistributedLockService.acquireLock(lockKey, ownerB, 5000);
      expect(lockB2.acquired).toBe(true);
      expect(lockB2.ownerId).toBe(ownerB);
    });
  });

  describe('4. Dead Letter Queue & AI Failure Diagnostics', () => {
    it('generates correct AI diagnosis category for rate limits and database errors', () => {
      const diagRateLimit = DLQService.generateAIDiagnosis(
        'Stripe Webhook',
        'HTTP 429: Too Many Requests from downstream API service.'
      );
      expect(diagRateLimit.category).toBe('RATE_LIMIT_EXCEEDED');
      expect(diagRateLimit.auto_remediable).toBe(true);
      expect(diagRateLimit.confidence).toBeGreaterThan(0.9);

      const diagDb = DLQService.generateAIDiagnosis(
        'Order Processing',
        'Database transaction lock timeout / deadlock'
      );
      expect(diagDb.category).toBe('DATABASE_TIMEOUT');
      expect(diagDb.confidence).toBeGreaterThan(0.9);
    });

    it('moves failed job to DLQ and replays back to queued state', () => {
      const queue = QueueService.createQueue({
        project_id: 'project-default',
        name: `test-dlq-queue-${Date.now()}`
      });

      const { job } = JobService.createJob({
        project_id: 'project-default',
        queue_id: queue.id,
        name: 'Failing Job Demo',
        payload: { test: true }
      });

      // Move to DLQ
      const dlqEntry = DLQService.moveToDLQ(job, 'Simulated Crash Error', 'Error: Stack trace');
      expect(dlqEntry.status).toBe('unresolved');
      expect(dlqEntry.failure_reason).toBe('Simulated Crash Error');

      // Replay from DLQ
      const replayed = DLQService.replayJob(dlqEntry.id);
      expect(replayed.status).toBe('queued');
      expect(replayed.attempt_count).toBe(0);
    });
  });

  describe('5. Concurrency & Atomic Job Claiming', () => {
    it('ensures two concurrent workers claim distinct jobs without double claiming', () => {
      const queue = QueueService.createQueue({
        project_id: 'project-default',
        name: `concurrency-test-${Date.now()}`,
        priority: 10,
        concurrency_limit: 10
      });

      // Create 2 jobs
      const job1 = JobService.createJob({
        project_id: 'project-default',
        queue_id: queue.id,
        name: 'Job 1',
        priority: 8
      }).job;

      const job2 = JobService.createJob({
        project_id: 'project-default',
        queue_id: queue.id,
        name: 'Job 2',
        priority: 5
      }).job;

      const worker1 = new WorkerNode({ id: 'w1', name: 'Worker-1' });
      const worker2 = new WorkerNode({ id: 'w2', name: 'Worker-2' });

      // Worker 1 claims top job (Job 1)
      const claimed1 = worker1.claimNextJob();
      expect(claimed1).not.toBeNull();
      expect(claimed1?.id).toBe(job1.id);
      expect(claimed1?.status).toBe('claimed');

      // Worker 2 claims next job (Job 2)
      const claimed2 = worker2.claimNextJob();
      expect(claimed2).not.toBeNull();
      expect(claimed2?.id).toBe(job2.id);
      expect(claimed2?.status).toBe('claimed');

      // Subsequent claim returns null (no more available jobs)
      const claimed3 = worker1.claimNextJob();
      expect(claimed3).toBeNull();
    });

    it('enforces idempotency key to prevent duplicate job submissions', () => {
      const queue = QueueService.createQueue({
        project_id: 'project-default',
        name: `idempotency-test-${Date.now()}`
      });

      const key = `idem_${Date.now()}`;
      const first = JobService.createJob({
        project_id: 'project-default',
        queue_id: queue.id,
        name: 'Payment Capture',
        idempotency_key: key,
        payload: { amount: 100 }
      });
      expect(first.isDuplicate).toBe(false);

      const second = JobService.createJob({
        project_id: 'project-default',
        queue_id: queue.id,
        name: 'Payment Capture Duplicate',
        idempotency_key: key,
        payload: { amount: 100 }
      });
      expect(second.isDuplicate).toBe(true);
      expect(second.job.id).toBe(first.job.id);
    });
  });

  describe('6. DAG Workflow Dependency Engine', () => {
    it('detects cycles in invalid DAG specifications and rejects them', () => {
      const nodes = ['A', 'B', 'C'];
      const cyclicEdges = [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'C' },
        { from: 'C', to: 'A' } // Cycle!
      ];

      const isAcyclic = WorkflowService.validateAcyclic(nodes, cyclicEdges);
      expect(isAcyclic).toBe(false);
    });

    it('creates DAG workflow, enqueues root step, and unlocks downstream steps upon completion', () => {
      const queue = QueueService.createQueue({
        project_id: 'project-default',
        name: `dag-test-queue-${Date.now()}`
      });

      const workflow = WorkflowService.createWorkflow({
        project_id: 'project-default',
        name: 'Pipeline Test',
        nodes: [
          { step_name: 'step1', name: 'Step 1 (Root)', queue_id: queue.id, payload: {} },
          { step_name: 'step2', name: 'Step 2 (Child)', queue_id: queue.id, payload: {} }
        ],
        edges: [{ from_step: 'step1', to_step: 'step2' }]
      });

      expect(workflow.total_nodes).toBe(2);
      expect(workflow.nodes).toHaveLength(2);

      const step1 = workflow.nodes?.find((n) => n.dag_step_name === 'step1');
      const step2 = workflow.nodes?.find((n) => n.dag_step_name === 'step2');

      // Root step starts 'queued'
      expect(step1?.status).toBe('queued');
      // Child step starts 'scheduled' waiting for parent
      expect(step2?.status).toBe('scheduled');

      // Simulate step 1 completion
      db.run("UPDATE jobs SET status = 'completed' WHERE id = ?", [step1!.id]);
      WorkflowService.onStepCompleted(step1!.id);

      // Step 2 should now be unlocked and moved to 'queued'
      const refreshedStep2 = JobService.getJobById(step2!.id);
      expect(refreshedStep2?.status).toBe('queued');
    });
  });

  describe('7. Zombie Worker Detection & Lease Recovery', () => {
    it('detects dead workers and recovers orphaned jobs', () => {
      const queue = QueueService.createQueue({
        project_id: 'project-default',
        name: `zombie-test-${Date.now()}`
      });

      // Insert dead worker (heartbeat 20s ago)
      const zombieId = `zombie_${Date.now()}`;
      const staleTime = new Date(Date.now() - 20000).toISOString();
      db.run(
        `INSERT INTO workers (id, name, hostname, status, concurrency, active_jobs_count, last_heartbeat_at, started_at)
         VALUES (?, 'Dead Worker', 'host-1', 'active', 2, 1, ?, ?)`,
        [zombieId, staleTime, staleTime]
      );

      // Create stuck job assigned to this zombie worker
      const job = JobService.createJob({
        project_id: 'project-default',
        queue_id: queue.id,
        name: 'Stuck Task',
        priority: 7
      }).job;

      db.run(
        `UPDATE jobs
         SET status = 'running', worker_id = ?, claimed_at = ?, started_at = ?
         WHERE id = ?`,
        [zombieId, staleTime, staleTime, job.id]
      );

      // Run lease recovery
      const deadCount = LeaseRecoveryService.detectZombieWorkers(15000);
      expect(deadCount).toBeGreaterThanOrEqual(1);

      const recoveredCount = LeaseRecoveryService.recoverExpiredLeases();
      expect(recoveredCount).toBeGreaterThanOrEqual(1);

      const recoveredJob = JobService.getJobById(job.id);
      expect(recoveredJob?.status).toBe('queued');
      expect(recoveredJob?.worker_id).toBeNull();
    });
  });
});
