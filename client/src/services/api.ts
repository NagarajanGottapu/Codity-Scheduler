import {
  Job,
  Queue,
  Worker,
  DeadLetterJob,
  WorkflowDAG,
  ScheduledJob,
  DistributedLock,
  RateLimitBucket,
  SystemAnalytics,
  Project,
  RetryPolicy
} from '../types/index.js';

const API_BASE =
  typeof window !== 'undefined' && window.location.port === '5173'
    ? `http://${window.location.hostname || 'localhost'}:4000/api`
    : '/api';

async function fetchJSON<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  const res = await fetch(url, { ...options, headers });
  const json = await res.json();

  if (!res.ok || json.success === false) {
    throw new Error(json.error || `HTTP error ${res.status}`);
  }

  return json;
}

export const api = {
  // System Analytics
  getAnalytics: (projectId = 'project-default') =>
    fetchJSON<{ success: boolean; data: SystemAnalytics }>(`${API_BASE}/analytics/system?project_id=${projectId}`).then((r) => r.data),

  // Projects & Policies
  listProjects: () =>
    fetchJSON<{ success: boolean; data: Project[] }>(`${API_BASE}/projects`).then((r) => r.data),
  listRetryPolicies: (projectId = 'project-default') =>
    fetchJSON<{ success: boolean; data: RetryPolicy[] }>(`${API_BASE}/projects/${projectId}/retry-policies`).then((r) => r.data),

  // Queues
  listQueues: (projectId = 'project-default') =>
    fetchJSON<{ success: boolean; data: Queue[] }>(`${API_BASE}/queues?project_id=${projectId}`).then((r) => r.data),
  createQueue: (body: any) =>
    fetchJSON<{ success: boolean; data: Queue }>(`${API_BASE}/queues`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data),
  updateQueue: (id: string, body: any) =>
    fetchJSON<{ success: boolean; data: Queue }>(`${API_BASE}/queues/${id}`, { method: 'PUT', body: JSON.stringify(body) }).then((r) => r.data),
  pauseQueue: (id: string) =>
    fetchJSON<{ success: boolean; data: Queue }>(`${API_BASE}/queues/${id}/pause`, { method: 'POST' }).then((r) => r.data),
  resumeQueue: (id: string) =>
    fetchJSON<{ success: boolean; data: Queue }>(`${API_BASE}/queues/${id}/resume`, { method: 'POST' }).then((r) => r.data),
  deleteQueue: (id: string) =>
    fetchJSON<{ success: boolean }>(`${API_BASE}/queues/${id}`, { method: 'DELETE' }),

  // Jobs
  listJobs: (params: {
    project_id?: string;
    queue_id?: string;
    status?: string;
    job_type?: string;
    search?: string;
    priority?: number;
    batch_id?: string;
    dag_id?: string;
    page?: number;
    limit?: number;
  }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.append(k, String(v));
    });
    return fetchJSON<{
      success: boolean;
      items: Job[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`${API_BASE}/jobs?${q.toString()}`);
  },
  getJob: (id: string) =>
    fetchJSON<{ success: boolean; data: Job }>(`${API_BASE}/jobs/${id}`).then((r) => r.data),
  createJob: (body: any) =>
    fetchJSON<{ success: boolean; data: Job; isDuplicate?: boolean; message?: string }>(`${API_BASE}/jobs`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  createBatchJobs: (body: any) =>
    fetchJSON<{ success: boolean; data: any }>(`${API_BASE}/jobs/batch`, {
      method: 'POST',
      body: JSON.stringify(body)
    }).then((r) => r.data),
  cancelJob: (id: string) =>
    fetchJSON<{ success: boolean; data: Job }>(`${API_BASE}/jobs/${id}/cancel`, { method: 'POST' }).then((r) => r.data),
  retryJob: (id: string) =>
    fetchJSON<{ success: boolean; data: Job }>(`${API_BASE}/jobs/${id}/retry`, { method: 'POST' }).then((r) => r.data),

  // Workers
  listWorkers: () =>
    fetchJSON<{ success: boolean; data: Worker[] }>(`${API_BASE}/workers`).then((r) => r.data),
  spawnWorker: (body: { name?: string; concurrency?: number; tags?: string[] }) =>
    fetchJSON<{ success: boolean; data: any; message: string }>(`${API_BASE}/workers/spawn`, {
      method: 'POST',
      body: JSON.stringify(body)
    }),
  stopWorker: (id: string) =>
    fetchJSON<{ success: boolean; message: string }>(`${API_BASE}/workers/${id}/stop`, { method: 'POST' }),

  // DLQ & AI Diagnostics
  listDLQ: (params: { project_id?: string; status?: string; queue_id?: string; page?: number; limit?: number }) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') q.append(k, String(v));
    });
    return fetchJSON<{
      success: boolean;
      items: DeadLetterJob[];
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    }>(`${API_BASE}/dlq?${q.toString()}`);
  },
  replayDLQJob: (id: string) =>
    fetchJSON<{ success: boolean; data: Job; message: string }>(`${API_BASE}/dlq/${id}/replay`, { method: 'POST' }),
  bulkReplayDLQ: (projectId = 'project-default', queueId?: string) =>
    fetchJSON<{ success: boolean; count: number; message: string }>(`${API_BASE}/dlq/bulk-replay`, {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId, queue_id: queueId })
    }),
  purgeDLQ: (projectId = 'project-default', dlqId?: string) =>
    fetchJSON<{ success: boolean; count: number }>(`${API_BASE}/dlq/purge`, {
      method: 'DELETE',
      body: JSON.stringify({ project_id: projectId, dlq_id: dlqId })
    }),

  // Workflows (DAGs)
  listWorkflows: (projectId = 'project-default') =>
    fetchJSON<{ success: boolean; data: WorkflowDAG[] }>(`${API_BASE}/workflows?project_id=${projectId}`).then((r) => r.data),
  getWorkflow: (id: string) =>
    fetchJSON<{ success: boolean; data: WorkflowDAG }>(`${API_BASE}/workflows/${id}`).then((r) => r.data),
  createWorkflow: (body: any) =>
    fetchJSON<{ success: boolean; data: WorkflowDAG }>(`${API_BASE}/workflows`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data),

  // Cron / Recurring
  listCron: (projectId = 'project-default') =>
    fetchJSON<{ success: boolean; data: ScheduledJob[] }>(`${API_BASE}/cron?project_id=${projectId}`).then((r) => r.data),
  createCron: (body: any) =>
    fetchJSON<{ success: boolean; data: ScheduledJob }>(`${API_BASE}/cron`, { method: 'POST', body: JSON.stringify(body) }).then((r) => r.data),
  toggleCron: (id: string, isActive: boolean) =>
    fetchJSON<{ success: boolean; data: ScheduledJob }>(`${API_BASE}/cron/${id}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ is_active: isActive })
    }).then((r) => r.data),
  deleteCron: (id: string) =>
    fetchJSON<{ success: boolean; message: string }>(`${API_BASE}/cron/${id}`, { method: 'DELETE' }),

  // Locks & Rate Limits
  listLocks: () =>
    fetchJSON<{ success: boolean; data: DistributedLock[] }>(`${API_BASE}/locks`).then((r) => r.data),
  acquireLock: (body: { lock_key: string; owner_id: string; ttl_ms?: number }) =>
    fetchJSON<{ success: boolean; data: any }>(`${API_BASE}/locks/acquire`, { method: 'POST', body: JSON.stringify(body) }),
  releaseLock: (body: { lock_key: string; owner_id: string }) =>
    fetchJSON<{ success: boolean; released: boolean }>(`${API_BASE}/locks/release`, { method: 'POST', body: JSON.stringify(body) }),
  listRateLimits: () =>
    fetchJSON<{ success: boolean; data: RateLimitBucket[] }>(`${API_BASE}/locks/rate-limits`).then((r) => r.data),

  // Demo Actions
  triggerStressTest: (count = 30, projectId = 'project-default') =>
    fetchJSON<{ success: boolean; count: number; batch_id: string; message: string }>(`${API_BASE}/demo/stress-test`, {
      method: 'POST',
      body: JSON.stringify({ count, project_id: projectId })
    }),
  triggerSimulatedFailure: (failureType: string, projectId = 'project-default') =>
    fetchJSON<{ success: boolean; data: Job; message: string }>(`${API_BASE}/demo/simulate-failure`, {
      method: 'POST',
      body: JSON.stringify({ failure_type: failureType, project_id: projectId })
    }),
  triggerDAGPipeline: (projectId = 'project-default') =>
    fetchJSON<{ success: boolean; data: WorkflowDAG; message: string }>(`${API_BASE}/demo/trigger-dag`, {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId })
    }),
  triggerZombieRecovery: (projectId = 'project-default') =>
    fetchJSON<{ success: boolean; deadWorkersDetected: number; recoveredJobs: number; message: string }>(`${API_BASE}/demo/simulate-zombie-recovery`, {
      method: 'POST',
      body: JSON.stringify({ project_id: projectId })
    })
};
