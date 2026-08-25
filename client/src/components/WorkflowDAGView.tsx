import React, { useState, useEffect } from 'react';
import {
  GitMerge,
  Plus,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  Sparkles,
  Layers,
  Activity,
  FileCode
} from 'lucide-react';
import { WorkflowDAG, Job } from '../types/index.js';
import { api } from '../services/api.js';

interface WorkflowDAGViewProps {
  onRefresh: () => void;
}

export const WorkflowDAGView: React.FC<WorkflowDAGViewProps> = ({ onRefresh }) => {
  const [workflows, setWorkflows] = useState<WorkflowDAG[]>([]);
  const [selectedDagId, setSelectedDagId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isTriggering, setIsTriggering] = useState(false);

  const fetchWorkflows = async () => {
    setLoading(true);
    try {
      const list = await api.listWorkflows();
      setWorkflows(list);
      if (list.length > 0 && !selectedDagId) {
        setSelectedDagId(list[0].id);
      }
    } catch (e) {
      console.error('Error fetching workflows:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  const handleTriggerDemo = async () => {
    setIsTriggering(true);
    try {
      const res = await api.triggerDAGPipeline();
      await fetchWorkflows();
      setSelectedDagId(res.data.id);
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setIsTriggering(false);
    }
  };

  const selectedDag = workflows.find((w) => w.id === selectedDagId) || workflows[0];

  const getNodeColor = (status?: string) => {
    switch (status) {
      case 'completed':
        return 'bg-emerald-950/40 border-emerald-500/60 text-emerald-300';
      case 'running':
      case 'claimed':
        return 'bg-amber-950/40 border-amber-500/60 text-amber-300 animate-pulse';
      case 'queued':
        return 'bg-blue-950/40 border-blue-500/60 text-blue-300';
      case 'scheduled':
        return 'bg-purple-950/30 border-purple-800/40 text-purple-400 opacity-80';
      case 'failed':
      case 'dead_letter':
        return 'bg-red-950/40 border-red-500/60 text-red-300';
      default:
        return 'bg-slate-900 border-slate-800 text-slate-400';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <GitMerge className="w-6 h-6 text-blue-400" /> Workflow Dependency Orchestration (DAG)
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Directed Acyclic Graphs with cycle validation, automated parent-to-child triggering, and cascade failure protection.
          </p>
        </div>

        <button
          onClick={handleTriggerDemo}
          disabled={isTriggering}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-medium text-sm transition shadow-lg shadow-blue-600/30 flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" /> {isTriggering ? 'Triggering...' : 'Trigger ETL DAG Pipeline'}
        </button>
      </div>

      {/* Main Layout: Sidebar of DAG runs + Visual Canvas */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: DAG Runs List */}
        <div className="lg:col-span-1 bg-slate-900/80 rounded-2xl border border-slate-800 p-4 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="text-xs font-bold text-slate-400 uppercase font-mono tracking-wider">Workflows</span>
            <span className="text-xs text-slate-500 font-mono">{workflows.length} total</span>
          </div>

          <div className="space-y-2 max-h-[600px] overflow-y-auto">
            {workflows.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                No workflows created yet. Click "Trigger ETL DAG Pipeline" above!
              </div>
            ) : (
              workflows.map((dag) => {
                const isSelected = selectedDag?.id === dag.id;
                const isCompleted = dag.status === 'completed';
                const isFailed = dag.status === 'failed';

                return (
                  <div
                    key={dag.id}
                    onClick={() => setSelectedDagId(dag.id)}
                    className={`p-3.5 rounded-xl border transition cursor-pointer ${
                      isSelected
                        ? 'bg-blue-600/20 border-blue-500/50 shadow-md'
                        : 'bg-slate-950/60 border-slate-800/80 hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-white line-clamp-1">{dag.name}</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold ${
                          isCompleted
                            ? 'bg-emerald-500/20 text-emerald-400'
                            : isFailed
                            ? 'bg-red-500/20 text-red-400'
                            : 'bg-amber-500/20 text-amber-400 animate-pulse'
                        }`}
                      >
                        {dag.status}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                      <span>Progress: {dag.completed_nodes} / {dag.total_nodes} steps</span>
                      <span>{new Date(dag.created_at).toLocaleTimeString()}</span>
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full h-1.5 rounded-full bg-slate-900 mt-2 overflow-hidden border border-slate-800">
                      <div
                        className={`h-full transition-all duration-500 ${
                          isCompleted ? 'bg-emerald-500' : isFailed ? 'bg-red-500' : 'bg-blue-500'
                        }`}
                        style={{ width: `${(dag.completed_nodes / (dag.total_nodes || 1)) * 100}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right: Visual DAG Node Canvas */}
        <div className="lg:col-span-3 bg-slate-900/80 rounded-2xl border border-slate-800 p-6 space-y-6">
          {!selectedDag ? (
            <div className="text-center py-20 text-slate-500">Select or trigger a DAG workflow to inspect graph.</div>
          ) : (
            <div>
              {/* Pipeline Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-800 gap-2">
                <div>
                  <h2 className="text-lg font-bold text-white flex items-center gap-2">
                    <GitMerge className="w-5 h-5 text-blue-400" /> {selectedDag.name}
                  </h2>
                  <p className="text-xs text-slate-400 mt-0.5">{selectedDag.description || 'DAG Dependency Pipeline'}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-mono text-slate-400">
                    Completed: <span className="text-emerald-400 font-bold">{selectedDag.completed_nodes}</span> / {selectedDag.total_nodes} Steps
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold uppercase border ${
                      selectedDag.status === 'completed'
                        ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                        : selectedDag.status === 'failed'
                        ? 'bg-red-500/20 text-red-400 border-red-500/30'
                        : 'bg-amber-500/20 text-amber-400 border-amber-500/30 animate-pulse'
                    }`}
                  >
                    {selectedDag.status}
                  </span>
                </div>
              </div>

              {/* Node Sequence Visualizer */}
              <div className="py-8 px-4 flex flex-col md:flex-row items-center justify-center gap-4 overflow-x-auto">
                {selectedDag.nodes?.map((node, index) => {
                  const nodeColor = getNodeColor(node.status);
                  const isLast = index === (selectedDag.nodes?.length || 0) - 1;

                  return (
                    <React.Fragment key={node.id}>
                      {/* Step Card */}
                      <div
                        className={`w-64 p-4 rounded-2xl border transition shadow-lg ${nodeColor}`}
                      >
                        <div className="flex items-start justify-between">
                          <span className="text-[10px] font-mono uppercase font-bold tracking-wider opacity-70">
                            {node.dag_step_name || `Step #${index + 1}`}
                          </span>
                          <span className="px-2 py-0.5 rounded text-[10px] uppercase font-bold bg-slate-900/60 font-mono">
                            {node.status}
                          </span>
                        </div>

                        <div className="mt-2 font-bold text-sm text-white line-clamp-1">{node.name}</div>

                        <div className="mt-3 text-[11px] space-y-1 font-mono opacity-80">
                          <div className="flex justify-between">
                            <span>Priority:</span>
                            <span className="text-blue-300 font-bold">P{node.priority}</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Attempts:</span>
                            <span>{node.attempt_count} / {node.max_retries}</span>
                          </div>
                          {node.worker_name && (
                            <div className="flex justify-between">
                              <span>Worker:</span>
                              <span className="text-purple-300">{node.worker_name}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Edge Connector */}
                      {!isLast && (
                        <div className="flex items-center text-slate-600 font-mono">
                          <ArrowRight className="w-6 h-6 text-blue-500/70 animate-pulse hidden md:block" />
                          <div className="w-0.5 h-6 bg-blue-500/70 md:hidden" />
                        </div>
                      )}
                    </React.Fragment>
                  );
                })}
              </div>

              {/* DAG Execution Rules */}
              <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-400 space-y-1">
                <div className="font-semibold text-slate-300 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-blue-400" /> Topological Execution Rules:
                </div>
                <p>1. Root nodes (with zero unsatisfied parents) are automatically enqueued into worker queues.</p>
                <p>2. Downstream dependent steps remain in <span className="text-purple-400 font-mono font-semibold">scheduled</span> state until all parent tasks emit a <span className="text-emerald-400 font-mono font-semibold">completed</span> status event.</p>
                <p>3. If any parent fails permanently, dependent child tasks are automatically cancelled with cascade safety.</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
