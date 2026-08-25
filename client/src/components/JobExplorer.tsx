import React, { useState, useEffect } from 'react';
import {
  ListOrdered,
  Search,
  Filter,
  Plus,
  RotateCcw,
  Ban,
  Eye,
  ChevronLeft,
  ChevronRight,
  Layers,
  Sparkles,
  X,
  FileCode
} from 'lucide-react';
import { Job, Queue, JobStatus } from '../types/index.js';
import { api } from '../services/api.js';
import { JobDetailModal } from './JobDetailModal.js';

interface JobExplorerProps {
  queues: Queue[];
  onRefresh: () => void;
}

export const JobExplorer: React.FC<JobExplorerProps> = ({ queues, onRefresh }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(15);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [selectedQueue, setSelectedQueue] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('all');
  const [selectedType, setSelectedType] = useState('all');

  // Selected job for detail modal
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);

  // Create Job Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [jobName, setJobName] = useState('');
  const [targetQueue, setTargetQueue] = useState(queues[0]?.id || '');
  const [jobType, setJobType] = useState<'immediate' | 'delayed'>('immediate');
  const [priority, setPriority] = useState(5);
  const [delaySeconds, setDelaySeconds] = useState(10);
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [payloadText, setPayloadText] = useState('{\n  "user_id": "usr_1001",\n  "action": "send_welcome_email"\n}');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fetchJobs = async () => {
    setLoading(true);
    try {
      const res = await api.listJobs({
        queue_id: selectedQueue || undefined,
        status: selectedStatus === 'all' ? undefined : selectedStatus,
        job_type: selectedType === 'all' ? undefined : selectedType,
        search: search.trim() || undefined,
        page,
        limit
      });
      setJobs(res.items);
      setTotal(res.total);
      setTotalPages(res.totalPages || 1);
    } catch (e) {
      console.error('Error fetching jobs:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, [page, selectedQueue, selectedStatus, selectedType]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchJobs();
  };

  const handleInspect = async (jobId: string) => {
    try {
      const full = await api.getJob(jobId);
      setSelectedJob(full);
    } catch (e) {
      alert('Failed to load job details');
    }
  };

  const handleCreateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      let parsedPayload = {};
      try {
        parsedPayload = JSON.parse(payloadText);
      } catch (err) {
        alert('Invalid JSON in payload');
        setIsSubmitting(false);
        return;
      }

      const runAt = jobType === 'delayed' ? new Date(Date.now() + delaySeconds * 1000).toISOString() : undefined;

      const res = await api.createJob({
        queue_id: targetQueue || queues[0]?.id,
        name: jobName.trim(),
        priority,
        run_at: runAt,
        idempotency_key: idempotencyKey.trim() || undefined,
        payload: parsedPayload
      });

      setIsCreateOpen(false);
      setJobName('');
      fetchJobs();
      onRefresh();

      if (res.isDuplicate) {
        alert('Idempotency Key Matched: Existing job returned without duplicate processing.');
      }
    } catch (err: any) {
      alert(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusBadge = (status: JobStatus) => {
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
        return 'bg-red-500/20 text-red-400 border-red-500/30 font-bold';
      case 'failed':
        return 'bg-rose-500/20 text-rose-400 border-rose-500/30';
      default:
        return 'bg-slate-700/40 text-slate-400 border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <ListOrdered className="w-6 h-6 text-blue-400" /> Distributed Job Explorer
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Search, filter, inspect payloads, view execution attempt histories, and trace live worker logs.
          </p>
        </div>

        <button
          onClick={() => setIsCreateOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Submit Job
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 flex flex-col md:flex-row gap-3 items-center justify-between">
        {/* Search */}
        <form onSubmit={handleSearchSubmit} className="w-full md:w-80 relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, name, or payload..."
            className="w-full pl-9 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-xs focus:outline-none focus:border-blue-500 font-mono"
          />
        </form>

        {/* Filters */}
        <div className="flex flex-wrap gap-2.5 w-full md:w-auto items-center">
          {/* Queue Filter */}
          <select
            value={selectedQueue}
            onChange={(e) => {
              setSelectedQueue(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="">All Queues</option>
            {queues.map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={(e) => {
              setSelectedStatus(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Statuses</option>
            <option value="queued">Queued</option>
            <option value="scheduled">Scheduled (Delayed)</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="dead_letter">Dead Letter Queue</option>
            <option value="cancelled">Cancelled</option>
          </select>

          {/* Job Type Filter */}
          <select
            value={selectedType}
            onChange={(e) => {
              setSelectedType(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-slate-300 text-xs focus:outline-none focus:border-blue-500"
          >
            <option value="all">All Job Types</option>
            <option value="immediate">Immediate</option>
            <option value="delayed">Delayed</option>
            <option value="cron">Cron (Recurring)</option>
            <option value="batch">Batch</option>
            <option value="dag_step">DAG Step</option>
          </select>
        </div>
      </div>

      {/* Jobs Table */}
      <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-950/70 text-slate-400 text-xs uppercase font-mono">
              <tr>
                <th className="px-5 py-3.5">Job Name / ID</th>
                <th className="px-5 py-3.5">Status</th>
                <th className="px-5 py-3.5">Type</th>
                <th className="px-5 py-3.5">Queue</th>
                <th className="px-5 py-3.5">Priority</th>
                <th className="px-5 py-3.5">Attempts</th>
                <th className="px-5 py-3.5">Worker</th>
                <th className="px-5 py-3.5">Scheduled / Created</th>
                <th className="px-5 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 font-sans">
              {jobs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12 text-slate-500 text-sm">
                    {loading ? 'Loading jobs from cluster...' : 'No jobs found matching criteria.'}
                  </td>
                </tr>
              ) : (
                jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-800/40 transition group">
                    <td className="px-5 py-3.5 font-medium text-white">
                      <div className="flex flex-col">
                        <span className="font-semibold text-slate-100 group-hover:text-blue-400 transition">{job.name}</span>
                        <span className="text-[11px] font-mono text-slate-500">{job.id.slice(0, 16)}...</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold uppercase border ${getStatusBadge(job.status)}`}>
                        {job.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs font-mono">
                        {job.job_type}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-300 font-mono">
                      {job.queue_name || 'default'}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono font-bold text-blue-400">
                      P{job.priority}
                    </td>
                    <td className="px-5 py-3.5 text-xs font-mono text-amber-400">
                      {job.attempt_count} / {job.max_retries}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-purple-300 font-mono">
                      {job.worker_name || '-'}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-400 font-mono">
                      {new Date(job.run_at).toLocaleTimeString()}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleInspect(job.id)}
                        className="p-1.5 rounded-lg bg-slate-800 hover:bg-blue-600/30 text-slate-300 hover:text-blue-300 border border-slate-700/60 transition inline-flex items-center gap-1 text-xs"
                      >
                        <Eye className="w-3.5 h-3.5" /> Inspect
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-800/80 bg-slate-950/40 flex items-center justify-between text-xs text-slate-400">
          <div>
            Showing <span className="text-white font-mono">{jobs.length}</span> of <span className="text-white font-mono">{total}</span> jobs
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-slate-200">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Create Job Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Plus className="w-5 h-5 text-blue-400" /> Submit Background Job
              </h2>
              <button
                onClick={() => setIsCreateOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Job Name</label>
                <input
                  type="text"
                  required
                  value={jobName}
                  onChange={(e) => setJobName(e.target.value)}
                  placeholder="e.g. Generate User PDF Report"
                  className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Target Queue</label>
                  <select
                    value={targetQueue}
                    onChange={(e) => setTargetQueue(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    {queues.map((q) => (
                      <option key={q.id} value={q.id}>
                        {q.name} (P{q.priority})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Execution Mode</label>
                  <select
                    value={jobType}
                    onChange={(e) => setJobType(e.target.value as any)}
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="immediate">Immediate</option>
                    <option value="delayed">Delayed</option>
                  </select>
                </div>
              </div>

              {jobType === 'delayed' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Delay (Seconds): <span className="text-purple-400 font-mono">{delaySeconds}s</span>
                  </label>
                  <input
                    type="range"
                    min="5"
                    max="300"
                    value={delaySeconds}
                    onChange={(e) => setDelaySeconds(parseInt(e.target.value, 10))}
                    className="w-full accent-purple-500"
                  />
                </div>
              )}

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
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Idempotency Key (Optional)</label>
                  <input
                    type="text"
                    value={idempotencyKey}
                    onChange={(e) => setIdempotencyKey(e.target.value)}
                    placeholder="e.g. invoice_evt_9981"
                    className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-800 text-white text-sm focus:outline-none focus:border-blue-500 font-mono placeholder-slate-600"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Payload JSON</label>
                <textarea
                  rows={4}
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
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
                >
                  {isSubmitting ? 'Submitting...' : 'Enqueue Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Inspect Job Modal */}
      {selectedJob && (
        <JobDetailModal
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onRefresh={() => {
            fetchJobs();
            handleInspect(selectedJob.id);
          }}
        />
      )}
    </div>
  );
};
