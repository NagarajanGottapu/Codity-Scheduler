import React, { useState } from 'react';
import {
  Cpu,
  Plus,
  Server,
  Activity,
  Zap,
  StopCircle,
  HardDrive,
  Clock,
  Tag,
  X,
  AlertCircle
} from 'lucide-react';
import { Worker } from '../types/index.js';
import { api } from '../services/api.js';

interface WorkersViewProps {
  workers: Worker[];
  onRefresh: () => void;
}

export const WorkersView: React.FC<WorkersViewProps> = ({ workers, onRefresh }) => {
  const [isSpawnOpen, setIsSpawnOpen] = useState(false);
  const [name, setName] = useState('');
  const [concurrency, setConcurrency] = useState(5);
  const [tags, setTags] = useState('default');
  const [loading, setLoading] = useState(false);

  const handleSpawn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await api.spawnWorker({
        name: name.trim() || undefined,
        concurrency,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean)
      });
      setIsSpawnOpen(false);
      setName('');
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async (workerId: string) => {
    if (window.confirm('Gracefully drain and stop this worker node?')) {
      try {
        await api.stopWorker(workerId);
        onRefresh();
      } catch (err: any) {
        alert(err.message);
      }
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return {
          badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
          dot: 'bg-emerald-500'
        };
      case 'busy':
        return {
          badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30 animate-pulse',
          dot: 'bg-amber-500'
        };
      case 'draining':
        return {
          badge: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
          dot: 'bg-orange-500'
        };
      case 'dead':
        return {
          badge: 'bg-red-500/20 text-red-400 border-red-500/30',
          dot: 'bg-red-500'
        };
      default:
        return {
          badge: 'bg-slate-700/40 text-slate-400 border-slate-700',
          dot: 'bg-slate-500'
        };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Cpu className="w-6 h-6 text-blue-400" /> Distributed Worker Cluster
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Worker nodes poll queues, atomically acquire leases, execute jobs concurrently, and emit real-time heartbeats.
          </p>
        </div>

        <button
          onClick={() => setIsSpawnOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Spawn Worker Node
        </button>
      </div>

      {/* Workers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {workers.map((worker) => {
          const colors = getStatusColor(worker.status);
          let metricsObj: any = {};
          try {
            metricsObj = JSON.parse(worker.metrics || '{}');
          } catch (e) {}

          let parsedTags: string[] = [];
          try {
            parsedTags = JSON.parse(worker.tags || '["default"]');
          } catch (e) {
            parsedTags = ['default'];
          }

          const capacityPct = worker.concurrency > 0 ? Math.round((worker.active_jobs_count / worker.concurrency) * 100) : 0;
          const cpuPct = metricsObj.cpuPct ?? Math.round(worker.active_jobs_count * 15);
          const memMb = metricsObj.memoryMb ?? 42.5;

          return (
            <div
              key={worker.id}
              className={`bg-slate-900/90 rounded-2xl border transition shadow-lg ${
                worker.status === 'dead' ? 'border-red-900/60' : 'border-slate-800 hover:border-slate-700'
              }`}
            >
              {/* Card Header */}
              <div className="p-5 border-b border-slate-800/80 flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center text-blue-400">
                    <Server className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="font-bold text-base text-white">{worker.name}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] font-mono text-slate-400">{worker.id}</span>
                      <span className="text-slate-600">•</span>
                      <span className="text-[11px] text-slate-400 font-mono">{worker.hostname}</span>
                    </div>
                  </div>
                </div>

                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase border flex items-center gap-1.5 ${colors.badge}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${colors.dot}`} />
                  {worker.status}
                </span>
              </div>

              {/* Card Body */}
              <div className="p-5 space-y-4">
                {/* Concurrency Slots Bar */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-slate-400 flex items-center gap-1">
                      <Zap className="w-3.5 h-3.5 text-amber-400" /> Active Job Slots
                    </span>
                    <span className="font-mono text-slate-200">
                      {worker.active_jobs_count} / {worker.concurrency} ({capacityPct}%)
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-950 border border-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-500 to-amber-400 transition-all duration-500"
                      style={{ width: `${capacityPct}%` }}
                    />
                  </div>
                </div>

                {/* Resource Gauges */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono uppercase mb-1">
                      <span>CPU Load</span>
                      <Activity className="w-3 h-3 text-blue-400" />
                    </div>
                    <span className="text-base font-bold text-white font-mono">{cpuPct}%</span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/60">
                    <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono uppercase mb-1">
                      <span>Memory</span>
                      <HardDrive className="w-3 h-3 text-purple-400" />
                    </div>
                    <span className="text-base font-bold text-white font-mono">{memMb} <span className="text-xs text-slate-400">MB</span></span>
                  </div>
                </div>

                {/* Shard Tags */}
                <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between text-xs">
                  <span className="text-slate-500 flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" /> Shards:
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {parsedTags.map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-mono border border-slate-700/60">
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Heartbeat Timestamp */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Last Heartbeat:
                  </span>
                  <span className="text-slate-400">{new Date(worker.last_heartbeat_at).toLocaleTimeString()}</span>
                </div>

                {/* Action */}
                {worker.status !== 'offline' && worker.status !== 'dead' && (
                  <button
                    onClick={() => handleStop(worker.id)}
                    className="w-full py-2 rounded-xl bg-slate-800/80 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-slate-700/60 text-xs font-medium transition flex items-center justify-center gap-2"
                  >
                    <StopCircle className="w-4 h-4" /> Drain & Stop Worker
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Spawn Worker Modal */}
      {isSpawnOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" /> Spawn Worker Node
              </h2>
              <button
                onClick={() => setIsSpawnOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSpawn} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Worker Name (Optional)</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Worker-GPU-01"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                  Concurrency Slots: <span className="text-blue-400 font-mono">{concurrency}</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="20"
                  value={concurrency}
                  onChange={(e) => setConcurrency(parseInt(e.target.value, 10))}
                  className="w-full accent-blue-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Shard Tags (comma separated)</label>
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="e.g. default, high-memory"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500 font-mono"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsSpawnOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
                >
                  {loading ? 'Spawning...' : 'Launch Worker'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
