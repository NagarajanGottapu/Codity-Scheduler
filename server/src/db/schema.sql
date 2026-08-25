-- ============================================================================
-- CODITY DISTRIBUTED JOB SCHEDULER - RELATIONAL DATABASE SCHEMA
-- Compatible with SQLite (WAL Mode) & PostgreSQL (ANSI SQL / Indexes)
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. ORGANIZATIONS (Multi-Tenancy Foundation)
CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    plan TEXT NOT NULL DEFAULT 'enterprise',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. USERS (Authentication & Role-Based Access Control)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'developer', 'viewer')),
    api_key TEXT UNIQUE NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
);

-- 3. PROJECTS (Project Scopes)
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE,
    UNIQUE (org_id, slug)
);

-- 4. RETRY POLICIES (Configurable Backoff Algorithms)
CREATE TABLE IF NOT EXISTS retry_policies (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    strategy TEXT NOT NULL CHECK(strategy IN ('fixed', 'linear', 'exponential')),
    base_delay_ms INTEGER NOT NULL DEFAULT 1000,
    max_delay_ms INTEGER NOT NULL DEFAULT 60000,
    max_retries INTEGER NOT NULL DEFAULT 3,
    jitter_factor REAL NOT NULL DEFAULT 0.2,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 5. QUEUES (Priority, Concurrency Limits, Rate Limits, State)
CREATE TABLE IF NOT EXISTS queues (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    retry_policy_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 10),
    concurrency_limit INTEGER NOT NULL DEFAULT 5,
    rate_limit_per_min INTEGER NOT NULL DEFAULT 120,
    rate_limit_burst INTEGER NOT NULL DEFAULT 20,
    is_paused INTEGER NOT NULL DEFAULT 0,
    tags TEXT DEFAULT '[]', -- JSON array of tags/shards
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (retry_policy_id) REFERENCES retry_policies(id) ON DELETE SET NULL,
    UNIQUE (project_id, name)
);

-- 6. WORKFLOW DAGS (Bonus: Dependency Orchestration)
CREATE TABLE IF NOT EXISTS workflow_dags (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
    total_nodes INTEGER NOT NULL DEFAULT 0,
    completed_nodes INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 7. JOBS (Core Job Entity)
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    queue_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    idempotency_key TEXT,
    name TEXT NOT NULL,
    job_type TEXT NOT NULL CHECK(job_type IN ('immediate', 'delayed', 'scheduled', 'cron', 'batch', 'dag_step')),
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'scheduled', 'claimed', 'running', 'completed', 'failed', 'dead_letter', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 10),
    payload TEXT NOT NULL DEFAULT '{}', -- JSON input
    result TEXT, -- JSON output
    error_message TEXT,
    error_stack TEXT,
    run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at DATETIME,
    started_at DATETIME,
    completed_at DATETIME,
    lease_timeout_ms INTEGER NOT NULL DEFAULT 30000,
    worker_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_delay_ms INTEGER NOT NULL DEFAULT 1000,
    batch_id TEXT,
    dag_id TEXT,
    dag_step_name TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (dag_id) REFERENCES workflow_dags(id) ON DELETE CASCADE,
    UNIQUE (project_id, idempotency_key)
);

-- 8. WORKFLOW EDGES (DAG Dependency Graph)
CREATE TABLE IF NOT EXISTS workflow_edges (
    id TEXT PRIMARY KEY,
    dag_id TEXT NOT NULL,
    parent_job_id TEXT NOT NULL,
    child_job_id TEXT NOT NULL,
    condition TEXT NOT NULL DEFAULT 'on_success' CHECK(condition IN ('on_success', 'on_failure', 'always')),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dag_id) REFERENCES workflow_dags(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (child_job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    UNIQUE (parent_job_id, child_job_id)
);

-- 9. WORKERS (Worker Registry & Shard Tags)
CREATE TABLE IF NOT EXISTS workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    hostname TEXT NOT NULL,
    ip_address TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'busy', 'draining', 'dead', 'offline')),
    concurrency INTEGER NOT NULL DEFAULT 5,
    active_jobs_count INTEGER NOT NULL DEFAULT 0,
    tags TEXT NOT NULL DEFAULT '["default"]', -- JSON array of tags e.g. ["high-memory", "default"]
    last_heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    metrics TEXT DEFAULT '{}' -- JSON: cpu, mem
);

