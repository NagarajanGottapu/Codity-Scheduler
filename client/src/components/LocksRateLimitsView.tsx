import React, { useState, useEffect } from 'react';
import {
  Lock,
  Unlock,
  Key,
  ShieldCheck,
  Zap,
  RefreshCw,
  Plus,
  Layers,
  Activity
} from 'lucide-react';
import { DistributedLock, RateLimitBucket } from '../types/index.js';
import { api } from '../services/api.js';

export const LocksRateLimitsView: React.FC = () => {
  const [locks, setLocks] = useState<DistributedLock[]>([]);
  const [buckets, setBuckets] = useState<RateLimitBucket[]>([]);
  const [loading, setLoading] = useState(false);

  // Acquire Lock Form
  const [lockKey, setLockKey] = useState('resource_mutex_01');
  const [ownerId, setOwnerId] = useState('worker_node_alpha');
  const [ttlMs, setTtlMs] = useState(15000);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [l, b] = await Promise.all([api.listLocks(), api.listRateLimits()]);
      setLocks(l);
      setBuckets(b);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleAcquire = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.acquireLock({
        lock_key: lockKey.trim(),
        owner_id: ownerId.trim(),
        ttl_ms: ttlMs
      });
      setStatusMsg(`Lock '${lockKey}' acquired successfully with Fencing Token #${res.data.fencingToken}`);
      await fetchData();
    } catch (err: any) {
      setStatusMsg(`Acquire Rejected: ${err.message}`);
    }
  };

  const handleRelease = async (key: string, owner: string) => {
    try {
      const res = await api.releaseLock({ lock_key: key, owner_id: owner });
      setStatusMsg(`Lock '${key}' released`);
      await fetchData();
    } catch (err: any) {
      setStatusMsg(`Release failed: ${err.message}`);
    }
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
          <Lock className="w-6 h-6 text-blue-400" /> Distributed Locks & Rate Limit Buckets
        </h1>
        <p className="text-slate-400 text-sm mt-1">
          Monitor distributed mutual exclusion leases (with fencing tokens and TTL expiration) and token-bucket rate limiter states.
        </p>
      </div>

      {statusMsg && (
        <div className="p-3.5 rounded-xl bg-blue-950/60 border border-blue-800/60 text-xs text-blue-200 flex items-center justify-between font-mono">
          <span>{statusMsg}</span>
          <button onClick={() => setStatusMsg(null)} className="text-blue-400 hover:text-white">&times;</button>
        </div>
      )}

      {/* SECTION 1: DISTRIBUTED LOCKS */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Key className="w-5 h-5 text-purple-400" /> Active Distributed Mutex Locks
          </h2>
          <button
            onClick={fetchData}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Interactive Acquire Box */}
          <div className="lg:col-span-1 bg-slate-900/90 rounded-2xl border border-slate-800 p-5 space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Plus className="w-4 h-4 text-blue-400" /> Acquire Test Lock
            </h3>

            <form onSubmit={handleAcquire} className="space-y-3">
              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">Lock Key</label>
                <input
                  type="text"
                  required
                  value={lockKey}
                  onChange={(e) => setLockKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">Owner Identifier</label>
                <input
                  type="text"
                  required
                  value={ownerId}
                  onChange={(e) => setOwnerId(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-mono text-slate-400 uppercase mb-1">
                  Lease TTL: <span className="text-blue-400">{ttlMs / 1000}s</span>
                </label>
                <input
                  type="range"
                  min="5000"
                  max="60000"
                  step="5000"
                  value={ttlMs}
                  onChange={(e) => setTtlMs(parseInt(e.target.value, 10))}
                  className="w-full accent-blue-500"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-xs transition shadow-lg shadow-blue-600/30 flex items-center justify-center gap-2"
              >
                <Lock className="w-3.5 h-3.5" /> Acquire Mutex
              </button>
            </form>
          </div>

          {/* Active Locks Table */}
          <div className="lg:col-span-2 bg-slate-900/90 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono">
                  <tr>
                    <th className="px-5 py-3">Lock Key</th>
                    <th className="px-5 py-3">Current Owner</th>
                    <th className="px-5 py-3">Fencing Token</th>
                    <th className="px-5 py-3">Expires At</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono">
                  {locks.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-10 text-slate-500">
                        No active distributed locks held.
                      </td>
                    </tr>
                  ) : (
                    locks.map((lock) => (
                      <tr key={lock.lock_key} className="hover:bg-slate-800/40">
                        <td className="px-5 py-3 font-bold text-white">{lock.lock_key}</td>
                        <td className="px-5 py-3 text-purple-300">{lock.owner_id}</td>
                        <td className="px-5 py-3 text-blue-400 font-bold">#{lock.fencing_token}</td>
                        <td className="px-5 py-3 text-slate-400">{new Date(lock.expires_at).toLocaleTimeString()}</td>
                        <td className="px-5 py-3 text-right">
                          <button
                            onClick={() => handleRelease(lock.lock_key, lock.owner_id)}
                            className="px-2.5 py-1 rounded bg-slate-800 hover:bg-red-500/20 text-slate-300 hover:text-red-300 border border-slate-700 transition"
                          >
                            Release
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* SECTION 2: RATE LIMIT BUCKETS */}
      <div className="space-y-4 pt-4 border-t border-slate-800">
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <Zap className="w-5 h-5 text-amber-400" /> Token-Bucket Rate Limiter Telemetry
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {buckets.length === 0 ? (
            <div className="col-span-3 text-center py-10 bg-slate-900/60 rounded-2xl border border-slate-800 text-slate-500 text-xs">
              No active rate limit buckets recorded yet. Buckets populate automatically upon queue claim activity.
            </div>
          ) : (
            buckets.map((b) => {
              const pct = Math.min(100, Math.round((b.tokens_remaining / (b.capacity || 1)) * 100));

              return (
                <div key={b.bucket_key} className="bg-slate-900/90 rounded-2xl border border-slate-800 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs font-bold text-white">{b.bucket_key}</span>
                    <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-amber-500/20 text-amber-400 font-mono">
                      {b.refill_rate_per_sec}/sec refill
                    </span>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs font-mono text-slate-400 mb-1">
                      <span>Available Tokens:</span>
                      <span className="text-white font-bold">{Math.round(b.tokens_remaining)} / {b.capacity}</span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-emerald-400 transition-all duration-300"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
