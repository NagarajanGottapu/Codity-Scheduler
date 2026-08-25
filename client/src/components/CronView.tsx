import React, { useState, useEffect } from 'react';
import {
  Clock,
  Plus,
  Play,
  Pause,
  Trash2,
  Calendar,
  Layers,
  Sparkles,
  X,
  Activity
} from 'lucide-react';
import { ScheduledJob, Queue } from '../types/index.js';
import { api } from '../services/api.js';

interface CronViewProps {
  queues: Queue[];
  onRefresh: () => void;
}

export const CronView: React.FC<CronViewProps> = ({ queues, onRefresh }) => {
  const [schedules, setSchedules] = useState<ScheduledJob[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Form State
  const [name, setName] = useState('');
  const [cronExpr, setCronExpr] = useState('*/2 * * * *');
  const [targetQueue, setTargetQueue] = useState(queues[0]?.id || '');
  const [timezone, setTimezone] = useState('UTC');
  const [payloadText, setPayloadText] = useState('{\n  "routine": "heartbeat_sync"\n}');

  const fetchSchedules = async () => {
    setLoading(true);
    try {
      const list = await api.listCron();
      setSchedules(list);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSchedules();
  }, []);

  const handleToggle = async (id: string, currentActive: number) => {
    try {
      await api.toggleCron(id, currentActive === 0);
      await fetchSchedules();
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const handleDelete = async (id: string, sName: string) => {
    if (window.confirm(`Delete recurring schedule '${sName}'?`)) {
      try {
        await api.deleteCron(id);
        await fetchSchedules();
        onRefresh();
      } catch (e: any) {
        alert(e.message);
      }
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      let parsed = {};
      try {
        parsed = JSON.parse(payloadText);
      } catch (err) {
        alert('Invalid JSON payload');
        return;
      }

      await api.createCron({
        name: name.trim(),
        cron_expression: cronExpr.trim(),
        queue_id: targetQueue || queues[0]?.id,
        timezone,
        payload: parsed
      });

      setIsCreateOpen(false);
      setName('');
      await fetchSchedules();
      onRefresh();
    } catch (err: any) {
      alert(err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <Clock className="w-6 h-6 text-blue-400" /> Recurring & Scheduled Jobs (Cron)
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Automated recurring job scheduler evaluates cron syntax, calculates future run times, and dispatches background executions into queues.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Create Recurring Schedule
        </button>
      </div>

      {/* Schedules Table */}
      <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/60 text-slate-400 text-xs uppercase font-mono">
              <tr>
                <th className="px-6 py-3.5">Schedule Name</th>
                <th className="px-6 py-3.5">Status</th>
                <th className="px-6 py-3.5">Cron Expression</th>
                <th className="px-6 py-3.5">Queue</th>
                <th className="px-6 py-3.5">Total Runs</th>
                <th className="px-6 py-3.5">Next Run At</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {schedules.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-slate-500">
                    No recurring schedules created yet.
                  </td>
                </tr>
              ) : (
                schedules.map((schedule) => (
                  <tr key={schedule.id} className="hover:bg-slate-800/40 transition">
                    <td className="px-6 py-4 font-semibold text-white">
                      {schedule.name}
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase ${
                          schedule.is_active
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {schedule.is_active ? 'Active' : 'Paused'}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-blue-400">
                      <span className="px-2 py-1 rounded bg-slate-950 border border-slate-800">
                        {schedule.cron_expression}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-300">
                      {schedule.queue_name || 'default'}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-amber-400">
                      {schedule.total_runs} runs
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-purple-300">
                      {new Date(schedule.next_run_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <button
                        onClick={() => handleToggle(schedule.id, schedule.is_active)}
                        className={`p-1.5 rounded-lg border transition ${
                          schedule.is_active
                            ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                            : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                        }`}
                        title={schedule.is_active ? 'Pause Schedule' : 'Activate Schedule'}
                      >
                        {schedule.is_active ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDelete(schedule.id, schedule.name)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-slate-700 transition"
                        title="Delete Schedule"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create Schedule Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" /> Create Recurring Cron Task
              </h2>
              <button onClick={() => setIsCreateOpen(false)} className="p-1.5 text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Schedule Name</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Daily Warehouse Data Aggregation"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Cron Expression</label>
                  <input
                    type="text"
                    required
                    value={cronExpr}
                    onChange={(e) => setCronExpr(e.target.value)}
                    placeholder="*/5 * * * *"
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-blue-300 font-mono text-sm focus:outline-none focus:border-blue-500"
                  />
                  <span className="text-[10px] text-slate-500 font-mono">e.g. 0 * * * * (hourly), */1 * * * * (every min)</span>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Target Queue</label>
                  <select
                    value={targetQueue}
                    onChange={(e) => setTargetQueue(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    {queues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Payload JSON</label>
                <textarea
                  rows={3}
                  value={payloadText}
                  onChange={(e) => setPayloadText(e.target.value)}
                  className="w-full p-3 rounded-xl bg-slate-950 border border-slate-800 text-blue-300 font-mono text-xs focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium text-sm transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
                >
                  Save Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
