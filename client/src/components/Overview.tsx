import React from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Cpu,
  Layers,
  Zap,
  TrendingUp,
  Play,
  Pause
} from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid } from 'recharts';
import { SystemAnalytics, Queue } from '../types/index.js';

interface OverviewProps {
  analytics: SystemAnalytics | null;
  queues: Queue[];
  onToggleQueue: (queueId: string, isPaused: boolean) => void;
  onNavigate: (tab: string) => void;
  onOpenDemoLab: () => void;
}

export const Overview: React.FC<OverviewProps> = ({
  analytics,
  queues,
  onToggleQueue,
  onNavigate,
  onOpenDemoLab
}) => {
  const counts = analytics?.jobCounts || {
    queued: 0,
    scheduled: 0,
    claimed: 0,
    running: 0,
    completed: 0,
    failed: 0,
    dead_letter: 0,
    cancelled: 0
  };

  const total = analytics?.totalJobs || 0;
  const completed = counts.completed || 0;
  const active = (counts.running || 0) + (counts.claimed || 0);
  const dlq = counts.dead_letter || 0;
  const successRate = total > 0 ? Math.round((completed / (completed + dlq + (counts.failed || 0) || 1)) * 100) : 100;

  // Chart data
  const statusChartData = [
    { name: 'Queued', count: counts.queued, fill: '#3b82f6' },
    { name: 'Scheduled', count: counts.scheduled, fill: '#8b5cf6' },
    { name: 'Running', count: active, fill: '#eab308' },
    { name: 'Completed', count: completed, fill: '#10b981' },
    { name: 'DLQ', count: dlq, fill: '#ef4444' }
  ];

  const throughputData = analytics?.hourlyThroughput?.length
    ? analytics.hourlyThroughput
    : [
        { hour: '18:00', count: 12 },
        { hour: '19:00', count: 35 },
        { hour: '20:00', count: 68 },
        { hour: '21:00', count: 94 },
        { hour: '22:00', count: 140 },
        { hour: '23:00', count: completed }
      ];

  return (
    <div className="space-y-6">
      {/* Top Banner / Quick CTA */}
      <div className="rounded-2xl bg-gradient-to-r from-blue-950/80 via-slate-900 to-indigo-950/80 border border-blue-800/40 p-6 shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/20 text-blue-300 text-xs font-semibold mb-2 border border-blue-500/30">
              <Zap className="w-3.5 h-3.5" /> High-Performance Distributed Orchestration
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">System Health & Execution Telemetry</h1>
            <p className="text-slate-400 text-sm mt-1 max-w-2xl">
              Real-time monitoring of atomic job claiming, worker node cluster capacity, retry backoffs, and Dead Letter Queues with AI diagnostics.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onOpenDemoLab}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
            >
              <Zap className="w-4 h-4" /> Run Live Scenarios
            </button>
            <button
              onClick={() => onNavigate('jobs')}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium text-sm transition border border-slate-700"
            >
              Explore All Jobs
            </button>
          </div>
        </div>
      </div>

      {/* Metrics Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Active Jobs */}
        <div className="bg-slate-900/80 rounded-xl p-5 border border-slate-800 shadow-sm relative overflow-hidden">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Active Running</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <Activity className="w-4 h-4 animate-spin" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-white font-mono">{active}</span>
            <span className="text-xs font-medium text-amber-400 flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" /> Executing
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            {counts.queued} queued in backlog • {counts.scheduled} scheduled
          </div>
        </div>

        {/* Completed Jobs */}
        <div className="bg-slate-900/80 rounded-xl p-5 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Completed Jobs</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-white font-mono">{completed}</span>
            <span className="text-xs font-semibold text-emerald-400">{successRate}% Success</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Avg Latency: <span className="text-slate-300 font-mono">{analytics?.durationStats?.avgMs || 0}ms</span>
          </div>
        </div>

        {/* Dead Letter Queue */}
        <div
          onClick={() => onNavigate('dlq')}
          className="bg-slate-900/80 rounded-xl p-5 border border-slate-800 shadow-sm cursor-pointer hover:border-red-500/40 transition group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Dead Letter Queue</span>
            <div className="w-8 h-8 rounded-lg bg-red-500/20 text-red-400 flex items-center justify-center group-hover:scale-110 transition-transform">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-red-400 font-mono">{dlq}</span>
            <span className="text-xs font-medium text-red-400 underline">Inspect DLQ &rarr;</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Permanent failures with AI root cause analysis
          </div>
        </div>

        {/* Worker Cluster Capacity */}
        <div className="bg-slate-900/80 rounded-xl p-5 border border-slate-800 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">Worker Capacity</span>
            <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-4 flex items-baseline justify-between">
            <span className="text-3xl font-extrabold text-white font-mono">
              {analytics?.clusterStats?.totalCapacity || 15} <span className="text-sm font-normal text-slate-400">slots</span>
            </span>
            <span className="text-xs font-semibold text-blue-400">
              {analytics?.clusterStats?.activeWorkers || 3} Nodes Active
            </span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Cluster Utilization: <span className="text-slate-300 font-mono">{analytics?.clusterStats?.clusterUtilizationPct || 0}%</span>
          </div>
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Throughput Trend */}
        <div className="bg-slate-900/80 rounded-2xl p-6 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-400" /> Completion Throughput Trend
              </h2>
              <p className="text-xs text-slate-400">Jobs successfully executed over time</p>
            </div>
            <span className="text-xs font-mono text-slate-400 px-2.5 py-1 rounded bg-slate-800">12H Window</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={throughputData}>
                <defs>
                  <linearGradient id="throughputGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="hour" stroke="#64748b" fontSize={12} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                />
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} fill="url(#throughputGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* State Breakdown */}
        <div className="bg-slate-900/80 rounded-2xl p-6 border border-slate-800">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-indigo-400" /> Job Lifecycle State Distribution
              </h2>
              <p className="text-xs text-slate-400">Current volume by lifecycle phase</p>
            </div>
            <span className="text-xs font-mono text-slate-400 px-2.5 py-1 rounded bg-slate-800">Live Snapshot</span>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={statusChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff' }}
                />
                <Bar dataKey="count" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Queues Overview Table */}
      <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
        <div className="p-5 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-blue-400" /> Active Job Queues
            </h2>
            <p className="text-xs text-slate-400">Priority, concurrency bounds, and real-time pause/resume controls</p>
          </div>
          <button
            onClick={() => onNavigate('queues')}
            className="text-xs text-blue-400 hover:text-blue-300 font-medium"
          >
            Manage Queues &rarr;
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase font-mono">
              <tr>
                <th className="px-6 py-3">Queue Name</th>
                <th className="px-6 py-3">Status</th>
                <th className="px-6 py-3">Priority</th>
                <th className="px-6 py-3">Concurrency</th>
                <th className="px-6 py-3">Queued</th>
                <th className="px-6 py-3">Running</th>
                <th className="px-6 py-3">Completed</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {queues.map((q) => (
                <tr key={q.id} className="hover:bg-slate-800/40 transition">
                  <td className="px-6 py-4 font-medium text-white flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${q.is_paused ? 'bg-amber-500' : 'bg-emerald-500'}`} />
                    <span>{q.name}</span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        q.is_paused
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      }`}
                    >
                      {q.is_paused ? 'Paused' : 'Active'}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-300">P{q.priority}</td>
                  <td className="px-6 py-4 font-mono text-xs text-slate-300">{q.concurrency_limit} max</td>
                  <td className="px-6 py-4 font-mono text-xs text-blue-400">{q.stats?.queued || 0}</td>
                  <td className="px-6 py-4 font-mono text-xs text-amber-400">{q.stats?.running || 0}</td>
                  <td className="px-6 py-4 font-mono text-xs text-emerald-400">{q.stats?.completed || 0}</td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={() => onToggleQueue(q.id, !q.is_paused)}
                      className={`inline-flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-medium border transition ${
                        q.is_paused
                          ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/30 hover:bg-emerald-600/30'
                          : 'bg-amber-600/20 text-amber-300 border-amber-500/30 hover:bg-amber-600/30'
                      }`}
                    >
                      {q.is_paused ? <Play className="w-3 h-3" /> : <Pause className="w-3 h-3" />}
                      <span>{q.is_paused ? 'Resume' : 'Pause'}</span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
