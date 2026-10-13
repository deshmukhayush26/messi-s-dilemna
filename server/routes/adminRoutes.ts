// server/routes/adminRoutes.ts
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { activeAuthService } from '../services/authService';
import { activeEvaluationService } from '../services/evaluationService';
import { activeTimerService } from '../services/timerService';
import { activeStorageService } from '../services/storageService';

export const adminRouter = Router();

// Middleware: Require Organizer Role
async function requireOrganizer(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  let token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';

  if (!token && req.headers.cookie) {
    const match = req.headers.cookie.match(/ccg_session=([^;]+)/);
    if (match) token = match[1];
  }

  if (!token) {
    return res.status(401).json({ error: 'Organizer authentication required' });
  }

  const user = await activeAuthService.getUserByToken(token);
  if (!user || user.role !== 'organizer') {
    return res.status(403).json({ error: 'Access denied: Organizer role required' });
  }

  (req as any).user = user;
  next();
}

// GET /api/admin/submissions - List all submissions with evaluations and slide metadata
adminRouter.get('/submissions', requireOrganizer, async (_req: Request, res: Response) => {
  try {
    const rows = await db.query(`
      SELECT 
        s.*,
        u.name as user_name,
        u.roll_number as user_roll_number
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      ORDER BY s.created_at DESC
    `);

    const submissions = await Promise.all(
      rows.map(async (row) => {
        const evaluation = await activeEvaluationService.getEvaluation(row.id);
        const secureDownloadUrl = activeStorageService.getSecureDownloadUrl(row.id);

        return {
          id: row.id,
          userId: row.user_id,
          userName: row.user_name,
          userRollNumber: row.user_roll_number,
          teamName: row.team_name,
          submissionName: row.submission_name,
          deckFileName: row.deck_file_name,
          deckFileUrl: secureDownloadUrl,
          slideCount: row.slide_count,
          fileSize: row.file_size,
          submissionDurationSec: row.submission_duration_sec,
          notes: row.notes,
          reviewStatus: row.review_status,
          isPublished: Boolean(row.is_published),
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          evaluation,
        };
      })
    );

    return res.status(200).json({ submissions });
  } catch (error: any) {
    console.error('Fetch admin submissions error:', error);
    return res.status(500).json({ error: 'Failed to fetch admin submissions' });
  }
});

// PATCH /api/admin/submissions/:id/review - Accept, Reject, or Hold submission
adminRouter.patch('/submissions/:id/review', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { status } = req.body;

    const validStatuses = ['pending', 'accepted', 'rejected', 'on_hold'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }

    const sub = await db.queryOne('SELECT * FROM submissions WHERE id = ?', [id]);
    if (!sub) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const nowIso = new Date().toISOString();
    await db.execute(`
      UPDATE submissions SET review_status = ?, updated_at = ? WHERE id = ?
    `, [status, nowIso, id]);

    return res.status(200).json({
      success: true,
      submissionId: id,
      reviewStatus: status,
      updatedAt: nowIso,
    });
  } catch (error: any) {
    console.error('Update review status error:', error);
    return res.status(500).json({ error: 'Failed to update review status' });
  }
});

// PATCH /api/admin/submissions/:id/publish - Toggle publish to public leaderboard
adminRouter.patch('/submissions/:id/publish', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { isPublished } = req.body;

    if (typeof isPublished !== 'boolean') {
      return res.status(400).json({ error: 'Field isPublished must be boolean' });
    }

    const sub = await db.queryOne('SELECT * FROM submissions WHERE id = ?', [id]);
    if (!sub) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const nowIso = new Date().toISOString();
    await db.execute(`
      UPDATE submissions SET is_published = ?, updated_at = ? WHERE id = ?
    `, [isPublished ? 1 : 0, nowIso, id]);

    return res.status(200).json({
      success: true,
      submissionId: id,
      isPublished,
      updatedAt: nowIso,
    });
  } catch (error: any) {
    console.error('Update publish state error:', error);
    return res.status(500).json({ error: 'Failed to update publish state' });
  }
});

