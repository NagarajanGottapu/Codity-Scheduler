# REST API & WebSocket Protocol Documentation

Base URL: `http://localhost:4000/api`  
WebSocket Stream: `ws://localhost:4000/ws`

## Authentication

All REST endpoints accept either:
1. **JWT Bearer Token**: `Authorization: Bearer <token>`
2. **API Key Header**: `X-API-Key: cds_admin_key_998877665544332211`

---

## 1. Authentication Endpoints

### `POST /api/auth/register`
Register a new user account.
```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "dev@codity.io", "password": "SecretPassword123!", "name": "Dev User", "role": "developer"}'
```

### `POST /api/auth/login`
Authenticate and receive a JWT token.
```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@codity.io", "password": "CoditySecret123!"}'
```

---

## 2. Queues Endpoints

### `GET /api/queues?project_id=project-default`
List all queues with real-time health stats.

### `POST /api/queues`
Create a new queue with priority, concurrency, and rate limits.
```bash
curl -X POST http://localhost:4000/api/queues \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cds_admin_key_998877665544332211" \
  -d '{
    "project_id": "project-default",
    "name": "payment-webhooks",
    "priority": 8,
    "concurrency_limit": 10,
    "rate_limit_per_min": 300,
    "tags": ["default", "high-memory"]
  }'
```

### `POST /api/queues/:id/pause`
Pause job claiming for this queue.

### `POST /api/queues/:id/resume`
Resume job claiming for this queue.

---

## 3. Jobs Endpoints

### `POST /api/jobs`
Submit an immediate, delayed, scheduled, or idempotent background job.
```bash
curl -X POST http://localhost:4000/api/jobs \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cds_admin_key_998877665544332211" \
  -d '{
    "queue_id": "queue-default",
    "name": "Process Customer Invoice #9981",
    "priority": 7,
    "idempotency_key": "inv_9981_charge",
    "payload": { "invoice_id": 9981, "amount_usd": 150.00 }
  }'
```

### `POST /api/jobs/batch`
Submit a bulk batch of jobs in a single atomic transaction.
```bash
curl -X POST http://localhost:4000/api/jobs/batch \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cds_admin_key_998877665544332211" \
  -d '{
    "queue_id": "queue-default",
    "batch_name": "Nightly Data Ingestion",
    "items": [
      { "name": "Ingest Shard 1", "payload": { "shard": 1 }, "priority": 5 },
      { "name": "Ingest Shard 2", "payload": { "shard": 2 }, "priority": 5 },
      { "name": "Ingest Shard 3", "payload": { "shard": 3 }, "priority": 5 }
    ]
  }'
```

### `GET /api/jobs?queue_id=...&status=running&page=1&limit=20`
Filter and paginate jobs by status, type, priority, or search query.

### `GET /api/jobs/:id`
Fetch complete job details including all historical execution attempts and live logs.

### `POST /api/jobs/:id/cancel`
Cancel a queued or scheduled job.

### `POST /api/jobs/:id/retry`
Manually re-enqueue a failed or dead-letter job.

---

## 4. Workers Endpoints

### `GET /api/workers`
List all registered worker nodes and their active status.

### `POST /api/workers/spawn`
Dynamically spawn a new worker node in the cluster.
```bash
curl -X POST http://localhost:4000/api/workers/spawn \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cds_admin_key_998877665544332211" \
  -d '{ "name": "Worker-Node-GPU", "concurrency": 8, "tags": ["gpu", "default"] }'
```

### `POST /api/workers/:id/stop`
Gracefully drain active jobs and terminate a worker node.

---

## 5. Workflow DAG Endpoints

### `POST /api/workflows`
Define and trigger a Directed Acyclic Graph (DAG) with step dependencies.
```bash
curl -X POST http://localhost:4000/api/workflows \
  -H "Content-Type: application/json" \
  -H "X-API-Key: cds_admin_key_998877665544332211" \
  -d '{
    "project_id": "project-default",
    "name": "Image Processing Pipeline",
    "nodes": [
      { "step_name": "download", "name": "Download Raw Image", "queue_id": "queue-default", "payload": {} },
      { "step_name": "resize", "name": "Generate Thumbnails", "queue_id": "queue-default", "payload": {} },
      { "step_name": "watermark", "name": "Apply Watermark", "queue_id": "queue-default", "payload": {} },
      { "step_name": "upload", "name": "Upload to CDN", "queue_id": "queue-default", "payload": {} }
    ],
    "edges": [
      { "from_step": "download", "to_step": "resize" },
      { "from_step": "download", "to_step": "watermark" },
      { "from_step": "resize", "to_step": "upload" },
      { "from_step": "watermark", "to_step": "upload" }
    ]
  }'
```

---

## 6. Dead Letter Queue (DLQ) & AI Diagnostics

### `GET /api/dlq?status=unresolved`
List quarantined jobs with AI-generated root cause summaries and remediation plans.

### `POST /api/dlq/:id/replay`
Replay a single dead-letter job back to the active queue.

### `POST /api/dlq/bulk-replay`
Replay all unresolved jobs in the project or queue.

---

## 7. Distributed Locks & Rate Limits

### `POST /api/locks/acquire`
Acquire a distributed mutex with TTL lease and fencing token.
```bash
curl -X POST http://localhost:4000/api/locks/acquire \
  -H "Content-Type: application/json" \
  -d '{ "lock_key": "billing_sync_lock", "owner_id": "worker_01", "ttl_ms": 15000 }'
```

### `POST /api/locks/release`
Release an acquired mutex.

---

## 8. WebSocket Live Stream (`/ws`)

Connect via WebSocket to `ws://localhost:4000/ws`.

### Event Types:
- `job:created`: Broadcast when a new job is ingested.
- `job:status_changed`: Broadcast on every state transition (`queued` &rarr; `claimed` &rarr; `running` &rarr; `completed` / `failed` / `dead_letter`).
- `job:log`: Real-time stdout/stderr log lines emitted by worker execution sandboxes.
- `worker:heartbeat`: Telemetry containing CPU %, memory MB, active slots, and timestamp.
- `queue:updated`: Real-time queue metrics and state adjustments.
- `dlq:alert`: Immediate alert when a job breaches max retries and enters DLQ.
