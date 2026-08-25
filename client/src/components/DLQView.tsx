import React, { useState, useEffect } from 'react';
import {
  AlertTriangle,
  RotateCcw,
  Trash2,
  Sparkles,
  ShieldAlert,
  CheckCircle2,
  Brain,
  ArrowRight,
  Layers,
  ChevronLeft,
  ChevronRight,
  Terminal,
  Activity
} from 'lucide-react';
import { DeadLetterJob, Queue } from '../types/index.js';
import { api } from '../services/api.js';

interface DLQViewProps {
  queues: Queue[];
  onRefresh: () => void;
}

export const DLQView: React.FC<DLQViewProps> = ({ queues, onRefresh }) => {
  const [items, setItems] = useState<DeadLetterJob[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [statusFilter, setStatusFilter] = useState('unresolved');
  const [selectedQueue, setSelectedQueue] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const fetchDLQ = async () => {
    setLoading(true);
    try {
      const res = await api.listDLQ({
        status: statusFilter === 'all' ? undefined : statusFilter,
        queue_id: selectedQueue || undefined,
        page,
        limit: 10
      });
      setItems(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages || 1);
    } catch (e) {
      console.error('Error fetching DLQ:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDLQ();
  }, [page, statusFilter, selectedQueue]);

  const handleReplay = async (id: string) => {
    setActionLoading(true);
    try {
      await api.replayDLQJob(id);
      await fetchDLQ();
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBulkReplay = async () => {
    if (window.confirm('Replay all unresolved Dead Letter Queue jobs back into worker queues?')) {
      setActionLoading(true);
      try {
        const res = await api.bulkReplayDLQ('project-default', selectedQueue || undefined);
        alert(res.message);
        await fetchDLQ();
        onRefresh();
      } catch (e: any) {
        alert(e.message);
      } finally {
        setActionLoading(false);
      }
    }
  };

  const handlePurge = async () => {
    if (window.confirm('Are you sure you want to permanently purge Dead Letter Queue entries?')) {
      setActionLoading(true);
      try {
        const res = await api.purgeDLQ('project-default');
        alert(`Purged ${res.count} records`);
        await fetchDLQ();
        onRefresh();
      } catch (e: any) {
        alert(e.message);
      } finally {
        setActionLoading(false);
      }
    }
  };

  const getCategoryColor = (category?: string) => {
    switch (category) {
      case 'RATE_LIMIT_EXCEEDED':
        return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
      case 'DATABASE_TIMEOUT':
        return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
      case 'NETWORK_PARTITION':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/40';
      case 'AUTHENTICATION_FAILURE':
        return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
      case 'RESOURCE_EXHAUSTION':
        return 'bg-orange-500/20 text-orange-300 border-orange-500/40';
      default:
        return 'bg-red-500/20 text-red-300 border-red-500/40';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <AlertTriangle className="w-6 h-6 text-red-400" /> Dead Letter Queue (DLQ) & AI Diagnostics
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Jobs that exceeded max retry attempts are quarantined here with automated AI Root Cause Analysis and remediation suggestions.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={handleBulkReplay}
            disabled={actionLoading || items.length === 0}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white font-medium text-xs sm:text-sm transition shadow-lg shadow-emerald-600/20 flex items-center gap-1.5"
          >
            <RotateCcw className="w-4 h-4" /> Bulk Replay All
          </button>
          <button
            onClick={handlePurge}
            disabled={actionLoading || items.length === 0}
            className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-300 border border-slate-700 text-xs sm:text-sm transition flex items-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" /> Purge
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="unresolved">Unresolved Failures</option>
            <option value="replayed">Replayed</option>
            <option value="all">All DLQ Records</option>
          </select>

          <select
            value={selectedQueue}
            onChange={(e) => {
              setSelectedQueue(e.target.value);
              setPage(1);
            }}
            className="px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="">All Queues</option>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>
        </div>

        <span className="text-xs text-slate-400 font-mono">
          Total Quarantined: <span className="text-red-400 font-bold">{total}</span>
        </span>
      </div>

      {/* DLQ Cards List */}
      <div className="space-y-4">
        {items.length === 0 ? (
          <div className="text-center py-16 bg-slate-900/60 rounded-2xl border border-slate-800">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3 opacity-80" />
            <h3 className="text-base font-bold text-white">Dead Letter Queue is Clean</h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
              No unresolved permanent failures detected. All workers and queues are operating within safety parameters.
            </p>
          </div>
        ) : (
          items.map((dlq) => {
            const ai = dlq.ai_root_cause_analysis;

            return (
              <div
                key={dlq.id}
                className="bg-slate-900/90 rounded-2xl border border-slate-800 hover:border-slate-700 transition shadow-lg overflow-hidden"
              >
                {/* Header */}
                <div className="p-5 border-b border-slate-800/80 bg-slate-950/40 flex flex-col md:flex-row md:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2.5">
                      <span className="text-base font-bold text-white">{dlq.job_name || 'Failed Task'}</span>
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase bg-red-500/20 text-red-400 border border-red-500/30">
                        {dlq.status}
                      </span>
                      <span className="text-xs font-mono text-slate-400 px-2 py-0.5 rounded bg-slate-800">
                        {dlq.queue_name || 'default'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-slate-500 font-mono mt-1">
                      <span>Failed At: {new Date(dlq.failed_at).toLocaleString()}</span>
                      <span>•</span>
                      <span>Total Attempts: <span className="text-amber-400 font-bold">{dlq.attempt_count}</span></span>
                    </div>
                  </div>

                  {dlq.status === 'unresolved' && (
                    <button
                      onClick={() => handleReplay(dlq.id)}
                      disabled={actionLoading}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition flex items-center gap-1.5 shadow-md self-start md:self-auto"
                    >
                      <RotateCcw className="w-3.5 h-3.5" /> Replay Job
                    </button>
                  )}
                </div>

                {/* Body */}
                <div className="p-5 space-y-4">
                  {/* Failure Reason */}
                  <div>
                    <span className="text-xs font-semibold text-red-400 uppercase tracking-wider">Raw Exception Message</span>
                    <p className="text-xs font-mono text-red-300 mt-1 p-3 rounded-xl bg-red-950/30 border border-red-900/40">
                      {dlq.failure_reason}
                    </p>
                  </div>

                  {/* AI Root Cause Diagnostic Box */}
                  {ai && (
                    <div className="p-4 rounded-xl bg-gradient-to-r from-blue-950/40 via-indigo-950/30 to-purple-950/40 border border-blue-800/40 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Brain className="w-4 h-4 text-blue-400 animate-pulse" />
                          <span className="text-xs font-bold text-blue-300 uppercase tracking-wider">
                            AI-Generated Root Cause Diagnosis
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${getCategoryColor(ai.category)}`}>
                            {ai.category}
                          </span>
                          <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/40 px-2 py-0.5 rounded border border-emerald-800/40">
                            {Math.round((ai.confidence || 0.95) * 100)}% Confidence
                          </span>
                        </div>
                      </div>

                      <div className="text-xs text-slate-200">
                        <strong className="text-white block mb-0.5">{ai.root_cause}</strong>
                        <p className="text-slate-300">{ai.explanation}</p>
                      </div>

                      <div className="p-3 rounded-lg bg-blue-900/20 border border-blue-500/30 text-xs text-blue-200 flex items-start gap-2">
                        <Sparkles className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-white">Recommended Remediation:</strong> {ai.recommended_action}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="p-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <div>Showing page {page} of {totalPages}</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
