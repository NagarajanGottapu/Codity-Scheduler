import React, { useState } from 'react';
import {
  X,
  Clock,
  RotateCcw,
  Ban,
  CheckCircle2,
  AlertTriangle,
  Cpu,
  Terminal,
  Layers,
  FileCode,
  Calendar,
  Zap,
  Activity
} from 'lucide-react';
import { Job, JobExecution, JobLog } from '../types/index.js';
import { api } from '../services/api.js';

interface JobDetailModalProps {
  job: Job | null;
  onClose: () => void;
  onRefresh: () => void;
}

export const JobDetailModal: React.FC<JobDetailModalProps> = ({ job, onClose, onRefresh }) => {
  const [activeTab, setActiveTab] = useState<'timeline' | 'payload' | 'logs' | 'executions'>('timeline');
  const [actionLoading, setActionLoading] = useState(false);

  if (!job) return null;

  const handleRetry = async () => {
    setActionLoading(true);
    try {
      await api.retryJob(job.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    setActionLoading(true);
    try {
      await api.cancelJob(job.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
      case 'running':
      case 'claimed':
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30 animate-pulse';
      case 'queued':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'scheduled':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      case 'dead_letter':
        return 'bg-red-500/20 text-red-400 border-red-500/30';
      case 'failed':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-700/40 text-slate-400 border-slate-700';
    }
  };

  let formattedPayload = job.payload;
  try {
    formattedPayload = JSON.stringify(JSON.parse(job.payload), null, 2);
  } catch (e) {}

  let formattedResult = job.result;
  try {
    if (job.result) formattedResult = JSON.stringify(JSON.parse(job.result), null, 2);
  } catch (e) {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400">
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-white tracking-tight">{job.name}</h2>
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase border ${getStatusBadge(job.status)}`}>
                  {job.status}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 text-xs font-mono">
                  {job.job_type}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">ID: {job.id}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {['failed', 'dead_letter', 'cancelled'].includes(job.status) && (
              <button
                onClick={handleRetry}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 text-xs font-medium flex items-center gap-1.5 transition"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Replay / Retry
              </button>
            )}
            {['queued', 'scheduled'].includes(job.status) && (
              <button
                onClick={handleCancel}
                disabled={actionLoading}
                className="px-3 py-1.5 rounded-lg bg-red-600/20 text-red-300 hover:bg-red-600/30 border border-red-500/30 text-xs font-medium flex items-center gap-1.5 transition"
              >
                <Ban className="w-3.5 h-3.5" /> Cancel Job
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Subheader Metadata Bar */}
        <div className="px-6 py-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap gap-4 text-xs text-slate-400 font-mono">
          <div>Queue: <span className="text-slate-200">{job.queue_name || job.queue_id}</span></div>
          <div>Priority: <span className="text-blue-400 font-bold">P{job.priority}</span></div>
          <div>Attempts: <span className="text-amber-400">{job.attempt_count} / {job.max_retries}</span></div>
          <div>Worker: <span className="text-purple-300">{job.worker_name || job.worker_id || 'None'}</span></div>
          <div>Run At: <span className="text-slate-200">{new Date(job.run_at).toLocaleString()}</span></div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-900">
          {[
            { id: 'timeline', label: 'Lifecycle Timeline', icon: Activity },
            { id: 'payload', label: 'Payload & Result', icon: FileCode },
            { id: 'logs', label: `Live Logs (${job.logs?.length || 0})`, icon: Terminal },
            { id: 'executions', label: `Executions (${job.executions?.length || 0})`, icon: Cpu }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 py-3 px-4 text-xs font-medium border-b-2 transition ${
                  isActive
                    ? 'border-blue-500 text-blue-400 bg-blue-500/10'
                    : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/40'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4">
          {/* TIMELINE TAB */}
          {activeTab === 'timeline' && (
            <div className="space-y-6">
              <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-800">
                {/* Step 1: Queued / Scheduled */}
                <div className="relative">
                  <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-blue-500 border-2 border-slate-900 flex items-center justify-center" />
                  <div className="text-sm font-semibold text-white">Job Ingested & Enqueued</div>
                  <div className="text-xs text-slate-400 font-mono mt-0.5">Created at: {new Date(job.created_at).toLocaleString()}</div>
                  <div className="text-xs text-slate-500 mt-1">Scheduled to execute at: {new Date(job.run_at).toLocaleString()}</div>
                </div>

                {/* Step 2: Claimed & Running */}
                {job.claimed_at && (
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-amber-500 border-2 border-slate-900" />
                    <div className="text-sm font-semibold text-white">Atomically Claimed by Worker</div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">Claimed at: {new Date(job.claimed_at).toLocaleString()}</div>
                    <div className="text-xs text-slate-400 mt-1">Worker: <span className="text-amber-300 font-mono">{job.worker_name || job.worker_id}</span></div>
                  </div>
                )}

                {/* Step 3: Completion / DLQ */}
                {job.status === 'completed' && (
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-slate-900" />
                    <div className="text-sm font-semibold text-emerald-400">Execution Completed Successfully</div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">Completed at: {job.completed_at ? new Date(job.completed_at).toLocaleString() : 'N/A'}</div>
                  </div>
                )}

                {(job.status === 'dead_letter' || job.status === 'failed') && (
                  <div className="relative">
                    <div className="absolute -left-6 top-1 w-4 h-4 rounded-full bg-red-500 border-2 border-slate-900" />
                    <div className="text-sm font-semibold text-red-400">Job Moved to Dead Letter Queue (DLQ)</div>
                    <div className="text-xs text-red-300 font-mono mt-1 p-3 rounded-lg bg-red-950/40 border border-red-800/60">
                      Reason: {job.error_message || 'Execution error'}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PAYLOAD TAB */}
          {activeTab === 'payload' && (
            <div className="space-y-4">
              <div>
                <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Input Payload JSON</span>
                <pre className="mt-1.5 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-blue-300 overflow-x-auto">
                  {formattedPayload}
                </pre>
              </div>

              {formattedResult && (
                <div>
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Execution Result JSON</span>
                  <pre className="mt-1.5 p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs font-mono text-emerald-300 overflow-x-auto">
                    {formattedResult}
                  </pre>
                </div>
              )}

              {job.error_stack && (
                <div>
                  <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Error Stack Trace</span>
                  <pre className="mt-1.5 p-4 rounded-xl bg-red-950/30 border border-red-900/50 text-xs font-mono text-red-300 overflow-x-auto whitespace-pre-wrap">
                    {job.error_stack}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* LOGS TAB */}
          {activeTab === 'logs' && (
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs max-h-96 overflow-y-auto space-y-1.5">
              {(!job.logs || job.logs.length === 0) ? (
                <div className="text-slate-500 py-4 text-center">No logs recorded for this job yet.</div>
              ) : (
                job.logs.map((log) => {
                  let color = 'text-slate-300';
                  if (log.level === 'error') color = 'text-red-400 font-semibold';
                  else if (log.level === 'warn') color = 'text-amber-400';
                  else if (log.level === 'debug') color = 'text-slate-500';

                  return (
                    <div key={log.id} className="flex items-start gap-2.5 hover:bg-slate-900/50 py-0.5 px-1 rounded">
                      <span className="text-slate-600 select-none text-[10px]">{new Date(log.timestamp).toLocaleTimeString()}</span>
                      <span className={`uppercase text-[10px] px-1 rounded ${
                        log.level === 'error' ? 'bg-red-500/20 text-red-400' :
                        log.level === 'warn' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'
                      }`}>
                        {log.level}
                      </span>
                      <span className={`${color} flex-1`}>{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* EXECUTIONS TAB */}
          {activeTab === 'executions' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 uppercase font-mono">
                  <tr>
                    <th className="px-4 py-2.5">Attempt</th>
                    <th className="px-4 py-2.5">Worker</th>
                    <th className="px-4 py-2.5">Status</th>
                    <th className="px-4 py-2.5">Duration</th>
                    <th className="px-4 py-2.5">Started At</th>
                    <th className="px-4 py-2.5">Exit Code</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 font-mono">
                  {job.executions?.map((exec) => (
                    <tr key={exec.id} className="hover:bg-slate-800/40">
                      <td className="px-4 py-3 font-bold text-white">#{exec.attempt_number}</td>
                      <td className="px-4 py-3 text-purple-300">{exec.worker_name || exec.worker_id}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-semibold ${
                          exec.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                          exec.status === 'failed' ? 'bg-red-500/20 text-red-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {exec.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-300">{exec.duration_ms ? `${exec.duration_ms}ms` : 'In Progress'}</td>
                      <td className="px-4 py-3 text-slate-400">{new Date(exec.started_at).toLocaleTimeString()}</td>
                      <td className="px-4 py-3 text-slate-300">{exec.exit_code ?? '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
