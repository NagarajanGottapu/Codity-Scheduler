import { Router } from 'express';
import { DistributedLockService } from '../services/distributed_lock.service.js';
import { RateLimiterService } from '../services/rate_limiter.service.js';
import { authenticate, requireRole } from '../middleware/auth.middleware.js';

const router = Router();

// ----------------- DISTRIBUTED LOCKS -----------------

// List active locks
router.get('/', authenticate, (req, res) => {
  const locks = DistributedLockService.listLocks();
  res.json({ success: true, data: locks });
});

// Acquire lock
router.post('/acquire', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  const { lock_key, owner_id, ttl_ms = 15000 } = req.body;
  if (!lock_key || !owner_id) {
    res.status(400).json({ success: false, error: 'lock_key and owner_id are required' });
    return;
  }

  const result = DistributedLockService.acquireLock(lock_key, owner_id, ttl_ms);
  if (result.acquired) {
    res.status(200).json({ success: true, data: result });
  } else {
    res.status(409).json({ success: false, data: result, error: result.error });
  }
});

// Renew lock
router.post('/renew', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  const { lock_key, owner_id, ttl_ms = 15000 } = req.body;
  const renewed = DistributedLockService.renewLock(lock_key, owner_id, ttl_ms);
  if (renewed) {
    res.json({ success: true, message: 'Lock renewed successfully' });
  } else {
    res.status(404).json({ success: false, error: 'Lock not found or expired' });
  }
});

// Release lock
router.post('/release', authenticate, requireRole(['admin', 'developer']), (req, res) => {
  const { lock_key, owner_id } = req.body;
  const released = DistributedLockService.releaseLock(lock_key, owner_id);
  res.json({ success: true, released, message: released ? 'Lock released' : 'No active lock found to release' });
});

// ----------------- RATE LIMITS -----------------

router.get('/rate-limits', authenticate, (req, res) => {
  const buckets = RateLimiterService.listAllBuckets();
  res.json({ success: true, data: buckets });
});

export default router;
