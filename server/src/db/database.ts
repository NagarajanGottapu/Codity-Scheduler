import path from 'node:path';
import fs from 'node:fs';

// Universal SQLite Driver (node:sqlite -> better-sqlite3)
interface SQLiteAdapter {
  queryAll<T = any>(sql: string, params?: any[]): T[];
  queryOne<T = any>(sql: string, params?: any[]): T | null;
  run(sql: string, params?: any[]): { changes: number; lastInsertRowid: number | bigint };
  exec(sql: string): void;
  transaction<T>(fn: () => T): T;
}

let createAdapter: (finalPath: string, inMemory: boolean) => SQLiteAdapter;

try {
  // Tier 1: Native Node.js 22+ DatabaseSync
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeSqlite = require('node:sqlite');
  createAdapter = (finalPath: string, inMemory: boolean) => {
    const rawDb = new nodeSqlite.DatabaseSync(inMemory ? ':memory:' : finalPath);
    try {
      rawDb.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 10000;
      `);
    } catch (e) {}

    let txDepth = 0;
    return {
      queryAll<T = any>(sql: string, params: any[] = []): T[] {
        const stmt = rawDb.prepare(sql);
        return stmt.all(...params) as T[];
      },
      queryOne<T = any>(sql: string, params: any[] = []): T | null {
        const stmt = rawDb.prepare(sql);
        const row = stmt.get(...params);
        return (row as T) || null;
      },
      run(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number | bigint } {
        const stmt = rawDb.prepare(sql);
        const result = stmt.run(...params);
        return {
          changes: Number(result.changes),
          lastInsertRowid: result.lastInsertRowid
        };
      },
      exec(sql: string): void {
        rawDb.exec(sql);
      },
      transaction<T>(fn: () => T): T {
        if (txDepth > 0) return fn();
        txDepth++;
        try {
          rawDb.exec('BEGIN IMMEDIATE');
          const res = fn();
          rawDb.exec('COMMIT');
          return res;
        } catch (err) {
          try {
            rawDb.exec('ROLLBACK');
          } catch (rErr) {}
          throw err;
        } finally {
          txDepth--;
        }
      }
    };
  };
} catch (e1) {
  // Tier 2: better-sqlite3 for Node 18/20
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const BetterSqlite = require('better-sqlite3');
  createAdapter = (finalPath: string, inMemory: boolean) => {
    const rawDb = new BetterSqlite(inMemory ? ':memory:' : finalPath);
    try {
      rawDb.pragma('foreign_keys = ON');
      rawDb.pragma('journal_mode = WAL');
      rawDb.pragma('synchronous = NORMAL');
      rawDb.pragma('busy_timeout = 10000');
    } catch (e) {}

    let txDepth = 0;
    return {
      queryAll<T = any>(sql: string, params: any[] = []): T[] {
        const stmt = rawDb.prepare(sql);
        return stmt.all(...params) as T[];
      },
      queryOne<T = any>(sql: string, params: any[] = []): T | null {
        const stmt = rawDb.prepare(sql);
        const row = stmt.get(...params);
        return (row as T) || null;
      },
      run(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number | bigint } {
        const stmt = rawDb.prepare(sql);
        const result = stmt.run(...params);
        return {
          changes: Number(result.changes),
          lastInsertRowid: result.lastInsertRowid
        };
      },
      exec(sql: string): void {
        rawDb.exec(sql);
      },
      transaction<T>(fn: () => T): T {
        if (txDepth > 0) return fn();
        txDepth++;
        try {
          rawDb.exec('BEGIN IMMEDIATE');
          const res = fn();
          rawDb.exec('COMMIT');
          return res;
        } catch (err) {
          try {
            rawDb.exec('ROLLBACK');
          } catch (rErr) {}
          throw err;
        } finally {
          txDepth--;
        }
      }
    };
  };
}

export class DatabaseManager {
  private static instance: DatabaseManager;
  private adapter: SQLiteAdapter;
  private inMemory: boolean;

  private constructor(dbPath?: string) {
    this.inMemory = dbPath === ':memory:';
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
      } catch (e) {}
    }
    const finalPath = dbPath || path.join(dataDir, 'scheduler.db');

    this.adapter = createAdapter(finalPath, this.inMemory);
    this.initializeSchema();
  }

  public static getInstance(dbPath?: string): DatabaseManager {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = new DatabaseManager(dbPath);
    }
    return DatabaseManager.instance;
  }

  public static createIsolated(dbPath = ':memory:'): DatabaseManager {
    return new DatabaseManager(dbPath);
  }

  private initializeSchema(): void {
    const candidatePaths = [
      path.resolve(__dirname, 'schema.sql'),
      path.resolve(__dirname, '../../src/db/schema.sql'),
      path.resolve(__dirname, '../src/db/schema.sql'),
      path.resolve(process.cwd(), 'src/db/schema.sql'),
      path.resolve(process.cwd(), 'server/src/db/schema.sql'),
      path.resolve(process.cwd(), 'server/dist/db/schema.sql'),
      path.resolve(process.cwd(), 'dist/db/schema.sql')
    ];

    let schemaSql: string | null = null;
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        schemaSql = fs.readFileSync(p, 'utf8');
        break;
      }
    }

    if (schemaSql) {
      this.adapter.exec(schemaSql);
    } else {
      console.warn('⚠️ schema.sql not found on disk, initializing core tables via fallback DDL');
      this.adapter.exec(`
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, plan TEXT NOT NULL DEFAULT 'enterprise', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin', 'developer', 'viewer')), api_key TEXT UNIQUE NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL, slug TEXT NOT NULL, description TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE, UNIQUE (org_id, slug));
        CREATE TABLE IF NOT EXISTS retry_policies (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, strategy TEXT NOT NULL CHECK(strategy IN ('fixed', 'linear', 'exponential')), base_delay_ms INTEGER NOT NULL DEFAULT 1000, max_delay_ms INTEGER NOT NULL DEFAULT 60000, max_retries INTEGER NOT NULL DEFAULT 3, jitter_factor REAL NOT NULL DEFAULT 0.2, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS queues (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, retry_policy_id TEXT, name TEXT NOT NULL, description TEXT, priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 10), concurrency_limit INTEGER NOT NULL DEFAULT 5, rate_limit_per_min INTEGER NOT NULL DEFAULT 120, rate_limit_burst INTEGER NOT NULL DEFAULT 20, is_paused INTEGER NOT NULL DEFAULT 0, tags TEXT DEFAULT '[]', created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (retry_policy_id) REFERENCES retry_policies(id) ON DELETE SET NULL, UNIQUE (project_id, name));
        CREATE TABLE IF NOT EXISTS workflow_dags (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'running', 'completed', 'failed', 'cancelled')), total_nodes INTEGER NOT NULL DEFAULT 0, completed_nodes INTEGER NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, project_id TEXT NOT NULL, idempotency_key TEXT, name TEXT NOT NULL, job_type TEXT NOT NULL CHECK(job_type IN ('immediate', 'delayed', 'scheduled', 'cron', 'batch', 'dag_step')), status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'scheduled', 'claimed', 'running', 'completed', 'failed', 'dead_letter', 'cancelled')), priority INTEGER NOT NULL DEFAULT 5 CHECK(priority BETWEEN 1 AND 10), payload TEXT NOT NULL DEFAULT '{}', result TEXT, error_message TEXT, error_stack TEXT, run_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, claimed_at DATETIME, started_at DATETIME, completed_at DATETIME, lease_timeout_ms INTEGER NOT NULL DEFAULT 30000, worker_id TEXT, attempt_count INTEGER NOT NULL DEFAULT 0, max_retries INTEGER NOT NULL DEFAULT 3, retry_delay_ms INTEGER NOT NULL DEFAULT 1000, batch_id TEXT, dag_id TEXT, dag_step_name TEXT, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE, FOREIGN KEY (dag_id) REFERENCES workflow_dags(id) ON DELETE CASCADE, UNIQUE (project_id, idempotency_key));
        CREATE TABLE IF NOT EXISTS workers (id TEXT PRIMARY KEY, name TEXT NOT NULL, hostname TEXT NOT NULL, pid INTEGER NOT NULL, concurrency INTEGER NOT NULL DEFAULT 5, status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'busy', 'paused', 'dead')), active_jobs_count INTEGER NOT NULL DEFAULT 0, tags TEXT DEFAULT '[]', started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, last_heartbeat_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE IF NOT EXISTS job_executions (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, worker_id TEXT NOT NULL, attempt_number INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('running', 'completed', 'failed', 'timeout')), started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME, duration_ms INTEGER, cpu_usage_pct REAL, memory_usage_mb REAL, exit_code INTEGER, error_message TEXT, error_stack TEXT, FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE, FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS job_logs (id TEXT PRIMARY KEY, job_id TEXT NOT NULL, execution_id TEXT, worker_id TEXT, log_level TEXT NOT NULL DEFAULT 'INFO' CHECK(log_level IN ('DEBUG', 'INFO', 'WARN', 'ERROR')), message TEXT NOT NULL, timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE, FOREIGN KEY (execution_id) REFERENCES job_executions(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS dead_letter_queue (id TEXT PRIMARY KEY, job_id TEXT UNIQUE NOT NULL, queue_id TEXT NOT NULL, project_id TEXT NOT NULL, failed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, failure_reason TEXT NOT NULL, ai_root_cause_analysis TEXT, status TEXT NOT NULL DEFAULT 'unresolved' CHECK(status IN ('unresolved', 'replayed', 'archived')), replayed_at DATETIME, FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE, FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS scheduled_jobs (id TEXT PRIMARY KEY, queue_id TEXT NOT NULL, project_id TEXT NOT NULL, name TEXT NOT NULL, cron_expression TEXT NOT NULL, timezone TEXT NOT NULL DEFAULT 'UTC', payload TEXT NOT NULL DEFAULT '{}', priority INTEGER NOT NULL DEFAULT 5, is_active INTEGER NOT NULL DEFAULT 1, last_run_at DATETIME, next_run_at DATETIME NOT NULL, total_runs INTEGER NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, FOREIGN KEY (queue_id) REFERENCES queues(id) ON DELETE CASCADE, FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS distributed_locks (lock_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, fencing_token INTEGER NOT NULL DEFAULT 1, acquired_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, ttl_ms INTEGER NOT NULL DEFAULT 10000);
        CREATE TABLE IF NOT EXISTS rate_limits (bucket_key TEXT PRIMARY KEY, tokens_remaining REAL NOT NULL, last_refill_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, capacity INTEGER NOT NULL, refill_rate_per_sec REAL NOT NULL);
        CREATE TABLE IF NOT EXISTS workflow_edges (id TEXT PRIMARY KEY, dag_id TEXT NOT NULL, from_step TEXT NOT NULL, to_step TEXT NOT NULL, FOREIGN KEY (dag_id) REFERENCES workflow_dags(id) ON DELETE CASCADE);
        CREATE TABLE IF NOT EXISTS worker_heartbeats (id TEXT PRIMARY KEY, worker_id TEXT NOT NULL, timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, cpu_usage_pct REAL NOT NULL, memory_usage_mb REAL NOT NULL, active_jobs INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, FOREIGN KEY (worker_id) REFERENCES workers(id) ON DELETE CASCADE);
      `);
    }
  }

  public queryAll<T = any>(sql: string, params: any[] = []): T[] {
    return this.adapter.queryAll<T>(sql, params);
  }

  public queryOne<T = any>(sql: string, params: any[] = []): T | null {
    return this.adapter.queryOne<T>(sql, params);
  }

  public run(sql: string, params: any[] = []): { changes: number; lastInsertRowid: number | bigint } {
    return this.adapter.run(sql, params);
  }

  public exec(sql: string): void {
    this.adapter.exec(sql);
  }

  public transaction<T>(fn: () => T): T {
    return this.adapter.transaction<T>(fn);
  }
}

export const db = DatabaseManager.getInstance();
