import React, { useState } from 'react';
import {
  Sparkles,
  Zap,
  ShieldAlert,
  GitMerge,
  Cpu,
  X,
  Play,
  CheckCircle2,
  AlertTriangle,
  RefreshCw
} from 'lucide-react';
import { api } from '../services/api.js';

interface DemoLabModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onNavigate: (tab: string) => void;
}

export const DemoLabModal: React.FC<DemoLabModalProps> = ({
  isOpen,
  onClose,
  onRefresh,
  onNavigate
}) => {
  const [loadingScenario, setLoadingScenario] = useState<string | null>(null);
  const [resultMsg, setResultMsg] = useState<{ title: string; desc: string; type: 'success' | 'info' } | null>(null);

  if (!isOpen) return null;

  // Scenario 1: Concurrency Stress Test
  const runStressTest = async (count = 30) => {
    setLoadingScenario('stress');
    setResultMsg(null);
    try {
      const res = await api.triggerStressTest(count);
      setResultMsg({
        title: `⚡ ${res.count} Concurrent Jobs Spawned!`,
        desc: `Batch ID: ${res.batch_id}. All distributed workers are claiming tasks atomically in priority order.`,
        type: 'success'
      });
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoadingScenario(null);
    }
  };

  // Scenario 2: Simulated Failure & AI DLQ
  const runFailureSimulation = async (type = 'RATE_LIMIT') => {
    setLoadingScenario(`fail_${type}`);
    setResultMsg(null);
    try {
      const res = await api.triggerSimulatedFailure(type);
      setResultMsg({
        title: '⚠️ Failure & Retry Simulation Triggered',
        desc: `Job '${res.data.name}' will retry with Exponential Backoff. On max attempts, it will route to DLQ with AI diagnostics.`,
        type: 'info'
      });
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoadingScenario(null);
    }
  };

  // Scenario 3: DAG Pipeline
  const runDAGPipeline = async () => {
    setLoadingScenario('dag');
    setResultMsg(null);
    try {
      const res = await api.triggerDAGPipeline();
      setResultMsg({
        title: '🔀 4-Stage ETL Pipeline Triggered',
        desc: `Workflow '${res.data.name}' is executing. Stage 1 is running, Stages 2A & 2B will run in parallel next.`,
        type: 'success'
      });
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoadingScenario(null);
    }
  };

  // Scenario 4: Zombie Worker Recovery
  const runZombieSimulation = async () => {
    setLoadingScenario('zombie');
    setResultMsg(null);
    try {
      const res = await api.triggerZombieRecovery();
      setResultMsg({
        title: '🧟 Zombie Worker Detected & Lease Recovered',
        desc: `Detected ${res.deadWorkersDetected} dead worker node(s) and auto-reclaimed ${res.recoveredJobs} orphaned job(s) back into queued status!`,
        type: 'success'
      });
      onRefresh();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLoadingScenario(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
      <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-3xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-gradient-to-r from-blue-950/40 to-indigo-950/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">Interactive Scenario & Stress Lab</h2>
              <p className="text-xs text-slate-400">One-click live triggers to test system concurrency, resilience, DAGs, and AI recovery.</p>
            </div>
          </div>

          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Result Message Box */}
        {resultMsg && (
          <div className="p-4 mx-6 mt-6 rounded-2xl bg-blue-950/60 border border-blue-500/40 text-xs flex items-start gap-3 shadow-lg">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-bold text-white text-sm block">{resultMsg.title}</span>
              <p className="text-blue-200 mt-0.5">{resultMsg.desc}</p>
            </div>
          </div>
        )}

        {/* Scenarios Grid */}
        <div className="p-6 overflow-y-auto space-y-4">
          {/* SCENARIO 1 */}
          <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/90 hover:border-blue-500/40 transition space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold font-mono">
                  01
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">High-Concurrency Batch Stress Test (30x Jobs)</h3>
                  <p className="text-xs text-slate-400">
                    Spawns 30 concurrent jobs with randomized priorities (P1-P10) across all queues to test atomic claiming.
                  </p>
                </div>
              </div>

              <button
                onClick={() => runStressTest(30)}
                disabled={loadingScenario === 'stress'}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition shadow-md flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> {loadingScenario === 'stress' ? 'Launching...' : 'Run 30x Batch'}
              </button>
            </div>
          </div>

          {/* SCENARIO 2 */}
          <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/90 hover:border-amber-500/40 transition space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center font-bold font-mono">
                  02
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Simulate Rate Limit (HTTP 429) & AI DLQ Routing</h3>
                  <p className="text-xs text-slate-400">
                    Triggers a task that fails with HTTP 429, attempts exponential retries with jitter, and routes to DLQ for AI analysis.
                  </p>
                </div>
              </div>

              <button
                onClick={() => runFailureSimulation('RATE_LIMIT')}
                disabled={loadingScenario === 'fail_RATE_LIMIT'}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition shadow-md flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> {loadingScenario === 'fail_RATE_LIMIT' ? 'Running...' : 'Simulate 429'}
              </button>
            </div>
          </div>

          {/* SCENARIO 3 */}
          <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/90 hover:border-purple-500/40 transition space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-bold font-mono">
                  03
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Trigger 4-Stage ETL DAG Pipeline</h3>
                  <p className="text-xs text-slate-400">
                    Launches Extract &rarr; (Cleanse + Validate in parallel) &rarr; Warehouse Load pipeline with dependency graph.
                  </p>
                </div>
              </div>

              <button
                onClick={runDAGPipeline}
                disabled={loadingScenario === 'dag'}
                className="px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-semibold text-xs transition shadow-md flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> {loadingScenario === 'dag' ? 'Launching...' : 'Run DAG Pipeline'}
              </button>
            </div>
          </div>

          {/* SCENARIO 4 */}
          <div className="p-5 rounded-2xl bg-slate-950/60 border border-slate-800/90 hover:border-emerald-500/40 transition space-y-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-bold font-mono">
                  04
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Zombie Worker Crash & Automated Lease Recovery</h3>
                  <p className="text-xs text-slate-400">
                    Spawns a mock dead worker with a hung job lease, and invokes the recovery daemon to auto-reclaim the job.
                  </p>
                </div>
              </div>

              <button
                onClick={runZombieSimulation}
                disabled={loadingScenario === 'zombie'}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition shadow-md flex items-center gap-1.5"
              >
                <Play className="w-3.5 h-3.5" /> {loadingScenario === 'zombie' ? 'Testing...' : 'Test Lease Recovery'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs text-slate-400">Switch tabs anytime to watch live executions update across the cluster.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-medium text-xs transition"
          >
            Close Lab
          </button>
        </div>
      </div>
    </div>
  );
};
