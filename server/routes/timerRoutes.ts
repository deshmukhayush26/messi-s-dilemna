// server/routes/timerRoutes.ts
import { Router, Request, Response } from 'express';
import { activeTimerService } from '../services/timerService';

export const timerRouter = Router();

// GET /api/timer - Public authoritative event timer status & countdown
timerRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const timer = await activeTimerService.getTimerState();
    const submissionCheck = await activeTimerService.checkSubmissionAllowed();

    return res.status(200).json({
      status: timer.status,
      remainingSeconds: timer.remainingSeconds,
      initialDurationSec: timer.initialDurationSec,
      startTimestamp: timer.startTimestamp,
      endTimestamp: timer.endTimestamp,
      lastUpdatedAt: timer.lastUpdatedAt,
      serverTimeUtc: new Date().toISOString(),
      submissionsAllowed: submissionCheck.allowed,
      submissionStatusReason: submissionCheck.reason || null,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to retrieve event timer state' });
  }
});
