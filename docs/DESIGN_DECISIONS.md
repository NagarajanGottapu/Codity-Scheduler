# Design Decisions & Technical Trade-offs

This document details the architectural decisions, design rationales, and engineering trade-offs made during the implementation of the **Codity Distributed Job Scheduler**.

---

## 1. Concurrency & Atomic Job Claiming Strategy

### The Challenge
When multiple worker nodes poll the same queue concurrently, there is a risk of **double claiming** (two workers picking the same job simultaneously) or **lock contention deadlocks**.

### Evaluated Approaches:
1. **Optimistic Locking with Version Fields (`UPDATE jobs SET status='claimed', version=version+1 WHERE id=? AND version=?`)**:
   - *Pros*: Non-blocking reads.
   - *Cons*: High contention under heavy worker concurrency causes excessive retry aborts, wasting CPU cycles.
2. **Pessimistic Row-Level Locking (`SELECT FOR UPDATE SKIP LOCKED` / `BEGIN IMMEDIATE`)**:
   - *Pros*: Workers skip claimed rows and atomically claim the highest-priority eligible task in a single round-trip without race conditions.
   - *Cons*: Requires relational transaction isolation.

### Chosen Decision:
We implemented **Immediate Transactional Claiming (`BEGIN IMMEDIATE`)** with compound indexing (`queue_id, status, run_at, priority DESC, created_at ASC`). In SQLite, `BEGIN IMMEDIATE` acquires a write lock before querying, ensuring atomic serialization of claims across threads. In PostgreSQL production deployments, this maps directly to `SELECT ... FOR UPDATE SKIP LOCKED`.

---

## 2. Worker Heartbeats, Lease Timeouts & Zombie Recovery

### The Challenge
Workers can suffer hard crashes (SIGKILL, OOM, power failure) while executing long-running tasks. Without recovery mechanisms, tasks held by crashed workers remain stuck in `running` status forever.

### Chosen Strategy:
- **Lease Timeout (`lease_timeout_ms`, default 30s)**: Every claimed job is granted a time-bounded lease.
- **Continuous Heartbeat Extension**: Active workers send telemetry every 3 seconds, extending the lease on their active tasks.
- **Decoupled Recovery Daemon (`LeaseRecoveryService`)**: Runs on a separate loop every 3 seconds to detect:
  1. Workers with `last_heartbeat_at < (NOW - 15s)` (marked as `dead`).
  2. Tasks in `claimed` or `running` state whose lease expired or whose worker is dead.
- **Recovery Policy**: Orphaned tasks are atomically reset to `queued` (or routed to DLQ if `attempt_count >= max_retries`), guaranteeing eventual execution even across catastrophic worker failures.

---

## 3. Retry Policies: Exponential Backoff with Jitter vs Fixed Retries

### The Challenge
When downstream dependencies (APIs, databases) experience outages, fixed-interval retries cause **thundering herd / stampede problems**, repeatedly slamming already struggling services.

### Implemented Strategies:
1. **Fixed Delay**: Deterministic delay (`delay = base`).
2. **Linear Backoff**: Step-wise increase (`delay = base * attempt`).
3. **Exponential Backoff with Full Jitter**:
   $$\text{delay} = \min(\text{max\_delay}, \text{base} \times 2^{\text{attempt}-1}) + \text{Random}(0, \text{jitter} \times \text{base})$$

### Rationale:
Exponential backoff with randomized jitter spreads retry attempts across the time domain, allowing downstream recovery while avoiding synchronized retry spikes.

---

## 4. Dead Letter Queue (DLQ) & AI-Assisted Root Cause Diagnosis

### The Challenge
Jobs that fail permanently after exhausting retry attempts consume compute if repeatedly retried. Traditional DLQs leave developers to manually sift through raw stack traces to diagnose issues.

### Implemented Solution:
- Once a job reaches `max_retries`, it is atomically migrated to the `dead_letter_queue` table.
- An **AI Diagnostic Engine** parses the error message, stack trace, and input payload to categorize the failure into standard fault domains (`RATE_LIMIT_EXCEEDED`, `DATABASE_TIMEOUT`, `NETWORK_PARTITION`, `AUTHENTICATION_FAILURE`, `RESOURCE_EXHAUSTION`, `PAYLOAD_SCHEMA_MISMATCH`).
- It generates a human-readable root cause explanation, confidence percentage, and recommended remediation action (e.g. adjust rate limit, rotate token, scale worker memory).
- Supports single-click and bulk replays once remediation is complete.

---

## 5. Directed Acyclic Graph (DAG) Workflow Engine

### The Challenge
Complex background processing requires multi-stage dependencies (e.g., Extract &rarr; Transform & Validation &rarr; Load) where downstream steps only run when upstream steps succeed.

### Design Architecture:
- **Acyclic Graph Validation**: Workflows are validated at ingestion using Kahn's algorithm (`O(V + E)`) to detect cycles before persisting.
- **Decoupled Edge Storage**: Stored as relational entities (`workflow_edges`), linking parent and child jobs.
- **Event-Driven Cascade**: Upon step completion, the system evaluates all incoming dependencies for dependent child steps. When all parents are `completed`, the child is automatically unlocked and enqueued.
- **Failure Short-Circuit**: If an upstream node fails permanently, all dependent scheduled child jobs are cancelled to preserve consistency.

---

## 6. Rate Limiting: Token-Bucket Algorithm

### The Challenge
Protecting downstream systems from burst floods while supporting sustained throughput.

### Chosen Algorithm:
The **Token-Bucket Algorithm** was chosen over Fixed-Window and Leaky-Bucket because:
- Allows controlled burst traffic up to bucket capacity (`rate_limit_burst`).
- Refills tokens continuously based on elapsed time ($\text{tokens} = \min(\text{capacity}, \text{tokens} + \Delta t \times \text{refill\_rate})$).
- Evaluated atomically in transactions during worker job claiming to throttle before job assignment.
