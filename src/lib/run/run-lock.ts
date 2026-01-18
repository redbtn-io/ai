/**
 * Run Lock
 *
 * Distributed lock for run execution. Ensures only one run per conversation
 * can execute at a time. Uses Redis with automatic expiration and renewal.
 *
 * Key pattern: `run:lock:{conversationId}`
 *
 * The same graph can run in multiple conversations simultaneously.
 * Each conversation can only have one active run at a time.
 *
 * @module lib/run/run-lock
 */

import type { Redis } from 'ioredis';
import { RunKeys, RunConfig } from './types';

/**
 * Lock acquisition result
 */
export interface LockResult {
  /** Whether the lock was acquired */
  acquired: boolean;
  /** Unique lock token (for safe release) */
  token?: string;
  /** Error message if lock not acquired */
  error?: string;
}

/**
 * Options for lock acquisition
 */
export interface AcquireLockOptions {
  /** TTL for lock in seconds (default: 5 minutes) */
  ttlSeconds?: number;
  /** Whether to auto-renew the lock */
  autoRenew?: boolean;
  /** Renewal interval in ms (default: 30 seconds) */
  renewalIntervalMs?: number;
}

/**
 * Run lock handle returned from acquireLock
 */
export interface RunLockHandle {
  /** Unique lock token */
  token: string;
  /** Conversation ID for the lock */
  conversationId: string;
  /** Release the lock */
  release: () => Promise<boolean>;
  /** Stop auto-renewal if enabled */
  stopRenewal: () => void;
}

/**
 * Lua script for safe lock release
 * Only releases if the token matches (prevents releasing someone else's lock)
 */
const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

/**
 * Lua script for lock renewal
 * Only renews if the token matches
 */
const RENEW_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("expire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

/**
 * Generate a unique lock token
 */
function generateToken(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * RunLock - Distributed lock for conversation execution
 *
 * Prevents multiple runs in the same conversation from executing concurrently.
 * Different conversations can run the same graph simultaneously.
 *
 * Usage:
 * ```typescript
 * const runLock = new RunLock(redis);
 *
 * const lock = await runLock.acquire(conversationId);
 * if (!lock) {
 *   throw new Error('Conversation already has an active run');
 * }
 *
 * try {
 *   // Execute graph...
 * } finally {
 *   await lock.release();
 * }
 * ```
 */
export class RunLock {
  private readonly redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Acquire a lock for running in a conversation
   *
   * @param conversationId - Conversation to lock
   * @param options - Lock options
   * @returns Lock handle if acquired, null if lock is held by another run
   */
  async acquire(
    conversationId: string,
    options?: AcquireLockOptions
  ): Promise<RunLockHandle | null> {
    const key = RunKeys.lock(conversationId);
    const token = generateToken();
    const ttl = options?.ttlSeconds ?? RunConfig.LOCK_TTL_SECONDS;

    // Try to acquire lock with NX (only if not exists)
    const result = await this.redis.set(key, token, 'EX', ttl, 'NX');

    if (result !== 'OK') {
      // Lock is held by another run
      return null;
    }

    // Set up auto-renewal if enabled
    let renewalTimer: ReturnType<typeof setInterval> | null = null;
    const stopRenewal = () => {
      if (renewalTimer) {
        clearInterval(renewalTimer);
        renewalTimer = null;
      }
    };

    if (options?.autoRenew !== false) {
      const renewalInterval =
        options?.renewalIntervalMs ?? RunConfig.LOCK_RENEWAL_INTERVAL_MS;

      renewalTimer = setInterval(async () => {
        try {
          const renewed = await this.renew(conversationId, token, ttl);
          if (!renewed) {
            // Lock was lost (expired or taken), stop renewal
            stopRenewal();
          }
        } catch (error) {
          console.error('Lock renewal failed:', error);
          stopRenewal();
        }
      }, renewalInterval);
    }

    const release = async (): Promise<boolean> => {
      stopRenewal();
      return this.release(conversationId, token);
    };

    return {
      token,
      conversationId,
      release,
      stopRenewal,
    };
  }

  /**
   * Release a lock
   *
   * Uses Lua script to ensure we only release our own lock (token must match)
   */
  async release(
    conversationId: string,
    token: string
  ): Promise<boolean> {
    const key = RunKeys.lock(conversationId);
    const result = await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
    return result === 1;
  }

  /**
   * Renew a lock's TTL
   *
   * Uses Lua script to ensure we only renew our own lock (token must match)
   */
  async renew(
    conversationId: string,
    token: string,
    ttlSeconds?: number
  ): Promise<boolean> {
    const key = RunKeys.lock(conversationId);
    const ttl = ttlSeconds ?? RunConfig.LOCK_TTL_SECONDS;
    const result = await this.redis.eval(
      RENEW_LOCK_SCRIPT,
      1,
      key,
      token,
      ttl.toString()
    );
    return result === 1;
  }

  /**
   * Check if a lock is held for a conversation
   */
  async isLocked(conversationId: string): Promise<boolean> {
    const key = RunKeys.lock(conversationId);
    const value = await this.redis.get(key);
    return value !== null;
  }

  /**
   * Get lock info if held
   */
  async getLockInfo(
    conversationId: string
  ): Promise<{ token: string; ttl: number } | null> {
    const key = RunKeys.lock(conversationId);
    const [token, ttl] = await Promise.all([
      this.redis.get(key),
      this.redis.ttl(key),
    ]);

    if (!token || ttl < 0) {
      return null;
    }

    return { token, ttl };
  }

  /**
   * Force release a lock (admin/recovery only)
   *
   * WARNING: Only use for recovery when a lock is orphaned.
   * Normal flow should use the token-based release.
   */
  async forceRelease(conversationId: string): Promise<boolean> {
    const key = RunKeys.lock(conversationId);
    const result = await this.redis.del(key);
    return result === 1;
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create a new RunLock instance
 */
export function createRunLock(redis: Redis): RunLock {
  return new RunLock(redis);
}

/**
 * Convenience function to acquire a lock for a conversation
 */
export async function acquireRunLock(
  redis: Redis,
  conversationId: string,
  options?: AcquireLockOptions
): Promise<RunLockHandle | null> {
  const lock = new RunLock(redis);
  return lock.acquire(conversationId, options);
}

/**
 * Check if a conversation has an active run
 */
export async function isConversationLocked(
  redis: Redis,
  conversationId: string
): Promise<boolean> {
  const lock = new RunLock(redis);
  return lock.isLocked(conversationId);
}

/**
 * @deprecated Use isConversationLocked instead
 */
export async function isGraphLocked(
  redis: Redis,
  userId: string,
  graphId: string
): Promise<boolean> {
  // For backward compatibility - now locks are per conversation, not per user+graph
  // This will always return false since the old lock pattern no longer exists
  console.warn('[RunLock] isGraphLocked is deprecated, use isConversationLocked instead');
  return false;
}
