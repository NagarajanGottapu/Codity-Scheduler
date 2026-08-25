import React, { useState } from 'react';
import {
  Layers,
  Plus,
  Play,
  Pause,
  Trash2,
  Settings,
  ShieldAlert,
  Sliders,
  X,
  Check
} from 'lucide-react';
import { Queue, RetryPolicy } from '../types/index.js';
import { api } from '../services/api.js';

interface QueuesViewProps {
  queues: Queue[];
  policies: RetryPolicy[];
  onRefresh: () => void;
  onToggleQueue: (queueId: string, isPaused: boolean) => void;
}

export const QueuesView: React.FC<QueuesViewProps> = ({
  queues,
  policies,
  onRefresh,
  onToggleQueue
}) => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditingId, setIsEditingId] = useState<string | null>(null);

  // New Queue Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState(5);
  const [concurrency, setConcurrency] = useState(5);
  const [rateLimitPerMin, setRateLimitPerMin] = useState(120);
  const [retryPolicyId, setRetryPolicyId] = useState(policies[0]?.id || '');
  const [tags, setTags] = useState('default');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await api.createQueue({
        name: name.trim(),
        description: description.trim(),
        priority,
        concurrency_limit: concurrency,
        rate_limit_per_min: rateLimitPerMin,
        retry_policy_id: retryPolicyId || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean)
      });
      setIsCreateModalOpen(false);
      setName('');
      setDescription('');
      onRefresh();
    } catch (err: any) {
      setError(err.message || 'Failed to create queue');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, qName: string) => {
    if (window.confirm(`Are you sure you want to delete queue '${qName}' and all its pending jobs?`)) {
      try {
        await api.deleteQueue(id);
        onRefresh();
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Layers className="w-6 h-6 text-blue-400" /> Queue Configuration & Health
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Configure queue priorities, per-queue concurrency limits, rate-limit buckets, and retry policies.
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Create Queue
        </button>
      </div>

      {/* Queue Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {queues.map((q) => {
          let parsedTags: string[] = [];
          try {
            parsedTags = JSON.parse(q.tags || '["default"]');
          } catch (e) {
            parsedTags = ['default'];
          }

          return (
            <div
              key={q.id}
              className={`rounded-2xl border transition shadow-lg bg-slate-900/90 ${
                q.is_paused ? 'border-amber-500/40' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Card Header */}
              <div className="p-5 border-b border-slate-800/80">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-base text-white">{q.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
                          q.is_paused
                            ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        }`}
                      >
                        {q.is_paused ? 'Paused' : 'Active'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1 line-clamp-1">{q.description || 'No description'}</p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => onToggleQueue(q.id, !q.is_paused)}
                      title={q.is_paused ? 'Resume Queue' : 'Pause Queue'}
                      className={`p-1.5 rounded-lg border transition ${
                        q.is_paused
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/30'
                          : 'bg-amber-500/20 text-amber-300 border-amber-500/30 hover:bg-amber-500/30'
                      }`}
                    >
                      {q.is_paused ? <Play className="w-3.5 h-3.5" /> : <Pause className="w-3.5 h-3.5" />}
                    </button>
                    <button
                      onClick={() => handleDelete(q.id, q.name)}
                      title="Delete Queue"
                      className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-slate-700/60 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Configuration Badges */}
                <div className="flex flex-wrap gap-2 mt-4">
                  <span className="px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 text-xs font-mono font-medium">
                    Priority: P{q.priority}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-purple-500/10 text-purple-400 border border-purple-500/20 text-xs font-mono font-medium">
                    Concurrency: {q.concurrency_limit}
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 text-xs font-mono">
                    Limit: {q.rate_limit_per_min}/min
                  </span>
                </div>
              </div>

              {/* Live Queue Statistics */}
              <div className="p-5 space-y-4">
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <span className="block text-[10px] text-slate-400 uppercase tracking-wider font-mono">Queued</span>
                    <span className="text-lg font-bold text-blue-400 font-mono">{q.stats?.queued || 0}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <span className="block text-[10px] text-slate-400 uppercase tracking-wider font-mono">Running</span>
                    <span className="text-lg font-bold text-amber-400 font-mono">{q.stats?.running || 0}</span>
                  </div>
                  <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <span className="block text-[10px] text-slate-400 uppercase tracking-wider font-mono">Done</span>
                    <span className="text-lg font-bold text-emerald-400 font-mono">{q.stats?.completed || 0}</span>
                  </div>
                </div>

                <div className="text-xs space-y-1.5 text-slate-400 pt-2 border-t border-slate-800/60">
                  <div className="flex justify-between">
                    <span>Retry Strategy:</span>
                    <span className="text-slate-200 font-medium">{q.retry_policy?.name || 'Default Exponential'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Avg Latency:</span>
                    <span className="text-slate-200 font-mono">{q.stats?.avg_latency_ms || 0} ms</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Throughput:</span>
                    <span className="text-slate-200 font-mono">{q.stats?.throughput_per_min || 0} jobs/min</span>
                  </div>
                  <div className="flex justify-between items-center pt-1">
                    <span>Worker Shards:</span>
                    <div className="flex gap-1">
                      {parsedTags.map((tag) => (
                        <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300 font-mono">
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Create Queue Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" /> Create New Job Queue
              </h2>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4" /> {error}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Queue Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. transactional-emails"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Description</label>
                <input
                  type="text"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Critical notification dispatch pipeline"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Priority (1-10): <span className="text-blue-400 font-mono">P{priority}</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={priority}
                    onChange={(e) => setPriority(parseInt(e.target.value, 10))}
                    className="w-full accent-blue-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>1 (Lowest)</span>
                    <span>10 (Critical)</span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Concurrency Limit: <span className="text-purple-400 font-mono">{concurrency}</span>
                  </label>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={concurrency}
                    onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                    className="w-full accent-purple-500"
                  />
                  <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                    <span>1 job</span>
                    <span>20 max</span>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Rate Limit (Jobs/Min)</label>
                  <input
                    type="number"
                    min="1"
                    max="10000"
                    value={rateLimitPerMin}
                    onChange={(e) => setRateLimitPerMin(parseInt(e.target.value, 10))}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Retry Policy</label>
                  <select
                    value={retryPolicyId}
                    onChange={(e) => setRetryPolicyId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    {policies.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.strategy})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Worker Shard Tags (comma separated)</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. default, high-memory, gpu"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
                >
                  {loading ? 'Creating...' : 'Create Queue'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