// GET /api/admin/token-stats - Token usage metrics and budget status
adminRouter.get('/token-stats', requireOrganizer, async (_req: Request, res: Response) => {
  try {
    const stats = await activeEvaluationService.getTokenUsageStats();
    return res.status(200).json({
      ...stats,
      modeNotice: stats.isAiJudgeEnabled ? 'Production AI Judge Enabled' : 'Mock scoring — AI judge not enabled',
      tokenAccountingDisclaimer: stats.isAiJudgeEnabled
        ? 'Live token usage and cost accounting tracked against configured budget.'
        : 'Mock evaluation mode active. No live AI provider requests incurred.',
    });
  } catch (error: any) {
    console.error('Fetch token stats error:', error);
    return res.status(500).json({ error: 'Failed to fetch token statistics' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Event Timer Management Endpoints (Admin Controlled)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/timer/state - Current authoritative timer state
adminRouter.get('/timer/state', requireOrganizer, async (_req: Request, res: Response) => {
  try {
    const timer = await activeTimerService.getTimerState();
    return res.status(200).json(timer);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch timer state' });
  }
});

// POST /api/admin/timer/start - Start or resume timer
adminRouter.post('/timer/start', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const organizer = (req as any).user;
    const { durationMinutes } = req.body;
    const parsedMinutes = durationMinutes ? Number(durationMinutes) : undefined;

    const timer = await activeTimerService.startTimer(parsedMinutes, organizer.name);
    return res.status(200).json({
      success: true,
      timer,
      message: `Event timer started (${Math.round(timer.remainingSeconds / 60)} minutes remaining)`,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to start timer' });
  }
});

// POST /api/admin/timer/stop - Pause / Freeze timer
adminRouter.post('/timer/stop', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const organizer = (req as any).user;
    const timer = await activeTimerService.stopTimer(organizer.name);
    return res.status(200).json({
      success: true,
      timer,
      message: 'Event timer paused.',
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to pause timer' });
  }
});

// POST /api/admin/timer/add-time - Add configurable duration to countdown
adminRouter.post('/timer/add-time', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const organizer = (req as any).user;
    const { minutes } = req.body;

    const parsedMinutes = Number(minutes);
    if (!parsedMinutes || parsedMinutes <= 0) {
      return res.status(400).json({ error: 'A positive duration in minutes must be specified.' });
    }

    const timer = await activeTimerService.addTime(parsedMinutes, organizer.name);
    return res.status(200).json({
      success: true,
      timer,
      message: `Added ${parsedMinutes} minute${parsedMinutes === 1 ? '' : 's'} to event countdown.`,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to add time' });
  }
});

// POST /api/admin/timer/reset - Reset event countdown
adminRouter.post('/timer/reset', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const organizer = (req as any).user;
    const { durationMinutes } = req.body;
    const parsedMinutes = durationMinutes ? Number(durationMinutes) : 60;

    const timer = await activeTimerService.resetTimer(organizer.name, parsedMinutes);
    return res.status(200).json({
      success: true,
      timer,
      message: `Timer reset with initial duration of ${parsedMinutes} minutes.`,
    });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Failed to reset timer' });
  }
});

// GET /api/admin/timer/logs - Action audit history
adminRouter.get('/timer/logs', requireOrganizer, async (_req: Request, res: Response) => {
  try {
    const logs = await activeTimerService.getTimerActionLogs();
    return res.status(200).json({ logs });
  } catch (error: any) {
    console.error('Fetch timer logs error:', error);
    return res.status(500).json({ error: 'Failed to retrieve timer action audit history' });
  }
});

// PATCH /api/admin/config - Update configuration settings
adminRouter.patch('/config', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const { enforceMinSlides, appTokenBudget, leaderboardVisibility } = req.body;

    if (enforceMinSlides !== undefined) {
      await db.execute('UPDATE admin_config SET enforce_min_slides = ? WHERE id = ?', [
        enforceMinSlides ? 1 : 0,
        'global'
      ]);
    }
    if (appTokenBudget !== undefined) {
      await db.execute('UPDATE admin_config SET app_token_budget = ? WHERE id = ?', [
        Number(appTokenBudget),
        'global'
      ]);
    }
    if (leaderboardVisibility !== undefined) {
      await db.execute('UPDATE admin_config SET leaderboard_visibility = ? WHERE id = ?', [
        String(leaderboardVisibility),
        'global'
      ]);
    }

    const updated = await db.queryOne('SELECT * FROM admin_config WHERE id = ?', ['global']);
    return res.status(200).json({ success: true, config: updated });
  } catch (error: any) {
    console.error('Update admin config error:', error);
    return res.status(500).json({ error: 'Failed to update admin configuration' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI Judge Management & Control Endpoints
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/admin/ai-judge/config - Get current AI Judge settings & key presence (keys masked)
adminRouter.get('/ai-judge/config', requireOrganizer, async (_req: Request, res: Response) => {
  try {
    const config = await db.queryOne('SELECT * FROM admin_config WHERE id = ?', ['global']);

    const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'placeholder');
    const hasFeatherlessKey = Boolean(process.env.FEATHERLESS_API_KEY && process.env.FEATHERLESS_API_KEY !== 'placeholder');

    return res.status(200).json({
      isEnabled: process.env.AI_JUDGE_ENABLED === 'true' || Boolean(config?.is_ai_judge_enabled),
      provider: config?.ai_judge_provider || (process.env.AI_PROVIDER as any) || 'openai',
      model: config?.ai_judge_model || process.env.OPENAI_JUDGE_MODEL || process.env.FEATHERLESS_JUDGE_MODEL || 'gpt-4o',
      rubricVersion: config?.ai_judge_rubric_version || 'v1',
      maxConcurrency: config?.ai_judge_max_concurrency || 2,
      maxRetries: config?.ai_judge_max_retries || 3,
      budgetUsd: Number(process.env.AI_JUDGE_BUDGET_USD || config?.ai_judge_budget_usd || 50.0),
      spentUsd: Number(config?.ai_judge_spent_usd || 0.0),
      feedbackReleaseMode: config?.feedback_release_mode || 'immediate',
      hasOpenAiKey,
      hasFeatherlessKey,
      openAiModelConfigured: process.env.OPENAI_JUDGE_MODEL || 'gpt-4o',
      featherlessModelConfigured: process.env.FEATHERLESS_JUDGE_MODEL || 'meta-llama/Llama-3.2-11B-Vision-Instruct',
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch AI judge config' });
  }
});

// PATCH /api/admin/ai-judge/config - Update AI Judge settings
adminRouter.patch('/ai-judge/config', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const {
      isEnabled,
      provider,
      model,
      rubricVersion,
      maxConcurrency,
      maxRetries,
      budgetUsd,
      feedbackReleaseMode,
    } = req.body;

    if (isEnabled !== undefined) {
      await db.execute('UPDATE admin_config SET is_ai_judge_enabled = ? WHERE id = ?', [
        isEnabled ? 1 : 0,
        'global'
      ]);
    }
    if (provider !== undefined) {
      await db.execute('UPDATE admin_config SET ai_judge_provider = ? WHERE id = ?', [
        String(provider),
        'global'
      ]);
    }
    if (model !== undefined) {
      await db.execute('UPDATE admin_config SET ai_judge_model = ? WHERE id = ?', [
        String(model),
        'global'
      ]);
    }
    if (rubricVersion !== undefined) {
      await db.execute('UPDATE admin_config SET ai_judge_rubric_version = ? WHERE id = ?', [
        String(rubricVersion),
        'global'
      ]);
    }
    if (maxConcurrency !== undefined) {
      await db.execute('UPDATE admin_config SET ai_judge_max_concurrency = ? WHERE id = ?', [
        Number(maxConcurrency),
        'global'
      ]);
    }
    if (maxRetries !== undefined) {
      await db.execute('UPDATE admin_config SET ai_judge_max_retries = ? WHERE id = ?', [
        Number(maxRetries),
        'global'
      ]);
    }
    if (budgetUsd !== undefined) {
      await db.execute('UPDATE admin_config SET ai_judge_budget_usd = ? WHERE id = ?', [
        Number(budgetUsd),
        'global'
      ]);
    }
    if (feedbackReleaseMode !== undefined) {
      await db.execute('UPDATE admin_config SET feedback_release_mode = ? WHERE id = ?', [
        String(feedbackReleaseMode),
        'global'
      ]);
    }

    return res.status(200).json({ success: true, message: 'AI Judge configuration updated successfully.' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to update AI judge config' });
  }
});

// POST /api/admin/ai-judge/test-connection - Validate provider configuration safely
adminRouter.post('/ai-judge/test-connection', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const { provider } = req.body;
    const targetProvider = provider === 'featherless' ? 'featherless' : 'openai';

    if (targetProvider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey || apiKey.includes('placeholder') || apiKey === '') {
        return res.status(400).json({
          success: false,
          error: 'OPENAI_API_KEY is not set or contains placeholder text. Real API calls are disabled.',
        });
      }
      return res.status(200).json({
        success: true,
        provider: 'openai',
        model: process.env.OPENAI_JUDGE_MODEL || 'gpt-4o',
        message: 'OpenAI API key configured and validated.',
      });
    } else {
      const apiKey = process.env.FEATHERLESS_API_KEY;
      if (!apiKey || apiKey.includes('placeholder') || apiKey === '') {
        return res.status(400).json({
          success: false,
          error: 'FEATHERLESS_API_KEY is not set or contains placeholder text. Real API calls are disabled.',
        });
      }
      return res.status(200).json({
        success: true,
        provider: 'featherless',
        model: process.env.FEATHERLESS_JUDGE_MODEL || 'meta-llama/Llama-3.2-11B-Vision-Instruct',
        message: 'Featherless AI configuration validated.',
      });
    }
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Connection test failed' });
  }
});

// POST /api/admin/submissions/:id/evaluate - Trigger AI evaluation on demand
adminRouter.post('/submissions/:id/evaluate', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { forceAi, provider, model } = req.body;

    const evaluation = await activeEvaluationService.evaluateSubmission(id, {
      forceAi: forceAi ?? true,
      provider,
      model,
    });

    return res.status(200).json({ success: true, evaluation });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Evaluation failed' });
  }
});

// POST /api/admin/submissions/:id/re-evaluate - Re-evaluate with audit logging
adminRouter.post('/submissions/:id/re-evaluate', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { reason, provider, model } = req.body;

    const evaluation = await activeEvaluationService.reEvaluateSubmission(id, {
      provider,
      model,
      reason: reason || 'Organizer manual re-evaluation',
    });

    return res.status(200).json({ success: true, evaluation });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Re-evaluation failed' });
  }
});

