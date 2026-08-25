import { v4 as uuidv4 } from 'uuid';
import { db } from './database.js';
import { AuthService } from '../services/auth.service.js';

export function seedDatabase(): void {
  console.log('🌱 Seeding Codity Distributed Scheduler database...');

  // 1. Organizations
  const orgId = 'org-default';
  db.run(
    `INSERT INTO organizations (id, name, slug, plan, created_at, updated_at)
     VALUES (?, 'Codity Enterprise', 'codity-enterprise', 'enterprise', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(id) DO NOTHING`,
    [orgId]
  );

  // 2. Users with Roles (Admin, Developer, Viewer)
  const passwordHash = AuthService.hashPassword('CoditySecret123!');

  // Admin User
  db.run(
    `INSERT INTO users (id, org_id, email, password_hash, name, role, api_key, is_active)
     VALUES ('user-admin-default', ?, 'admin@codity.io', ?, 'Alex Vance (Admin)', 'admin', 'cds_admin_key_998877665544332211', 1)
     ON CONFLICT(id) DO NOTHING`,
    [orgId, passwordHash]
  );

  // Developer User
  db.run(
    `INSERT INTO users (id, org_id, email, password_hash, name, role, api_key, is_active)
     VALUES ('user-dev-default', ?, 'dev@codity.io', ?, 'Sarah Connor (Developer)', 'developer', 'cds_dev_key_112233445566778899', 1)
     ON CONFLICT(id) DO NOTHING`,
    [orgId, passwordHash]
  );

  // Viewer User
  db.run(
    `INSERT INTO users (id, org_id, email, password_hash, name, role, api_key, is_active)
     VALUES ('user-viewer-default', ?, 'viewer@codity.io', ?, 'John Doe (Viewer)', 'viewer', 'cds_viewer_key_556677889900112233', 1)
     ON CONFLICT(id) DO NOTHING`,
    [orgId, passwordHash]
  );

  // 3. Projects
  const projectId = 'project-default';
  db.run(
    `INSERT INTO projects (id, org_id, name, slug, description)
     VALUES (?, ?, 'Core Cloud Platform', 'core-cloud-platform', 'Primary production asynchronous job processing platform')
     ON CONFLICT(id) DO NOTHING`,
    [projectId, orgId]
  );

  // 4. Retry Policies
  const expPolicyId = 'policy-exp-default';
  const linearPolicyId = 'policy-linear-default';
  const fixedPolicyId = 'policy-fixed-default';

  db.run(
    `INSERT INTO retry_policies (id, project_id, name, strategy, base_delay_ms, max_delay_ms, max_retries, jitter_factor)
     VALUES (?, ?, 'Exponential Backoff with Jitter', 'exponential', 1000, 30000, 3, 0.2)
     ON CONFLICT(id) DO NOTHING`,
    [expPolicyId, projectId]
  );

  db.run(
    `INSERT INTO retry_policies (id, project_id, name, strategy, base_delay_ms, max_delay_ms, max_retries, jitter_factor)
     VALUES (?, ?, 'Linear Backoff', 'linear', 2000, 20000, 4, 0.0)
     ON CONFLICT(id) DO NOTHING`,
    [linearPolicyId, projectId]
  );

  db.run(
    `INSERT INTO retry_policies (id, project_id, name, strategy, base_delay_ms, max_delay_ms, max_retries, jitter_factor)
     VALUES (?, ?, 'Fixed 3s Delay', 'fixed', 3000, 3000, 2, 0.0)
     ON CONFLICT(id) DO NOTHING`,
    [fixedPolicyId, projectId]
  );

  // 5. Queues
  const queueDefault = 'queue-default';
  const queueHighPri = 'queue-high-pri';
  const queueData = 'queue-data';

  db.run(
    `INSERT INTO queues (id, project_id, retry_policy_id, name, description, priority, concurrency_limit, rate_limit_per_min, rate_limit_burst, is_paused, tags)
     VALUES (?, ?, ?, 'default', 'Standard background asynchronous tasks', 5, 5, 300, 25, 0, '["default"]')
     ON CONFLICT(id) DO NOTHING`,
    [queueDefault, projectId, expPolicyId]
  );

  db.run(
    `INSERT INTO queues (id, project_id, retry_policy_id, name, description, priority, concurrency_limit, rate_limit_per_min, rate_limit_burst, is_paused, tags)
     VALUES (?, ?, ?, 'critical-notifications', 'High priority emails, SMS alerts, and webhooks', 9, 8, 600, 50, 0, '["default"]')
     ON CONFLICT(id) DO NOTHING`,
    [queueHighPri, projectId, linearPolicyId]
  );

  db.run(
    `INSERT INTO queues (id, project_id, retry_policy_id, name, description, priority, concurrency_limit, rate_limit_per_min, rate_limit_burst, is_paused, tags)
     VALUES (?, ?, ?, 'heavy-compute', 'ETL batching, image transcode, report generation', 3, 3, 100, 10, 0, '["high-memory", "default"]')
     ON CONFLICT(id) DO NOTHING`,
    [queueData, projectId, expPolicyId]
  );

  // 6. Scheduled Cron Jobs
  const cron1 = 'cron-heartbeat';
  const cron2 = 'cron-nightly-cleanup';

  db.run(
    `INSERT INTO scheduled_jobs (id, project_id, queue_id, name, cron_expression, timezone, payload, is_active, next_run_at, total_runs)
     VALUES (?, ?, ?, 'Telemetry Heartbeat Ping', '*/1 * * * *', 'UTC', '{"service": "system_telemetry"}', 1, datetime('now', '+1 minute'), 12)
     ON CONFLICT(id) DO NOTHING`,
    [cron1, projectId, queueDefault]
  );

  db.run(
    `INSERT INTO scheduled_jobs (id, project_id, queue_id, name, cron_expression, timezone, payload, is_active, next_run_at, total_runs)
     VALUES (?, ?, ?, 'Nightly Temp File Janitor', '0 2 * * *', 'UTC', '{"clean_older_than_days": 7}', 1, datetime('now', '+1 day'), 4)
     ON CONFLICT(id) DO NOTHING`,
    [cron2, projectId, queueData]
  );

  // 7. Initial Seed Jobs (Completed, Running, Queued, DLQ for demonstration)
  const completedJobId = 'job-seed-completed-01';
  db.run(
    `INSERT INTO jobs (id, queue_id, project_id, name, job_type, status, priority, payload, result, attempt_count, max_retries, retry_delay_ms, started_at, completed_at, run_at, created_at, updated_at)
     VALUES (?, ?, ?, 'User Welcome Email Dispatch', 'immediate', 'completed', 7, '{"user_id": "usr_9981", "template": "welcome_v2"}', '{"email_id": "msg_001928", "status": "delivered", "latency_ms": 142}', 1, 3, 1000, datetime('now', '-5 minutes'), datetime('now', '-5 minutes', '+200 milliseconds'), datetime('now', '-5 minutes'), datetime('now', '-5 minutes'), datetime('now', '-5 minutes'))
     ON CONFLICT(id) DO NOTHING`,
    [completedJobId, queueHighPri, projectId]
  );

  // Seed DLQ Item with AI analysis
  const dlqJobId = 'job-seed-dlq-01';
  const dlqId = 'dlq-seed-01';
  const aiAnalysis = JSON.stringify({
    category: 'RATE_LIMIT_EXCEEDED',
    root_cause: 'Downstream API / Service Rate Limit Threshold Breached (HTTP 429)',
    explanation: 'The job User Billing Webhook exceeded downstream Stripe webhook rate limits after 3 consecutive retry attempts.',
    recommended_action: 'Increase Queue Rate Limiter backoff factor or switch Retry Policy to Exponential Backoff with Jitter (base delay >= 5000ms).',
    confidence: 0.96,
    auto_remediable: true
  });

  db.run(
    `INSERT INTO jobs (id, queue_id, project_id, name, job_type, status, priority, payload, error_message, error_stack, attempt_count, max_retries, retry_delay_ms, run_at, created_at, updated_at)
     VALUES (?, ?, ?, 'User Billing Webhook Dispatch', 'immediate', 'dead_letter', 5, '{"invoice_id": "inv_88219", "amount": 4900}', 'HTTP 429: Too Many Requests from downstream API service.', 'Error: HTTP 429 at runHandler (/worker.node.ts:240)', 3, 3, 1000, datetime('now', '-10 minutes'), datetime('now', '-10 minutes'), datetime('now', '-10 minutes'))
     ON CONFLICT(id) DO NOTHING`,
    [dlqJobId, queueDefault, projectId]
  );

  db.run(
    `INSERT INTO dead_letter_queue (id, job_id, queue_id, project_id, failed_at, failure_reason, error_stack, payload, attempt_count, ai_root_cause_analysis, status)
     VALUES (?, ?, ?, ?, datetime('now', '-10 minutes'), 'HTTP 429: Too Many Requests from downstream API service.', 'Error: HTTP 429 at runHandler (/worker.node.ts:240)', '{"invoice_id": "inv_88219", "amount": 4900}', 3, ?, 'unresolved')
     ON CONFLICT(id) DO NOTHING`,
    [dlqId, dlqJobId, queueDefault, projectId, aiAnalysis]
  );

  console.log('✅ Seeding completed successfully!');
}

// If executed directly via CLI
if (process.argv[1]?.includes('seed')) {
  seedDatabase();
}
