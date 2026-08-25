import { v4 as uuidv4 } from 'uuid';
import { db } from '../db/database.js';
import { Job, WorkflowDAG, WorkflowEdge } from '../types/index.js';
import { wsHub } from '../ws/websocket.hub.js';

export interface CreateDAGNodeDTO {
  name: string;
  step_name: string;
  queue_id: string;
  payload: any;
  priority?: number;
  max_retries?: number;
  retry_delay_ms?: number;
}

export interface CreateDAGEdgeDTO {
  from_step: string; // parent step_name
  to_step: string;   // child step_name
  condition?: 'on_success' | 'on_failure' | 'always';
}

export interface CreateWorkflowDTO {
  project_id: string;
  name: string;
  description?: string;
  nodes: CreateDAGNodeDTO[];
  edges: CreateDAGEdgeDTO[];
}

export class WorkflowService {
  /**
   * Validate DAG for cycles using Kahn's algorithm.
   */
  public static validateAcyclic(nodeNames: string[], edges: { from: string; to: string }[]): boolean {
    const inDegree: Record<string, number> = {};
    const adjList: Record<string, string[]> = {};

    for (const name of nodeNames) {
      inDegree[name] = 0;
      adjList[name] = [];
    }

    for (const edge of edges) {
      if (!adjList[edge.from] || !inDegree[edge.to] === undefined) {
        throw new Error(`Edge references invalid node: ${edge.from} -> ${edge.to}`);
      }
      adjList[edge.from].push(edge.to);
      inDegree[edge.to] = (inDegree[edge.to] || 0) + 1;
    }

    const queue: string[] = [];
    for (const name of nodeNames) {
      if (inDegree[name] === 0) {
        queue.push(name);
      }
    }

    let visitedCount = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visitedCount++;

      for (const neighbor of adjList[node] || []) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          queue.push(neighbor);
        }
      }
    }

    return visitedCount === nodeNames.length;
  }

  /**
   * Create and trigger an end-to-end DAG workflow.
   */
  public static createWorkflow(dto: CreateWorkflowDTO): WorkflowDAG {
    return db.transaction(() => {
      const nodeNames = dto.nodes.map((n) => n.step_name);
      const isAcyclic = this.validateAcyclic(
        nodeNames,
        dto.edges.map((e) => ({ from: e.from_step, to: e.to_step }))
      );

      if (!isAcyclic) {
        throw new Error('Cyclic dependency detected! Workflows must be Directed Acyclic Graphs (DAGs).');
      }

      const dagId = uuidv4();
      const totalNodes = dto.nodes.length;

      // 1. Insert Workflow DAG record
      db.run(
        `INSERT INTO workflow_dags (id, project_id, name, description, status, total_nodes, completed_nodes, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'running', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [dagId, dto.project_id, dto.name, dto.description || '', totalNodes]
      );

      // Find in-degrees to identify root nodes
      const incomingCount: Record<string, number> = {};
      for (const node of dto.nodes) {
        incomingCount[node.step_name] = 0;
      }
      for (const edge of dto.edges) {
        incomingCount[edge.to_step] = (incomingCount[edge.to_step] || 0) + 1;
      }

      // Map step_name to created Job ID
      const stepToJobIdMap: Record<string, string> = {};

      // 2. Create Job records for each DAG step
      for (const node of dto.nodes) {
        const jobId = uuidv4();
        stepToJobIdMap[node.step_name] = jobId;

        // Root nodes start as 'queued'; dependent nodes start as 'scheduled'
        const isRoot = (incomingCount[node.step_name] || 0) === 0;
        const initialStatus = isRoot ? 'queued' : 'scheduled';

        db.run(
          `INSERT INTO jobs (
             id, queue_id, project_id, name, job_type, status, priority,
             payload, lease_timeout_ms, attempt_count, max_retries, retry_delay_ms,
             dag_id, dag_step_name, run_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'dag_step', ?, ?, ?, 30000, 0, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            jobId,
            node.queue_id,
            dto.project_id,
            node.name || `${dto.name} - ${node.step_name}`,
            initialStatus,
            node.priority ?? 5,
            JSON.stringify(node.payload || {}),
            node.max_retries ?? 3,
            node.retry_delay_ms ?? 1000,
            dagId,
            node.step_name
          ]
        );
      }

      // 3. Insert Workflow Edges
      for (const edge of dto.edges) {
        const edgeId = uuidv4();
        const parentJobId = stepToJobIdMap[edge.from_step];
        const childJobId = stepToJobIdMap[edge.to_step];

        if (parentJobId && childJobId) {
          db.run(
            `INSERT INTO workflow_edges (id, dag_id, parent_job_id, child_job_id, condition, created_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [edgeId, dagId, parentJobId, childJobId, edge.condition || 'on_success']
          );
        }
      }

      const workflow = this.getWorkflowById(dagId)!;
      wsHub.broadcast('workflow:updated', workflow);
      return workflow;
    });
  }

  /**
   * Called when a DAG step job completes successfully to evaluate and enqueue downstream child steps.
   */
  public static onStepCompleted(jobId: string): void {
    db.transaction(() => {
      const job = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [jobId]);
      if (!job || !job.dag_id) return;

      const dagId = job.dag_id;

      // Increment completed nodes in DAG
      db.run(
        `UPDATE workflow_dags
         SET completed_nodes = completed_nodes + 1, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [dagId]
      );

      // Find all dependent child edges
      const childEdges = db.queryAll<WorkflowEdge>(
        'SELECT * FROM workflow_edges WHERE parent_job_id = ? AND condition IN (\'on_success\', \'always\')',
        [jobId]
      );

      for (const edge of childEdges) {
        const childJob = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [edge.child_job_id]);
        if (!childJob || childJob.status !== 'scheduled') continue;

        // Check if ALL parent edges for this child are satisfied
        const parents = db.queryAll<{ parent_job_id: string; status: string }>(
          `SELECT we.parent_job_id, j.status
           FROM workflow_edges we
           JOIN jobs j ON we.parent_job_id = j.id
           WHERE we.child_job_id = ?`,
          [childJob.id]
        );

        const allParentsCompleted = parents.every((p) => p.status === 'completed');

        if (allParentsCompleted) {
          // Trigger the child job into 'queued'
          db.run(
            `UPDATE jobs
             SET status = 'queued', run_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [childJob.id]
          );

          const updatedChild = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [childJob.id]);
          if (updatedChild) {
            wsHub.broadcast('job:status_changed', updatedChild);
          }
        }
      }

      // Check if entire DAG is now finished
      const dag = db.queryOne<WorkflowDAG>('SELECT * FROM workflow_dags WHERE id = ?', [dagId]);
      if (dag && dag.completed_nodes >= dag.total_nodes) {
        db.run(
          `UPDATE workflow_dags
           SET status = 'completed', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [dagId]
        );
      }

      const refreshedDag = this.getWorkflowById(dagId);
      if (refreshedDag) {
        wsHub.broadcast('workflow:updated', refreshedDag);
      }
    });
  }

  /**
   * Called when a DAG step fails permanently to fail the entire DAG and cancel pending child jobs.
   */
  public static onStepFailed(jobId: string, reason: string): void {
    db.transaction(() => {
      const job = db.queryOne<Job>('SELECT * FROM jobs WHERE id = ?', [jobId]);
      if (!job || !job.dag_id) return;

      const dagId = job.dag_id;

      // Mark DAG as failed
      db.run(
        `UPDATE workflow_dags
         SET status = 'failed', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [dagId]
      );

      // Cancel all remaining scheduled jobs in this DAG
      db.run(
        `UPDATE jobs
         SET status = 'cancelled', error_message = ?, updated_at = CURRENT_TIMESTAMP
         WHERE dag_id = ? AND status = 'scheduled'`,
        [`Cancelled due to failure of parent step '${job.dag_step_name || job.name}': ${reason}`, dagId]
      );

      const refreshedDag = this.getWorkflowById(dagId);
      if (refreshedDag) {
        wsHub.broadcast('workflow:updated', refreshedDag);
      }
    });
  }

  public static getWorkflowById(id: string): WorkflowDAG | null {
    const dag = db.queryOne<WorkflowDAG>('SELECT * FROM workflow_dags WHERE id = ?', [id]);
    if (!dag) return null;

    dag.nodes = db.queryAll<Job>('SELECT * FROM jobs WHERE dag_id = ? ORDER BY created_at ASC', [id]);
    dag.edges = db.queryAll<WorkflowEdge>('SELECT * FROM workflow_edges WHERE dag_id = ?', [id]);

    return dag;
  }

  public static listWorkflows(projectId: string): WorkflowDAG[] {
    const dags = db.queryAll<WorkflowDAG>(
      'SELECT * FROM workflow_dags WHERE project_id = ? ORDER BY created_at DESC',
      [projectId]
    );

    return dags.map((dag) => {
      dag.nodes = db.queryAll<Job>('SELECT * FROM jobs WHERE dag_id = ? ORDER BY created_at ASC', [dag.id]);
      dag.edges = db.queryAll<WorkflowEdge>('SELECT * FROM workflow_edges WHERE dag_id = ?', [dag.id]);
      return dag;
    });
  }
}
