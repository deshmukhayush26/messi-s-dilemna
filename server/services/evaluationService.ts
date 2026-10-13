// server/services/evaluationService.ts
import { Evaluation, TokenUsageStats } from '../types';
import { db } from '../db';
import crypto from 'node:crypto';
import { activeOpenAIProvider } from './aiJudge/providers/openAIProvider';
import { activeFeatherlessProvider } from './aiJudge/providers/featherlessProvider';
import { activeDeckParser } from './aiJudge/deckParser';
import { activeScoreCalculator } from './aiJudge/scoreCalculator';
import { activeTokenUsageService } from './aiJudge/tokenUsageService';
import { activeEvaluationAuditService } from './aiJudge/evaluationAuditService';
import { activeStorageService } from './storageService';

export interface IEvaluationService {
  isAiJudgeEnabled(): Promise<boolean>;
  evaluateSubmission(
    submissionId: string,
    options?: { forceAi?: boolean; forceMock?: boolean; provider?: 'openai' | 'featherless'; model?: string }
  ): Promise<Evaluation>;
  getEvaluation(submissionId: string): Promise<Evaluation | null>;
  getTokenUsageStats(): Promise<TokenUsageStats>;
  reEvaluateSubmission(
    submissionId: string,
    options?: { provider?: 'openai' | 'featherless'; model?: string; reason?: string }
  ): Promise<Evaluation>;
  overrideScore(
    submissionId: string,
    reviewerId: string,
    overrideScore: number,
    overrideReason: string
  ): Promise<Evaluation>;
}

export class ProductionEvaluationService implements IEvaluationService {
  /**
   * Determines if the Real AI Judge is currently enabled.
   */
  async isAiJudgeEnabled(): Promise<boolean> {
    const config = await db.queryOne('SELECT is_ai_judge_enabled FROM admin_config WHERE id = ?', ['global']);
    const dbEnabled = Boolean(config?.is_ai_judge_enabled);
    const envEnabled = process.env.AI_JUDGE_ENABLED === 'true';
    return envEnabled || dbEnabled;
  }

