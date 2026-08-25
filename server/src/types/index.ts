// TypeScript Type Definitions for Codity Distributed Job Scheduler

export type UserRole = 'admin' | 'developer' | 'viewer';

export type JobType = 'immediate' | 'delayed' | 'scheduled' | 'cron' | 'batch' | 'dag_step';

export type JobStatus =
  | 'queued'
  | 'scheduled'
  | 'claimed'
  | 'running'
  | 'completed'
  | 'failed'
  | 'dead_letter'
  | 'cancelled';

export type RetryStrategy = 'fixed' | 'linear' | 'exponential';

export type WorkerStatus = 'active' | 'busy' | 'draining' | 'dead' | 'offline';

export type DAGStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type DLQStatus = 'unresolved' | 'replayed' | 'archived';

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  org_id: string;
  email: string;
  password_hash: string;
  name: string;
  role: UserRole;
  api_key: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description?: string;
  created_at: string;
  updated_at: string;
}

export interface RetryPolicy {
  id: string;
  project_id: string;
  name: string;
  strategy: RetryStrategy;
  base_delay_ms: number;
  max_delay_ms: number;
  max_retries: number;
  jitter_factor: number;
  created_at: string;
  updated_at: string;
}

export interface Queue {
  id: string;
  project_id: string;
  retry_policy_id?: string | null;
  name: string;
  description?: string;
  priority: number;
  concurrency_limit: number;
  rate_limit_per_min: number;
  rate_limit_burst: number;
  is_paused: number;
  tags: string; // JSON string array
  created_at: string;
  updated_at: string;
  // Computed fields
  stats?: QueueStats;
  retry_policy?: RetryPolicy;
}

export interface QueueStats {
  queued: number;
  scheduled: number;
  running: number;
  completed: number;
  failed: number;
  dead_letter: number;
  total_processed: number;
  avg_latency_ms: number;
  throughput_per_min: number;
}

export interface Job<T = any> {
  id: string;
  queue_id: string;
  project_id: string;
  idempotency_key?: string | null;
  name: string;
  job_type: JobType;
  status: JobStatus;
  priority: number;
  payload: string; // JSON
  result?: string | null; // JSON
  error_message?: string | null;
  error_stack?: string | null;
  run_at: string;
  claimed_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  lease_timeout_ms: number;
  worker_id?: string | null;
  attempt_count: number;
  max_retries: number;
  retry_delay_ms: number;
  batch_id?: string | null;
  dag_id?: string | null;
  dag_step_name?: string | null;
  created_at: string;
  updated_at: string;
  // Computed / Joined
  queue_name?: string;
  worker_name?: string;
  executions?: JobExecution[];
  logs?: JobLog[];
}

export interface JobExecution {
  id: string;
  job_id: string;
  worker_id: string;
  attempt_number: number;
  status: 'running' | 'completed' | 'failed' | 'timeout';
  started_at: string;
  completed_at?: string | null;
  duration_ms?: number | null;
  cpu_usage_pct?: number | null;
  memory_usage_mb?: number | null;
  exit_code?: number | null;
  error_message?: string | null;
  error_stack?: string | null;
  result_preview?: string | null;
  worker_name?: string;
}

export interface JobLog {
  id: string;
  job_id: string;
  execution_id?: string | null;
  worker_id?: string | null;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  timestamp: string;
}

export interface Worker {
  id: string;
  name: string;
  hostname: string;
  ip_address?: string | null;
  status: WorkerStatus;
  concurrency: number;
  active_jobs_count: number;
  tags: string; // JSON array
  last_heartbeat_at: string;
  started_at: string;
  metrics: string; // JSON
}

export interface ScheduledJob {
  id: string;
  project_id: string;
  queue_id: string;
  name: string;
  cron_expression: string;
  timezone: string;
  payload: string;
  is_active: number;
  last_run_at?: string | null;
  next_run_at: string;
  total_runs: number;
  created_at: string;
  updated_at: string;
  queue_name?: string;
}

export interface DeadLetterJob {
  id: string;
  job_id: string;
  queue_id: string;
  project_id: string;
  failed_at: string;
  failure_reason: string;
  error_stack?: string | null;
  payload: string;
  attempt_count: number;
  ai_root_cause_analysis?: string | null; // JSON
  status: DLQStatus;
  replayed_at?: string | null;
  job_name?: string;
  queue_name?: string;
}

export interface WorkflowDAG {
  id: string;
  project_id: string;
  name: string;
  description?: string | null;
  status: DAGStatus;
  total_nodes: number;
  completed_nodes: number;
  created_at: string;
  updated_at: string;
  nodes?: Job[];
  edges?: WorkflowEdge[];
}

export interface WorkflowEdge {
  id: string;
  dag_id: string;
  parent_job_id: string;
  child_job_id: string;
  condition: 'on_success' | 'on_failure' | 'always';
  created_at: string;
}

export interface DistributedLock {
  lock_key: string;
  owner_id: string;
  acquired_at: string;
  expires_at: string;
  fencing_token: number;
}

export interface RateLimitBucket {
  bucket_key: string;
  tokens_remaining: number;
  last_refill_at: number;
  refill_rate_per_sec: number;
  capacity: number;
}

export interface WebhookSubscription {
  id: string;
  project_id: string;
  url: string;
  secret: string;
  events: string; // JSON array
  is_active: number;
  created_at: string;
}

export interface AIFailureDiagnosis {
  category:
    | 'DATABASE_TIMEOUT'
    | 'NETWORK_PARTITION'
    | 'AUTHENTICATION_FAILURE'
    | 'RATE_LIMIT_EXCEEDED'
    | 'RESOURCE_EXHAUSTION'
    | 'PAYLOAD_SCHEMA_MISMATCH'
    | 'UNHANDLED_EXCEPTION'
    | 'EXTERNAL_SERVICE_5XX';
  root_cause: string;
  explanation: string;
  recommended_action: string;
  confidence: number;
  auto_remediable: boolean;
}
