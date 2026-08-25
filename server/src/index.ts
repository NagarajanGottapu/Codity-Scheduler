import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { seedDatabase } from './db/seed.js';
import { wsHub } from './ws/websocket.hub.js';
import { workerManager } from './services/worker.manager.js';
import { CronSchedulerService } from './services/cron.scheduler.js';
import { LeaseRecoveryService } from './services/lease.recovery.js';

// Route imports
import authRoutes from './routes/auth.routes.js';
import projectRoutes from './routes/project.routes.js';
import queueRoutes from './routes/queue.routes.js';
import jobRoutes from './routes/job.routes.js';
import workerRoutes from './routes/worker.routes.js';
import cronRoutes from './routes/cron.routes.js';
import dlqRoutes from './routes/dlq.routes.js';
import workflowRoutes from './routes/workflow.routes.js';
import lockRoutes from './routes/locks.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import demoRoutes from './routes/demo.routes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req: Request, _res: Response, next: NextFunction) => {
  const start = Date.now();
  next();
  const duration = Date.now() - start;
  if (!req.path.startsWith('/api/analytics') && !req.path.startsWith('/api/workers/stats')) {
    // Only log mutating / interesting routes
    // console.log(`[API] ${req.method} ${req.path} -> ${res.statusCode} (${duration}ms)`);
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/queues', queueRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/workers', workerRoutes);
app.use('/api/cron', cronRoutes);
app.use('/api/dlq', dlqRoutes);
app.use('/api/workflows', workflowRoutes);
app.use('/api/locks', lockRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/demo', demoRoutes);

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'codity-distributed-scheduler',
    version: '1.0.0'
  });
});

// Serve static client bundle if built
const clientDistPath = path.resolve(process.cwd(), '../client/dist');
const altClientDistPath = path.resolve(process.cwd(), 'client/dist');

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
} else if (fs.existsSync(altClientDistPath)) {
  app.use(express.static(altClientDistPath));
  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/health')) {
      return next();
    }
    res.sendFile(path.join(altClientDistPath, 'index.html'));
  });
}

// Error handling middleware
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal server error'
  });
});

// Create HTTP server
const server = http.createServer(app);

// Initialize WebSocket Hub
wsHub.initialize(server);

// Start server
server.listen(Number(PORT) || 4000, '0.0.0.0', async () => {
  console.log(`
  🚀 CODITY DISTRIBUTED JOB SCHEDULER ENGINE
  ===========================================
  📡 REST API:       http://0.0.0.0:${PORT}
  ⚡ WebSocket:      ws://0.0.0.0:${PORT}/ws
  📊 Health Check:   http://0.0.0.0:${PORT}/health
  ===========================================
  `);

  try {
    // 1. Seed database
    seedDatabase();

    // 2. Initialize Worker Cluster (3 default workers)
    console.log('⚙️  Initializing Distributed Worker Cluster (3 nodes)...');
    await workerManager.initializeCluster(3);

    // 3. Start Background Daemons
    console.log('⏰ Starting Cron Scheduler & Lease Recovery Daemons...');
    CronSchedulerService.start(2000);
    LeaseRecoveryService.start(3000);

    console.log('✅ System ready for distributed job orchestration!');
  } catch (error) {
    console.error('Fatal initialization error:', error);
  }
});

// Graceful Shutdown
const handleShutdown = async (signal: string) => {
  console.log(`\n🛑 Received ${signal}. Draining workers and shutting down gracefully...`);
  CronSchedulerService.stop();
  LeaseRecoveryService.stop();
  await workerManager.shutdownAll();

  server.close(() => {
    console.log('👋 Server terminated cleanly.');
    process.exit(0);
  });
};

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

export { app, server };
