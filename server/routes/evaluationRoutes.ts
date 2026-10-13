// server/routes/evaluationRoutes.ts
import { Router, Request, Response } from 'express';
import { activeAuthService } from '../services/authService';
import { activeEvaluationService } from '../services/evaluationService';
import { db } from '../db';

export const evaluationRouter = Router();

/**
 * Middleware: Verify authorized server-side access.
 * Checks for a valid participant or organizer session token.
 */
async function requireAuth(req: Request, res: Response, next: () => void) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required' });
  }

  const user = await activeAuthService.getUserByToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: Invalid or expired authentication token' });
  }

  (req as any).user = user;
  next();
}

/**
 * POST /api/evaluations
 * Future AI Evaluation Endpoint Contract
 *
 * Request Body:
 * {
 *   "submissionId": "sub_xyz"
 * }
 *
 * NOTE: Any client-supplied scores will be strictly ignored to prevent client tampering.
 * Authoritative scores are calculated server-side by the EvaluationService.
 */
evaluationRouter.post('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const { submissionId, score, overallScore, scores } = req.body;

    // Security check: Warn / discard client-supplied scores
    if (score !== undefined || overallScore !== undefined || scores !== undefined) {
      console.warn(`[Security Notice] Client attempted to supply score values for submission '${submissionId}'. Client-supplied scores are discarded.`);
    }

    // 1. Validate input
    if (!submissionId || typeof submissionId !== 'string' || !submissionId.trim()) {
      return res.status(400).json({
        error: 'Bad Request: "submissionId" is required and must be a non-empty string'
      });
    }

    const cleanSubmissionId = submissionId.trim();

    // 2. Verify submission exists in database
    const submission = await db.queryOne('SELECT * FROM submissions WHERE id = ?', [cleanSubmissionId]);
    if (!submission) {
      return res.status(404).json({
        error: `Not Found: Submission with ID '${cleanSubmissionId}' does not exist`
      });
    }

    // 3. Authorization check: participant can only trigger their own submission, organizers can trigger any
    const currentUser = (req as any).user;
    if (currentUser.role !== 'organizer' && submission.user_id !== currentUser.id) {
      return res.status(403).json({
        error: 'Forbidden: You do not have permission to evaluate this submission'
      });
    }

    // 4. Verify eligibility (e.g. not rejected)
    if (submission.review_status === 'rejected') {
      return res.status(409).json({
        error: 'Conflict: Submission is rejected and not eligible for evaluation'
      });
    }

    // 5. Invoke EvaluationService (Idempotent: returns existing evaluation or creates new placeholder)
    const evaluation = await activeEvaluationService.evaluateSubmission(cleanSubmissionId);

    // 6. Return standard evaluation response
    return res.status(200).json({
      success: true,
      evaluationId: evaluation.id,
      submissionId: evaluation.submissionId,
      status: evaluation.evaluationStatus,
      evaluationVersion: evaluation.evaluationVersion,
      overallScore: evaluation.overallScore,
      scores: evaluation.scores,
      isMock: evaluation.isMock,
      modeNotice: evaluation.isMock ? 'Mock scoring — AI judge not enabled' : 'AI Judge Evaluation Active',
      tokenUsage: {
        inputTokens: evaluation.inputTokens,
        outputTokens: evaluation.outputTokens,
        totalTokens: evaluation.totalTokens,
        costUsd: evaluation.estimatedCostUsd,
      },
      createdAt: evaluation.createdAt
    });
  } catch (error: any) {
    console.error('Evaluation route error:', error);
    return res.status(500).json({
      error: error.message || 'Internal Server Error during evaluation'
    });
  }
});

/**
 * GET /api/evaluations/:submissionId
 * Retrieve the current evaluation record for a submission
 */
evaluationRouter.get('/:submissionId', async (req: Request, res: Response) => {
  try {
    const submissionId = req.params.submissionId as string;
    const evaluation = await activeEvaluationService.getEvaluation(submissionId);

    if (!evaluation) {
      return res.status(404).json({ error: `No evaluation found for submission '${submissionId}'` });
    }

    return res.status(200).json({ evaluation });
  } catch (error: any) {
    console.error('Fetch evaluation error:', error);
    return res.status(500).json({ error: 'Failed to retrieve evaluation' });
  }
});
