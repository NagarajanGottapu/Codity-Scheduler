import { RetryPolicy, RetryStrategy } from '../types/index.js';

export interface RetryCalculation {
  shouldRetry: boolean;
  attemptNumber: number;
  delayMs: number;
  nextRunAt: Date;
}

export class RetryService {
  /**
   * Calculate the next retry parameters based on strategy and attempt count.
   */
  public static calculateNextRetry(
    policy: {
      strategy: RetryStrategy;
      base_delay_ms: number;
      max_delay_ms: number;
      max_retries: number;
      jitter_factor: number;
    },
    currentAttempt: number
  ): RetryCalculation {
    const nextAttempt = currentAttempt + 1;

    if (nextAttempt > policy.max_retries) {
      return {
        shouldRetry: false,
        attemptNumber: nextAttempt,
        delayMs: 0,
        nextRunAt: new Date()
      };
    }

    let delayMs = 0;
    const base = policy.base_delay_ms || 1000;
    const max = policy.max_delay_ms || 60000;
    const jitter = policy.jitter_factor ?? 0.2;

    switch (policy.strategy) {
      case 'fixed':
        delayMs = base;
        break;

      case 'linear':
        delayMs = Math.min(max, base * nextAttempt);
        break;

      case 'exponential':
      default: {
        const rawExp = base * Math.pow(2, nextAttempt - 1);
        const capped = Math.min(max, rawExp);
        const randomJitter = Math.floor(Math.random() * (jitter * base));
        delayMs = Math.min(max, capped + randomJitter);
        break;
      }
    }

    const nextRunAt = new Date(Date.now() + delayMs);

    return {
      shouldRetry: true,
      attemptNumber: nextAttempt,
      delayMs,
      nextRunAt
    };
  }
}
