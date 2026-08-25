import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar.js';
import { Overview } from './components/Overview.js';
import { QueuesView } from './components/QueuesView.js';
import { JobExplorer } from './components/JobExplorer.js';
import { WorkersView } from './components/WorkersView.js';
import { WorkflowDAGView } from './components/WorkflowDAGView.js';
import { DLQView } from './components/DLQView.js';
import { CronView } from './components/CronView.js';
import { LocksRateLimitsView } from './components/LocksRateLimitsView.js';
import { DemoLabModal } from './components/DemoLabModal.js';
import { api } from './services/api.js';
import { wsClient } from './services/websocket.js';
import { Queue, Worker, SystemAnalytics, RetryPolicy } from './types/index.js';

export function App() {
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);
  const [isDemoOpen, setIsDemoOpen] = useState<boolean>(false);

  // Core Data
  const [queues, setQueues] = useState<Queue[]>([]);
  const [policies, setPolicies] = useState<RetryPolicy[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [analytics, setAnalytics] = useState<SystemAnalytics | null>(null);

  const fetchCoreData = async () => {
    try {
      const [qList, pList, wList, aData] = await Promise.all([
        api.listQueues(),
        api.listRetryPolicies(),
        api.listWorkers(),
        api.getAnalytics()
      ]);
      setQueues(qList);
      setPolicies(pList);
      setWorkers(wList);
      setAnalytics(aData);
    } catch (e) {
      console.error('Error fetching core dashboard data:', e);
    }
  };

  useEffect(() => {
    fetchCoreData();

    // WS Connection status listener
    const unbindStatus = wsClient.onStatusChange((connected) => {
      setIsWsConnected(connected);
    });

    // Real-time Event Subscriptions
    const unbindJobStatus = wsClient.on('job:status_changed', () => {
      fetchCoreData();
    });

    const unbindJobCreated = wsClient.on('job:created', () => {
      fetchCoreData();
    });

    const unbindHeartbeat = wsClient.on('worker:heartbeat', (data) => {
      setWorkers((prev) =>
        prev.map((w) =>
          w.id === data.payload.workerId
            ? {
                ...w,
                active_jobs_count: data.payload.activeJobs,
                status: data.payload.status,
                last_heartbeat_at: data.payload.timestamp
              }
            : w
        )
      );
    });

    const unbindQueue = wsClient.on('queue:updated', () => {
      fetchCoreData();
    });

    // Periodic poll fallback every 5s
    const interval = setInterval(fetchCoreData, 5000);

    return () => {
      unbindStatus();
      unbindJobStatus();
      unbindJobCreated();
      unbindHeartbeat();
      unbindQueue();
      clearInterval(interval);
    };
  }, []);

  const handleToggleQueue = async (queueId: string, isPaused: boolean) => {
    try {
      if (isPaused) {
        await api.pauseQueue(queueId);
      } else {
        await api.resumeQueue(queueId);
      }
      fetchCoreData();
    } catch (e: any) {
      alert(e.message);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-blue-600 selection:text-white">
      {/* Navigation Header */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isWsConnected={isWsConnected}
        onOpenDemoLab={() => setIsDemoOpen(true)}
        onRefresh={fetchCoreData}
      />

      {/* Main View Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'overview' && (
          <Overview
            analytics={analytics}
            queues={queues}
            onToggleQueue={handleToggleQueue}
            onNavigate={setActiveTab}
            onOpenDemoLab={() => setIsDemoOpen(true)}
          />
        )}

        {activeTab === 'queues' && (
          <QueuesView
            queues={queues}
            policies={policies}
            onRefresh={fetchCoreData}
            onToggleQueue={handleToggleQueue}
          />
        )}

        {activeTab === 'jobs' && (
          <JobExplorer queues={queues} onRefresh={fetchCoreData} />
        )}

        {activeTab === 'workers' && (
          <WorkersView workers={workers} onRefresh={fetchCoreData} />
        )}

        {activeTab === 'workflows' && (
          <WorkflowDAGView onRefresh={fetchCoreData} />
        )}

        {activeTab === 'dlq' && (
          <DLQView queues={queues} onRefresh={fetchCoreData} />
        )}

        {activeTab === 'cron' && (
          <CronView queues={queues} onRefresh={fetchCoreData} />
        )}

        {activeTab === 'locks' && <LocksRateLimitsView />}
      </main>

      {/* Demo / Stress Lab Modal */}
      <DemoLabModal
        isOpen={isDemoOpen}
        onClose={() => setIsDemoOpen(false)}
        onRefresh={fetchCoreData}
        onNavigate={(tab) => {
          setIsDemoOpen(false);
          setActiveTab(tab);
        }}
      />

      {/* Footer */}
      <footer className="mt-auto border-t border-slate-800/80 bg-slate-950/60 py-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 font-mono gap-2">
          <div>Codity Distributed Job Scheduler Platform • Enterprise Engine</div>
          <div className="flex items-center gap-4">
            <span>WAL Mode Relational DB</span>
            <span>•</span>
            <span>Atomic Claiming</span>
            <span>•</span>
            <span>DAG Orchestration</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;
