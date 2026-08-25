import { db } from '../db/database.js';
import { Worker } from '../types/index.js';
import { WorkerNode } from '../worker/worker.node.js';

export class WorkerManager {
  private static instance: WorkerManager;
  private workers: Map<string, WorkerNode> = new Map();

  private constructor() {}

  public static getInstance(): WorkerManager {
    if (!WorkerManager.instance) {
      WorkerManager.instance = new WorkerManager();
    }
    return WorkerManager.instance;
  }

  public async initializeCluster(count = 3): Promise<void> {
    // Clear any stale workers from previous runs
    db.run("UPDATE workers SET status = 'offline', active_jobs_count = 0 WHERE status != 'offline'");

    for (let i = 1; i <= count; i++) {
      const tags = i === count ? ['high-memory', 'default'] : ['default'];
      await this.spawnWorker(`Worker-Node-0${i}`, 5, tags);
    }
  }

  public async spawnWorker(name?: string, concurrency = 5, tags: string[] = ['default']): Promise<WorkerNode> {
    const worker = new WorkerNode({
      name,
      concurrency,
      tags
    });

    await worker.start();
    this.workers.set(worker.id, worker);
    return worker;
  }

  public async stopWorker(workerId: string): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) return false;

    await worker.shutdown(4000);
    this.workers.delete(workerId);
    return true;
  }

  public listWorkers(): Worker[] {
    return db.queryAll<Worker>('SELECT * FROM workers ORDER BY started_at ASC');
  }

  public getWorker(id: string): Worker | null {
    return db.queryOne<Worker>('SELECT * FROM workers WHERE id = ?', [id]);
  }

  public getClusterStats() {
    const workers = this.listWorkers();
    let totalConcurrency = 0;
    let activeJobs = 0;
    let activeWorkers = 0;
    let busyWorkers = 0;
    let deadWorkers = 0;

    for (const w of workers) {
      if (w.status === 'active' || w.status === 'busy') {
        totalConcurrency += w.concurrency;
        activeJobs += w.active_jobs_count;
        if (w.status === 'busy') busyWorkers++;
        else activeWorkers++;
      } else if (w.status === 'dead') {
        deadWorkers++;
      }
    }

    return {
      totalWorkers: workers.length,
      activeWorkers,
      busyWorkers,
      deadWorkers,
      totalCapacity: totalConcurrency,
      currentlyExecutingJobs: activeJobs,
      clusterUtilizationPct: totalConcurrency > 0 ? Math.round((activeJobs / totalConcurrency) * 100) : 0
    };
  }

  public async shutdownAll(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const worker of this.workers.values()) {
      promises.push(worker.shutdown(2000));
    }
    await Promise.all(promises);
    this.workers.clear();
  }
}

export const workerManager = WorkerManager.getInstance();