  /**
   * Evaluates a submission.
   * If AI Judge is disabled (default): Creates an idempotent score-50 placeholder record.
   * If AI Judge is enabled: Validates provider credentials, checks budget, and runs the real AI pipeline.
   */
  async evaluateSubmission(
    submissionId: string,
    options: { forceAi?: boolean; forceMock?: boolean; provider?: 'openai' | 'featherless'; model?: string } = {}
  ): Promise<Evaluation> {
    if (!submissionId) {
      throw new Error('A valid submission ID is required for evaluation.');
    }

    const submission = await db.queryOne('SELECT * FROM submissions WHERE id = ?', [submissionId]);
    if (!submission) {
      throw new Error(`Submission '${submissionId}' not found.`);
    }

    const existingEval = await db.queryOne(`
      SELECT * FROM evaluations WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1
    `, [submissionId]);

    if (existingEval && !options.forceAi && !options.forceMock) {
      return this.mapRowToEvaluation(existingEval);
    }

    const isEnabled = await this.isAiJudgeEnabled();
    const shouldRunAi = (options.forceAi || isEnabled) && !options.forceMock;

    if (!shouldRunAi) {
      return this.evaluateWithMock(submissionId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REAL AI JUDGE PIPELINE (OpenAI / Featherless)
    // ─────────────────────────────────────────────────────────────────────────
    const config = await db.queryOne('SELECT * FROM admin_config WHERE id = ?', ['global']);
    const providerName = options.provider || config?.ai_judge_provider || (process.env.AI_PROVIDER as any) || 'openai';
    const provider = providerName === 'featherless' ? activeFeatherlessProvider : activeOpenAIProvider;

    // 1. Validate Provider Configuration
    const configCheck = provider.validateConfig();
    if (!configCheck.valid) {
      throw new Error(`AI Judge configuration error (${providerName}): ${configCheck.error}`);
    }

    // 2. Budget Check
    const budgetCheck = await activeTokenUsageService.checkBudgetAvailable();
    if (!budgetCheck.allowed) {
      throw new Error(budgetCheck.reason || 'AI Judge budget exhausted.');
    }

    // 3. Retrieve deck file from storage
    const storageKey = submission.storage_key || `decks/${submission.deck_file_name}`;
    const deckBuffer = await activeStorageService.getDeckBuffer(storageKey);
    if (!deckBuffer) {
      throw new Error(`Deck presentation file not found in storage for key '${storageKey}'.`);
    }

    // 4. Parse deck with DeckParser
    const originalFilename = submission.deck_file_name || 'deck.pdf';
    const parsedDeck = await activeDeckParser.parseDeck(deckBuffer, originalFilename);

    // 5. Run AI Judge Provider
    const model = options.model || (providerName === 'featherless' ? process.env.FEATHERLESS_JUDGE_MODEL : process.env.OPENAI_JUDGE_MODEL);
    const evalResponse = await provider.evaluateDeck({
      submissionId,
      teamName: submission.team_name,
      submissionName: submission.submission_name,
      deck: parsedDeck,
      modelOverride: model,
    });

    // 6. Calculate Deterministic Final Score
    const scoreResult = activeScoreCalculator.calculateFinalScore(evalResponse.structuredOutput);
    const costUsd = activeTokenUsageService.calculateCost(evalResponse.model, evalResponse.usage);
    await activeTokenUsageService.recordCost(costUsd);

    // 7. Check for existing evaluation to archive in history
    const priorEval = await db.queryOne('SELECT * FROM evaluations WHERE submission_id = ?', [submissionId]);
    if (priorEval) {
      await activeEvaluationAuditService.archiveEvaluation(this.mapRowToEvaluation(priorEval), 're_evaluation_by_ai');
    }

    const evalVersion = `${evalResponse.provider}-${evalResponse.model}-v1`;
    const evalStatus = evalResponse.structuredOutput.needs_human_review ? 'needs_review' : 'completed';
    const evalId = priorEval?.id || `eval_${crypto.randomUUID().slice(0, 8)}`;
    const completionIso = new Date().toISOString();

    // 8. Persist Evaluation
    await db.execute(`
      INSERT INTO evaluations (
        id, submission_id, evaluation_version, evaluation_status,
        overall_score, problem_structuring_score, analytical_rigor_score,
        strategic_insight_score, feasibility_impact_score, communication_score,
        ai_rationale, strengths, weaknesses, evidence,
        is_mock, provider, model,
        input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
        estimated_cost_usd, provider_request_id, executive_summary, recommendation,
        assumptions_and_risks, actionable_feedback, criterion_scores_json,
        confidence, needs_human_review, review_flags, attempt_number,
        created_at
      )
      VALUES (
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        0, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?,
        ?
      )
      ON CONFLICT (id) DO UPDATE SET
        evaluation_version = EXCLUDED.evaluation_version,
        evaluation_status = EXCLUDED.evaluation_status,
        overall_score = EXCLUDED.overall_score,
        problem_structuring_score = EXCLUDED.problem_structuring_score,
        analytical_rigor_score = EXCLUDED.analytical_rigor_score,
        strategic_insight_score = EXCLUDED.strategic_insight_score,
        feasibility_impact_score = EXCLUDED.feasibility_impact_score,
        communication_score = EXCLUDED.communication_score,
        ai_rationale = EXCLUDED.ai_rationale,
        strengths = EXCLUDED.strengths,
        weaknesses = EXCLUDED.weaknesses,
        evidence = EXCLUDED.evidence,
        is_mock = EXCLUDED.is_mock,
        provider = EXCLUDED.provider,
        model = EXCLUDED.model,
        input_tokens = EXCLUDED.input_tokens,
        output_tokens = EXCLUDED.output_tokens,
        cached_tokens = EXCLUDED.cached_tokens,
        reasoning_tokens = EXCLUDED.reasoning_tokens,
        total_tokens = EXCLUDED.total_tokens,
        estimated_cost_usd = EXCLUDED.estimated_cost_usd,
        provider_request_id = EXCLUDED.provider_request_id,
        executive_summary = EXCLUDED.executive_summary,
        recommendation = EXCLUDED.recommendation,
        assumptions_and_risks = EXCLUDED.assumptions_and_risks,
        actionable_feedback = EXCLUDED.actionable_feedback,
        criterion_scores_json = EXCLUDED.criterion_scores_json,
        confidence = EXCLUDED.confidence,
        needs_human_review = EXCLUDED.needs_human_review,
        review_flags = EXCLUDED.review_flags,
        attempt_number = EXCLUDED.attempt_number,
        created_at = EXCLUDED.created_at
    `, [
      evalId,
      submissionId,
      evalVersion,
      evalStatus,
      scoreResult.overallScore,
      scoreResult.categoryScores.problemStructuring,
      scoreResult.categoryScores.analyticalRigor,
      scoreResult.categoryScores.strategicInsight,
      scoreResult.categoryScores.feasibilityImpact,
      scoreResult.categoryScores.communication,
      evalResponse.structuredOutput.executive_summary,
      JSON.stringify(evalResponse.structuredOutput.strengths),
      JSON.stringify(evalResponse.structuredOutput.weaknesses),
      JSON.stringify(evalResponse.structuredOutput.evidence),
      evalResponse.provider,
      evalResponse.model,
      evalResponse.usage.promptTokens,
      evalResponse.usage.completionTokens,
      evalResponse.usage.cachedTokens || 0,
      evalResponse.usage.reasoningTokens || 0,
      evalResponse.usage.totalTokens,
      costUsd,
      evalResponse.providerRequestId || null,
      evalResponse.structuredOutput.executive_summary,
      evalResponse.structuredOutput.recommendation,
      JSON.stringify(evalResponse.structuredOutput.assumptions_and_risks),
      JSON.stringify(evalResponse.structuredOutput.actionable_feedback),
      JSON.stringify(scoreResult.criterionScoresJson),
      evalResponse.structuredOutput.confidence,
      evalResponse.structuredOutput.needs_human_review ? 1 : 0,
      JSON.stringify(evalResponse.structuredOutput.review_flags),
      1,
      completionIso
    ]);

    const inserted = await db.queryOne('SELECT * FROM evaluations WHERE id = ?', [evalId]);
    return this.mapRowToEvaluation(inserted);
  }

  /**
   * Fallback / Default: Evaluates with Score-50 Placeholder logic.
   */
  private async evaluateWithMock(submissionId: string): Promise<Evaluation> {
    const existing = await db.queryOne(`
      SELECT * FROM evaluations WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1
    `, [submissionId]);

    if (existing) {
      return this.mapRowToEvaluation(existing);
    }

    const evalId = `eval_${crypto.randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    await db.execute(`
      INSERT INTO evaluations (
        id, submission_id, evaluation_version, evaluation_status,
        overall_score, problem_structuring_score, analytical_rigor_score,
        strategic_insight_score, feasibility_impact_score, communication_score,
        ai_rationale, strengths, weaknesses, evidence,
        is_mock, provider, model,
        input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens,
        estimated_cost_usd,
        created_at
      )
      VALUES (
        ?, ?, 'mock-v1', 'mock_evaluated',
        50, 50, 50,
        50, 50, 50,
        NULL, NULL, NULL, NULL,
        1, 'mock', 'mock',
        0, 0, 0, 0, 0,
        0.00,
        ?
      )
      ON CONFLICT (id) DO NOTHING
    `, [evalId, submissionId, nowIso]);

    const inserted = await db.queryOne('SELECT * FROM evaluations WHERE id = ?', [evalId]);
    return this.mapRowToEvaluation(inserted);
  }

  /**
   * Retrieves an evaluation record for a submission.
   */
  async getEvaluation(submissionId: string): Promise<Evaluation | null> {
    const row = await db.queryOne(`
      SELECT * FROM evaluations WHERE submission_id = ? ORDER BY created_at DESC LIMIT 1
    `, [submissionId]);

    if (!row) return null;
    return this.mapRowToEvaluation(row);
  }

  /**
   * Returns aggregated token metrics.
   */
  async getTokenUsageStats(): Promise<TokenUsageStats> {
    return activeTokenUsageService.getUsageStats();
  }

  /**
   * Re-evaluates a submission, archiving previous records.
   */
  async reEvaluateSubmission(
    submissionId: string,
    options: { provider?: 'openai' | 'featherless'; model?: string; reason?: string } = {}
  ): Promise<Evaluation> {
    const existing = await this.getEvaluation(submissionId);
    if (existing) {
      await activeEvaluationAuditService.archiveEvaluation(existing, options.reason || 'organizer_re_evaluation_request');
    }

    const isEnabled = await this.isAiJudgeEnabled();
    return this.evaluateSubmission(submissionId, {
      forceAi: isEnabled,
      provider: options.provider,
      model: options.model,
    });
  }

  /**
   * Applies an organizer human review override.
   */
  async overrideScore(
    submissionId: string,
    reviewerId: string,
    overrideScore: number,
    overrideReason: string
  ): Promise<Evaluation> {
    const evalRecord = await this.getEvaluation(submissionId);
    if (!evalRecord) {
      throw new Error(`No evaluation record found for submission '${submissionId}'.`);
    }

    await activeEvaluationAuditService.applyHumanOverride(
      evalRecord.id,
      reviewerId,
      overrideScore,
      overrideReason
    );

    const updated = await this.getEvaluation(submissionId);
    return updated!;
  }

  private mapRowToEvaluation(row: any): Evaluation {
    let strengths: string[] = [];
    let weaknesses: string[] = [];
    let evidence: string[] = [];
    let assumptionsAndRisks: string[] = [];
    let actionableFeedback: string[] = [];
    let criterionScoresJson: any = null;
    let reviewFlags: string[] = [];

    try {
      if (row.strengths) strengths = JSON.parse(row.strengths);
    } catch {}
    try {
      if (row.weaknesses) weaknesses = JSON.parse(row.weaknesses);
    } catch {}
    try {
      if (row.evidence) evidence = JSON.parse(row.evidence);
    } catch {}
    try {
      if (row.assumptions_and_risks) assumptionsAndRisks = JSON.parse(row.assumptions_and_risks);
    } catch {}
    try {
      if (row.actionable_feedback) actionableFeedback = JSON.parse(row.actionable_feedback);
    } catch {}
    try {
      if (row.criterion_scores_json) criterionScoresJson = JSON.parse(row.criterion_scores_json);
    } catch {}
    try {
      if (row.review_flags) reviewFlags = JSON.parse(row.review_flags);
    } catch {}

    // If human override was applied, reflect effective overall score
    const effectiveOverallScore = row.human_override_score !== null && row.human_override_score !== undefined
      ? Number(row.human_override_score)
      : row.overall_score;

    return {
      id: row.id,
      submissionId: row.submission_id,
      evaluationVersion: row.evaluation_version,
      evaluationStatus: row.evaluation_status,
      overallScore: effectiveOverallScore,
      scores: {
        problemStructuring: row.problem_structuring_score,
        analyticalRigor: row.analytical_rigor_score,
        strategicInsight: row.strategic_insight_score,
        feasibilityImpact: row.feasibility_impact_score,
        communication: row.communication_score,
      },
      aiRationale: row.ai_rationale,
      strengths: Array.isArray(strengths) ? strengths.join('\n') : row.strengths,
      weaknesses: Array.isArray(weaknesses) ? weaknesses.join('\n') : row.weaknesses,
      evidence: Array.isArray(evidence) ? JSON.stringify(evidence) : row.evidence,
      isMock: Boolean(row.is_mock),
      provider: row.provider || (row.is_mock ? 'mock' : 'openai'),
      model: row.model || 'mock',
      inputTokens: row.input_tokens || 0,
      outputTokens: row.output_tokens || 0,
      cachedTokens: row.cached_tokens || 0,
      reasoningTokens: row.reasoning_tokens || 0,
      totalTokens: row.total_tokens || 0,
      estimatedCostUsd: Number(row.estimated_cost_usd || 0.0),
      providerRequestId: row.provider_request_id || undefined,
      executiveSummary: row.executive_summary || undefined,
      recommendation: row.recommendation || undefined,
      assumptionsAndRisks,
      actionableFeedback,
      criterionScoresJson,
      confidence: typeof row.confidence === 'number' ? row.confidence : 1.0,
      needsHumanReview: Boolean(row.needs_human_review),
      reviewFlags,
      humanReviewerId: row.human_reviewer_id || undefined,
      humanOverrideScore: row.human_override_score !== null ? Number(row.human_override_score) : undefined,
      humanOverrideReason: row.human_override_reason || undefined,
      humanReviewedAt: row.human_reviewed_at || undefined,
      attemptNumber: row.attempt_number || 1,
      createdAt: row.created_at,
    };
  }
}

export const activeEvaluationService: IEvaluationService = new ProductionEvaluationService();
