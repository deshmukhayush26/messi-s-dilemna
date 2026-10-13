// server/routes/leaderboardRoutes.ts
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { LeaderboardEntry } from '../types';

export const leaderboardRouter = Router();

// GET /api/leaderboard - Public leaderboard
// Never exposes private deck file URLs, unpublished entries, mock scores,
// or evaluations that are still pending/failed.
leaderboardRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await db.query(`
      SELECT 
        s.id as submission_id,
        s.team_name,
        s.submission_name,
        s.slide_count,
        s.created_at as submitted_at,
        u.name as user_name,
        u.roll_number,
        e.overall_score,
        e.problem_structuring_score,
        e.analytical_rigor_score,
        e.strategic_insight_score,
        e.feasibility_impact_score,
        e.communication_score,
        e.is_mock
      FROM submissions s
      JOIN users u ON s.user_id = u.id
      JOIN evaluations e ON s.id = e.submission_id
      WHERE s.review_status != 'rejected'
        AND s.is_published = 1
        AND e.is_mock = 0
        AND e.evaluation_status NOT IN ('mock_evaluated', 'pending', 'failed', 'placeholder')
      ORDER BY 
        e.overall_score DESC,           -- 1. Primary score
        s.created_at ASC,               -- 2. Stable tie breaker: earlier submission ranks higher
        s.id ASC                        -- 3. Deterministic fallback tie breaker
    `);

    const entries: LeaderboardEntry[] = rows.map((row, index) => ({
      rank: index + 1,
      submissionId: row.submission_id,
      submissionName: row.submission_name,
      teamName: row.team_name,
      submittedBy: row.user_name,
      rollNumber: row.roll_number,
      totalScore: row.overall_score,
      scores: {
        problemStructuring: row.problem_structuring_score,
        analyticalRigor: row.analytical_rigor_score,
        strategicInsight: row.strategic_insight_score,
        feasibilityImpact: row.feasibility_impact_score,
        communication: row.communication_score,
      },
      slideCount: row.slide_count || 5,
      isMock: Boolean(row.is_mock),
      submittedAt: row.submitted_at,
    }));

    const config = await db.queryOne('SELECT is_ai_judge_enabled FROM admin_config WHERE id = ?', ['global']);
    const isAiJudgeEnabled = process.env.AI_JUDGE_ENABLED === 'true' || Boolean(config?.is_ai_judge_enabled);
    const hasRealEvaluations = rows.some((r) => !r.is_mock);

    return res.status(200).json({
      evaluationMode: hasRealEvaluations
        ? 'Production AI Evaluation Active'
        : 'Results not yet available — AI evaluation has not run',
      isAiJudgeEnabled,
      totalSubmissions: entries.length,
      entries,
    });
  } catch (error: any) {
    console.error('Leaderboard error:', error);
    return res.status(500).json({ error: 'Failed to generate leaderboard' });
  }
});
