import { db } from '../db/database.js';
import { RateLimitBucket } from '../types/index.js';

export interface RateLimitResult {
  allowed: boolean;
  tokensRemaining: number;
  capacity: number;
  retryAfterMs: number;
}

export class RateLimiterService {
  /**
   * Consume tokens from a token bucket atomically.
   */
  public static consume(
    bucketKey: string,
    refillRatePerSec: number,
    capacity: number,
    cost = 1
  ): RateLimitResult {
    return db.transaction(() => {
      const now = Date.now();
      const bucket = db.queryOne<RateLimitBucket>(
        'SELECT * FROM rate_limits WHERE bucket_key = ?',
        [bucketKey]
      );

      let currentTokens = capacity;
      let lastRefill = now;

      if (bucket) {
        const elapsedSec = Math.max(0, (now - bucket.last_refill_at) / 1000);
        const refilledTokens = elapsedSec * refillRatePerSec;
        currentTokens = Math.min(capacity, bucket.tokens_remaining + refilledTokens);
        lastRefill = now;
      }

      // Round to 3 decimal places to prevent micro floating point errors
      currentTokens = Math.round(currentTokens * 1000) / 1000;

      if (currentTokens >= cost) {
        const remaining = Math.round((currentTokens - cost) * 1000) / 1000;
        db.run(
          `INSERT INTO rate_limits (bucket_key, tokens_remaining, last_refill_at, refill_rate_per_sec, capacity)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET
             tokens_remaining = excluded.tokens_remaining,
             last_refill_at = excluded.last_refill_at,
             refill_rate_per_sec = excluded.refill_rate_per_sec,
             capacity = excluded.capacity`,
          [bucketKey, remaining, lastRefill, refillRatePerSec, capacity]
        );

        return {
          allowed: true,
          tokensRemaining: remaining,
          capacity,
          retryAfterMs: 0
        };
      } else {
        // Not enough tokens
        const missingTokens = cost - currentTokens;
        const retryAfterMs = Math.ceil((missingTokens / refillRatePerSec) * 1000);

        db.run(
          `INSERT INTO rate_limits (bucket_key, tokens_remaining, last_refill_at, refill_rate_per_sec, capacity)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(bucket_key) DO UPDATE SET
             tokens_remaining = excluded.tokens_remaining,
             last_refill_at = excluded.last_refill_at`,
          [bucketKey, currentTokens, lastRefill, refillRatePerSec, capacity]
        );

        return {
          allowed: false,
          tokensRemaining: currentTokens,
          capacity,
          retryAfterMs
        };
      }
    });
  }

  public static getBucketStatus(bucketKey: string): RateLimitBucket | null {
    return db.queryOne<RateLimitBucket>(
      'SELECT * FROM rate_limits WHERE bucket_key = ?',
      [bucketKey]
    );
  }

  public static listAllBuckets(): RateLimitBucket[] {
    return db.queryAll<RateLimitBucket>('SELECT * FROM rate_limits ORDER BY bucket_key ASC');
  }
}