-- 10. WORKER HEARTBEATS (Worker Health Telemetry History)
CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id TEXT PRIMARY KEY,
    worker_id TEXT NOT NULL,
    status TEXT NOT NULL,
    active_jobs INTEGER NOT NULL DEFAULT 0,
    cpu_pct REAL NOT NULL DEFAULT 0.0,
    mem_mb REAL NOT NULL DEFAULT 0.0,
    recorded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- 11. JOB EXECUTIONS (Detailed Execution History per Attempt)
CREATE TABLE IF NOT EXISTS job_executions (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    worker_id TEXT NOT NULL,
    attempt_number INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'timeout')),
    started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    duration_ms INTEGER,
    cpu_usage_pct REAL,
    memory_usage_mb REAL,
    exit_code INTEGER,
    error_message TEXT,
    error_stack TEXT,
    result_preview TEXT,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

-- 12. JOB LOGS (Live & Persisted Execution Logs)
CREATE TABLE IF NOT EXISTS job_logs (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    execution_id TEXT,
    worker_id TEXT,
    level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error', 'debug')),
    message TEXT NOT NULL,
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (execution_id) REFERENCES job_executions(id) ON DELETE CASCADE
);

-- 13. SCHEDULED JOBS (Cron & Recurring Task Definitions)
CREATE TABLE IF NOT EXISTS scheduled_jobs (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    queue_id TEXT NOT NULL,
    name TEXT NOT NULL,
    cron_expression TEXT NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    payload TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    last_run_at DATETIME,
    next_run_at DATETIME NOT NULL,
    total_runs INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE
);

-- 14. DEAD LETTER QUEUE (DLQ - Permanent Failures & AI Analysis)
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id TEXT PRIMARY KEY,
    job_id TEXT UNIQUE NOT NULL,
    queue_id TEXT NOT NULL,
    project_id TEXT NOT NULL,
    failed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    failure_reason TEXT NOT NULL,
    error_stack TEXT,
    payload TEXT NOT NULL,
    attempt_count INTEGER NOT NULL,
    ai_root_cause_analysis TEXT, -- JSON: { category, root_cause, resolution, confidence }
    status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('unresolved', 'replayed', 'archived')),
    replayed_at DATETIME,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- 15. DISTRIBUTED LOCKS (Bonus: Distributed Mutex with TTL)
CREATE TABLE IF NOT EXISTS distributed_locks (
    lock_key TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    fencing_token INTEGER NOT NULL DEFAULT 1
);

-- 16. RATE LIMITS (Bonus: Token Bucket State)
CREATE TABLE IF NOT EXISTS rate_limits (
    bucket_key TEXT PRIMARY KEY,
    tokens_remaining REAL NOT NULL,
    last_refill_at INTEGER NOT NULL, -- Unix timestamp in ms
    refill_rate_per_sec REAL NOT NULL,
    capacity REAL NOT NULL
);

-- 17. WEBHOOK SUBSCRIPTIONS (Bonus: Event-Driven Triggers)
CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL DEFAULT '["job.completed","job.failed","dlq.new"]', -- JSON array
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- ============================================================================
-- PERFORMANCE OPTIMIZATION INDEXES
-- ============================================================================

-- Fast Job Claiming Index (Priority, FIFO, Scheduled time, Status)
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (queue_id, status, run_at, priority DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs (status);
CREATE INDEX IF NOT EXISTS idx_jobs_project_status ON jobs (project_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_batch ON jobs (batch_id);
CREATE INDEX IF NOT EXISTS idx_jobs_dag ON jobs (dag_id);
CREATE INDEX IF NOT EXISTS idx_jobs_lease ON jobs (status, claimed_at, lease_timeout_ms);

-- Executions & Logs Indexes
CREATE INDEX IF NOT EXISTS idx_executions_job ON job_executions (job_id, attempt_number);
CREATE INDEX IF NOT EXISTS idx_logs_job ON job_logs (job_id, timestamp ASC);

-- Worker Telemetry Index
CREATE INDEX IF NOT EXISTS idx_workers_heartbeat ON workers (status, last_heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_heartbeats_worker ON worker_heartbeats (worker_id, recorded_at DESC);

-- Scheduled & DLQ Indexes
CREATE INDEX IF NOT EXISTS idx_scheduled_next_run ON scheduled_jobs (is_active, next_run_at);
CREATE INDEX IF NOT EXISTS idx_dlq_project_status ON dead_letter_queue (project_id, status);
