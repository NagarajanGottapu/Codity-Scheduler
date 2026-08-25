import React from 'react';
import {
  Activity,
  Layers,
  ListOrdered,
  Cpu,
  GitMerge,
  AlertTriangle,
  Clock,
  Lock,
  Sparkles,
  RefreshCw
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  setActiveTab: (tab: string) => void;
  isWsConnected: boolean;
  onOpenDemoLab: () => void;
  onRefresh: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  isWsConnected,
  onOpenDemoLab,
  onRefresh
}) => {
  const tabs = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { id: 'queues', label: 'Queues', icon: Layers },
    { id: 'jobs', label: 'Job Explorer', icon: ListOrdered },
    { id: 'workers', label: 'Workers Cluster', icon: Cpu },
    { id: 'workflows', label: 'Workflow DAGs', icon: GitMerge },
    { id: 'dlq', label: 'Dead Letter Queue', icon: AlertTriangle },
    { id: 'cron', label: 'Recurring / Cron', icon: Clock },
    { id: 'locks', label: 'Locks & Rate Limits', icon: Lock }
  ];

  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Branding */}
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2.5">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center shadow-lg shadow-blue-500/25">
                <Activity className="w-5 h-5 text-white animate-pulse" />
              </div>
              <div>
                <span className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                  Codity <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">Scheduler 2.0</span>
                </span>
                <p className="text-[10px] text-slate-400 font-mono tracking-wider uppercase">Distributed Engine</p>
              </div>
            </div>

            {/* Live WS Status */}
            <div className="hidden sm:flex items-center space-x-2 pl-4 border-l border-slate-800">
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  isWsConnected ? 'bg-emerald-500 animate-ping' : 'bg-amber-500'
                }`}
              />
              <span
                className={`text-xs font-medium ${
                  isWsConnected ? 'text-emerald-400' : 'text-amber-400'
                }`}
              >
                {isWsConnected ? 'Live Stream Active' : 'Connecting...'}
              </span>
            </div>
          </div>

          {/* Right Action buttons */}
          <div className="flex items-center space-x-3">
            <button
              onClick={onRefresh}
              title="Refresh Data"
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition border border-slate-700/60"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <button
              onClick={onOpenDemoLab}
              className="flex items-center space-x-2 px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/40 text-amber-300 hover:text-white hover:bg-amber-500/30 transition shadow-sm font-medium text-xs sm:text-sm group"
            >
              <Sparkles className="w-4 h-4 text-amber-400 group-hover:rotate-12 transition-transform" />
              <span>⚡ Demo & Stress Lab</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex space-x-1 overflow-x-auto scrollbar-none py-1 border-t border-slate-800/60">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center space-x-2 px-3.5 py-2 rounded-lg text-xs sm:text-sm font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-blue-400' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