// PATCH /api/admin/submissions/:id/override - Human organizer score override
adminRouter.patch('/submissions/:id/override', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const organizer = (req as any).user;
    const { score, reason } = req.body;

    const numScore = Number(score);
    if (isNaN(numScore) || numScore < 0 || numScore > 100) {
      return res.status(400).json({ error: 'Override score must be a number between 0 and 100.' });
    }
    if (!reason || !reason.trim()) {
      return res.status(400).json({ error: 'A justification reason is required for score overrides.' });
    }

    const updated = await activeEvaluationService.overrideScore(
      id,
      organizer.id || 'usr_organizer_root',
      numScore,
      reason.trim()
    );

    return res.status(200).json({ success: true, evaluation: updated });
  } catch (error: any) {
    return res.status(400).json({ error: error.message || 'Override failed' });
  }
});

// GET /api/admin/submissions/:id/history - Evaluation audit history
adminRouter.get('/submissions/:id/history', requireOrganizer, async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { activeEvaluationAuditService } = await import('../services/aiJudge/evaluationAuditService');
    const history = await activeEvaluationAuditService.getHistoryForSubmission(id);
    return res.status(200).json({ history });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to retrieve history' });
  }
});

// GET /api/admin/ai-judge/queue - Job queue status
adminRouter.get('/ai-judge/queue', requireOrganizer, async (_req: Request, res: Response) => {
  try {
    const { activeEvaluationQueue } = await import('../services/aiJudge/evaluationQueue');
    const jobs = await activeEvaluationQueue.getJobs();
    return res.status(200).json({ jobs });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch queue' });
  }
});

// GET /api/admin/export-dataset - Export anonymized evaluation dataset in JSONL
adminRouter.get('/export-dataset', requireOrganizer, async (_req: Request, res: Response) => {
  try {
    const { activeBenchmarkService } = await import('../services/aiJudge/benchmarkService');
    const jsonl = await activeBenchmarkService.exportAnonymizedDatasetJsonl();

    res.setHeader('Content-Type', 'application/x-ndjson');
    res.setHeader('Content-Disposition', 'attachment; filename="evaluation_dataset_anonymized.jsonl"');
    return res.status(200).send(jsonl);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to export dataset' });
  }
});

// POST /api/admin/benchmark - Run repeatable benchmark comparison
adminRouter.post('/benchmark', requireOrganizer, async (_req: Request, res: Response) => {
  try {
    const { activeBenchmarkService } = await import('../services/aiJudge/benchmarkService');
    const metrics = await activeBenchmarkService.runBenchmarkComparison();
    return res.status(200).json({ success: true, metrics });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Benchmark run failed' });
  }
});
