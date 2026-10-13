// server/services/aiJudge/evaluationAuditService.ts
import crypto from 'node:crypto';
import { db } from '../../db';
import { Evaluation } from '../../types';

export class EvaluationAuditService {
  /**
   * Archives an existing evaluation into evaluation_history before an update or re-evaluation occurs.
   */
  async archiveEvaluation(evaluation: Evaluation, reason = 're_evaluated'): Promise<void> {
    const historyId = `ehist_${crypto.randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    try {
      await db.execute(`
        INSERT INTO evaluation_history (
          id, evaluation_id, submission_id, version, provider, model,
          overall_score, scores_json, rationale, total_tokens, estimated_cost_usd,
          created_at, archived_at, archive_reason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO NOTHING
      `, [
        historyId,
        evaluation.id,
        evaluation.submissionId,
        evaluation.evaluationVersion,
        evaluation.provider || 'mock',
        evaluation.model || 'mock',
        evaluation.overallScore,
        JSON.stringify(evaluation.scores || {}),
        evaluation.aiRationale || '',
        evaluation.totalTokens || 0,
        evaluation.estimatedCostUsd || 0.0,
        evaluation.createdAt,
        nowIso,
        reason
      ]);
    } catch (err: any) {
      console.warn('[AuditService] Failed to archive evaluation history:', err.message);
    }
  }

  /**
   * Retrieves full audit history for a submission.
   */
  async getHistoryForSubmission(submissionId: string): Promise<any[]> {
    const rows = await db.query(`
      SELECT * FROM evaluation_history
      WHERE submission_id = ?
      ORDER BY archived_at DESC
    `, [submissionId]);

    return rows.map((r) => ({
      id: r.id,
      evaluationId: r.evaluation_id,
      submissionId: r.submission_id,
      version: r.version,
      provider: r.provider,
      model: r.model,
      overallScore: r.overall_score,
      scores: r.scores_json ? JSON.parse(r.scores_json) : null,
      rationale: r.rationale,
      totalTokens: r.total_tokens,
      estimatedCostUsd: r.estimated_cost_usd,
      createdAt: r.created_at,
      archivedAt: r.archived_at,
      archiveReason: r.archive_reason,
    }));
  }

  /**
   * Applies an organizer human review override, preserving the original AI scores.
   */
  async applyHumanOverride(
    evaluationId: string,
    reviewerId: string,
    overrideScore: number,
    overrideReason: string
  ): Promise<void> {
    const nowIso = new Date().toISOString();

    await db.execute(`
      UPDATE evaluations
      SET human_reviewer_id = ?,
          human_override_score = ?,
          human_override_reason = ?,
          human_reviewed_at = ?,
          needs_human_review = 0
      WHERE id = ?
    `, [reviewerId, overrideScore, overrideReason, nowIso, evaluationId]);
  }
}

export const activeEvaluationAuditService = new EvaluationAuditService();
