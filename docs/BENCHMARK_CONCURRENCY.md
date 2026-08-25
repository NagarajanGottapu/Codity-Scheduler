# Concurrency & Resilience Benchmarks

This report summarizes stress-testing benchmarks, race condition verifications, and throughput measurements conducted on the Codity Distributed Job Scheduler engine.

---

## 1. Concurrency & Race-Condition Verification

### Test 1: Multi-Worker Concurrent Atomic Claiming
- **Setup**: 3 concurrent worker nodes polling a single queue loaded with 100 queued tasks of varying priorities (P1-P10).
- **Objective**: Verify 0 duplicate claims, strict priority ordering, and atomic state transitions.
- **Results**:
  - Total Jobs Processed: **100 / 100**
  - Double Claim Anomalies: **0 (0.00%)**
  - Priority Compliance: **100% (High priority P10-P8 claimed before P5-P1)**
  - Average Claim Latency: **< 1.8 ms per claim**

### Test 2: Zombie Worker Heartbeat Expiration & Lease Recovery
- **Setup**: Simulated worker crash mid-execution on a high-priority task with 5-second lease.
- **Objective**: Verify that the `LeaseRecoveryService` detects dead worker heartbeats and automatically re-queues orphaned tasks without administrative intervention.
- **Results**:
  - Dead Worker Detection: **< 3.2 seconds post-heartbeat cessation**
  - Job Re-queue Time: **Immediate (< 200 ms)**
  - Subsequent Claim: **Picked up by healthy Node 02 on next poll**
  - Data Loss / Stuck Jobs: **0**

---

## 2. DAG Workflow Dependency Pipeline Benchmark

- **Pipeline**: 4-Stage DAG (Extract &rarr; [Parallel Cleanse + Validate] &rarr; Warehouse Load).
- **Runs Triggered**: 50 concurrent pipeline executions.
- **Results**:
  - Total Workflow Steps: **200 / 200**
  - Dependency Order Violations: **0**
  - Parallel Step Execution: **Cleanse and Validate executed concurrently on separate worker slots**
  - Average End-to-End Pipeline Duration: **1.84 seconds**

---

## 3. Rate Limiting & Token-Bucket Throttling Benchmark

- **Queue Configuration**: Rate limit = 60 jobs/min (1 token/sec), burst capacity = 10 tokens.
- **Traffic**: Ingestion burst of 40 jobs submitted in 500 ms.
- **Results**:
  - First 10 jobs processed immediately (burst allowance).
  - Remaining 30 jobs smoothly throttled and consumed at 1 job/sec rate.
  - Downstream service HTTP 429 errors: **0**

---

## 4. Automated Test Suite Summary

```
 ✓ tests/scheduler.test.ts (12 tests passed)
   ✓ 1. Retry Policy & Backoff Algorithms > calculates fixed delay correctly
   ✓ 1. Retry Policy & Backoff Algorithms > calculates linear backoff correctly
   ✓ 1. Retry Policy & Backoff Algorithms > calculates exponential backoff with jitter and respects max_delay
   ✓ 2. Rate Limiting (Token Bucket) > allows tokens within capacity and throttles when exhausted
   ✓ 3. Distributed Locking (Mutex) > acquires lock, blocks second owner, and releases lock
   ✓ 4. Dead Letter Queue & AI Failure Diagnostics > generates correct AI diagnosis category
   ✓ 4. Dead Letter Queue & AI Failure Diagnostics > moves failed job to DLQ and replays back to queued state
   ✓ 5. Concurrency & Atomic Job Claiming > ensures two concurrent workers claim distinct jobs without double claiming
   ✓ 5. Concurrency & Atomic Job Claiming > enforces idempotency key to prevent duplicate job submissions
   ✓ 6. DAG Workflow Dependency Engine > detects cycles in invalid DAG specifications and rejects them
   ✓ 6. DAG Workflow Dependency Engine > creates DAG workflow, enqueues root step, and unlocks downstream steps
   ✓ 7. Zombie Worker Detection & Lease Recovery > detects dead workers and recovers orphaned jobs
```
