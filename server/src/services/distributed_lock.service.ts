import { db } from '../db/database.js';
import { DistributedLock } from '../types/index.js';

export interface LockResult {
  acquired: boolean;
  lockKey: string;
  ownerId: string;
  fencingToken?: number;
  expiresAt?: string;
  error?: string;
}

export class DistributedLockService {
  /**
   * Acquire a distributed lock with lease TTL.
   */
  public static acquireLock(lockKey: string, ownerId: string, ttlMs = 15000): LockResult {
    return db.transaction(() => {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
      const nowIso = now.toISOString();

      const existing = db.queryOne<DistributedLock>(
        'SELECT * FROM distributed_locks WHERE lock_key = ?',
        [lockKey]
      );

      if (!existing) {
        // No lock exists -> acquire
        db.run(
          `INSERT INTO distributed_locks (lock_key, owner_id, acquired_at, expires_at, fencing_token)
           VALUES (?, ?, ?, ?, 1)`,
          [lockKey, ownerId, nowIso, expiresAt]
        );

        return {
          acquired: true,
          lockKey,
          ownerId,
          fencingToken: 1,
          expiresAt
        };
      }

      // Check if existing lock is expired or already owned by this owner
      const isExpired = new Date(existing.expires_at).getTime() <= now.getTime();
      const isSameOwner = existing.owner_id === ownerId;

      if (isExpired || isSameOwner) {
        const nextFencingToken = existing.fencing_token + 1;
        db.run(
          `UPDATE distributed_locks
           SET owner_id = ?, acquired_at = ?, expires_at = ?, fencing_token = ?
           WHERE lock_key = ?`,
          [ownerId, nowIso, expiresAt, nextFencingToken, lockKey]
        );

        return {
          acquired: true,
          lockKey,
          ownerId,
          fencingToken: nextFencingToken,
          expiresAt
        };
      }

      // Held by another active owner
      return {
        acquired: false,
        lockKey,
        ownerId: existing.owner_id,
        fencingToken: existing.fencing_token,
        expiresAt: existing.expires_at,
        error: `Lock is currently held by owner '${existing.owner_id}' until ${existing.expires_at}`
      };
    });
  }

  /**
   * Renew an existing lock lease.
   */
  public static renewLock(lockKey: string, ownerId: string, ttlMs = 15000): boolean {
    return db.transaction(() => {
      const now = new Date();
      const newExpiresAt = new Date(now.getTime() + ttlMs).toISOString();

      const res = db.run(
        `UPDATE distributed_locks
         SET expires_at = ?
         WHERE lock_key = ? AND owner_id = ? AND expires_at > ?`,
        [newExpiresAt, lockKey, ownerId, now.toISOString()]
      );

      return res.changes > 0;
    });
  }

  /**
   * Release a distributed lock cleanly.
   */
  public static releaseLock(lockKey: string, ownerId: string): boolean {
    return db.transaction(() => {
      const res = db.run(
        'DELETE FROM distributed_locks WHERE lock_key = ? AND owner_id = ?',
        [lockKey, ownerId]
      );
      return res.changes > 0;
    });
  }

  /**
   * List all active distributed locks.
   */
  public static listLocks(): DistributedLock[] {
    return db.queryAll<DistributedLock>('SELECT * FROM distributed_locks ORDER BY acquired_at DESC');
  }
}
