import express from 'express';
import cors from 'cors';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb, checkDbHealthAsync, db } from './db';
import { authRouter } from './routes/authRoutes';
import { submissionRouter } from './routes/submissionRoutes';
import { evaluationRouter } from './routes/evaluationRoutes';
import { leaderboardRouter } from './routes/leaderboardRoutes';
import { adminRouter } from './routes/adminRoutes';
import { timerRouter } from './routes/timerRoutes';
import { activeTimerService } from './services/timerService';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// 1. Request ID and Structured Logging Middleware
app.use((req, res, next) => {
  const reqId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  (req as any).id = reqId;
  res.setHeader('X-Request-Id', reqId);

  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.originalUrl !== '/api/health' && req.originalUrl !== '/health') {
      console.log(`[Req:${reqId}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// 2. CORS configuration for Render backend & Vercel frontend
const rawOrigins = [process.env.CLIENT_ORIGIN, process.env.FRONTEND_URL]
  .filter(Boolean)
  .flatMap((url) => (url as string).split(','))
  .map((url) => url.trim().replace(/\/+$/, ''));

const allowedOrigins = rawOrigins.length > 0
  ? rawOrigins
  : ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g. mobile apps, curl, server-to-server health probes)
      if (!origin) return callback(null, true);
      if (process.env.NODE_ENV !== 'production') return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`CORS policy violation: Origin '${origin}' is not authorized.`));
    },
    credentials: true,
  })
);

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve static assets from public/ folder
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount API routes
app.use('/api/auth', authRouter);
app.use('/api/submissions', submissionRouter);
app.use('/api/evaluations', evaluationRouter);
app.use('/api/leaderboard', leaderboardRouter);
app.use('/api/admin', adminRouter);
app.use('/api/timer', timerRouter);

// Health check endpoint for Render / monitoring (available at /health and /api/health)
const handleHealth = async (_req: express.Request, res: express.Response) => {
  try {
    const timer = await activeTimerService.getTimerState();
    const dbHealth = await checkDbHealthAsync();
    res.json({
      status: dbHealth.status === 'connected' ? 'ok' : 'degraded',
      mode: 'CCG × OpenAI Case Competition',
      aiJudgeEnabled: process.env.AI_JUDGE_ENABLED === 'true',
      timerStatus: timer.status,
      remainingSeconds: timer.remainingSeconds,
      database: dbHealth,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    res.status(500).json({ status: 'error', error: err.message });
  }
};

app.get('/health', handleHealth);
app.get('/api/health', handleHealth);

// Safe global error handler with request ID
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const reqId = (req as any).id || 'unknown';
  console.error(`[Req:${reqId}] Error on ${req.method} ${req.originalUrl}:`, err);

  const statusCode = Number(err.status || err.statusCode || 500);
  const safeMessage = process.env.NODE_ENV === 'production' && statusCode === 500
    ? 'An internal error occurred. Please contact event organizers with the Request ID.'
    : err.message || 'Internal Server Error';

  res.status(statusCode).json({
    error: safeMessage,
    requestId: reqId,
  });
});

let server: any = null;

async function startServer() {
  // Initialize DB schema, tables & seeds
  await initDb();

  server = app.listen(PORT, () => {
    console.log(`🚀 CCG Case Evaluation API Server listening on port ${PORT}`);
    console.log(`ℹ️ Mode: Webmail OTP Auth & Placeholder Score-50 Evaluation (Database: ${db.isPostgres ? 'PostgreSQL' : 'SQLite'})`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`${signal} received, closing HTTP server and database pool gracefully...`);
    if (server) {
      server.close(async () => {
        try {
          await db.close();
          console.log('Database connections closed cleanly.');
        } catch (closeErr) {
          console.error('Error closing database connections:', closeErr);
        }
        process.exit(0);
      });
    } else {
      process.exit(0);
    }
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

export { app, server };
