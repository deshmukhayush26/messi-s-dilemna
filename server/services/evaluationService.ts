// server/services/evaluationService.ts
import { Evaluation, TokenUsageStats } from '../types';
import { db } from '../db';
import crypto from 'node:crypto';
import { activeOpenAIProvider } from './aiJudge/providers/openAIProvider';
import { activeFeatherlessProvider, resolveFeatherlessModel, DEFAULT_FEATHERLESS_MODEL } from './aiJudge/providers/featherlessProvider';
import { activeDeckParser } from './aiJudge/deckParser';
import { activeScoreCalculator } from './aiJudge/scoreCalculator';
import { activeTokenUsageService } from './aiJudge/tokenUsageService';
import { activeEvaluationAuditService } from './aiJudge/evaluationAuditService';
import { activeStorageService } from './storageService';

export interface IEvaluationService {
  isAiJudgeEnabled(): Promise<boolean>;
  evaluateSubmission(
    submissionId: string,
    options?: { forceAi?: boolean; provider?: 'openai' | 'featherless'; model?: string }
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
   * Prioritizes explicit environment variable if set; otherwise falls back to database admin_config.
   * Defaults to true in production.
   */
  async isAiJudgeEnabled(): Promise<boolean> {
    if (process.env.AI_JUDGE_ENABLED === 'false') {
      return false;
    }
    if (process.env.AI_JUDGE_ENABLED === 'true') {
      return true;
    }
    const config = await db.queryOne('SELECT is_ai_judge_enabled FROM admin_config WHERE id = ?', ['global']);
    if (config && config.is_ai_judge_enabled !== undefined && config.is_ai_judge_enabled !== null) {
      return Boolean(config.is_ai_judge_enabled);
    }
    return true;
  }

  /**
   * Evaluates a submission using the real Featherless (or OpenAI) AI pipeline.
   * Never generates or publishes placeholder score-50 records.
   * If credentials or prerequisites are missing, records a 'failed' evaluation
   * detailing the exact missing configuration so it cannot contaminate the leaderboard.
   */
  async evaluateSubmission(
    submissionId: string,
    options: { forceAi?: boolean; provider?: 'openai' | 'featherless'; model?: string } = {}
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

    // Return existing evaluation if already completed successfully and not forced
    if (existingEval && existingEval.evaluation_status === 'completed' && !options.forceAi) {
      return this.mapRowToEvaluation(existingEval);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // REAL AI JUDGE PIPELINE (Featherless / OpenAI)
    // ─────────────────────────────────────────────────────────────────────────
    const config = await db.queryOne('SELECT * FROM admin_config WHERE id = ?', ['global']);
    const providerName: 'openai' | 'featherless' =
      options.provider ||
      (config?.ai_judge_provider as any) ||
      (process.env.AI_PROVIDER as any) ||
      'featherless';

    const provider = providerName === 'openai' ? activeOpenAIProvider : activeFeatherlessProvider;
    const selectedModel =
      providerName === 'featherless'
        ? resolveFeatherlessModel(options.model || config?.ai_judge_model)
        : (options.model || process.env.OPENAI_JUDGE_MODEL || 'gpt-4o');

    console.log(`[AI Judge] Evaluating submission '${submissionId}' using provider='${providerName}', model='${selectedModel}'`);

    // 1. Validate Provider Configuration
    const configCheck = provider.validateConfig();
    if (!configCheck.valid) {
      console.warn(`[AI Judge] Configuration validation failed for ${providerName}: ${configCheck.error}`);
      return this.recordFailedEvaluation(
        submissionId,
        existingEval?.id,
        providerName,
        selectedModel,
        `AI Judge configuration error (${providerName}): ${configCheck.error}`
      );
    }

    // 2. Budget Check
    const budgetCheck = await activeTokenUsageService.checkBudgetAvailable();
    if (!budgetCheck.allowed) {
      console.warn(`[AI Judge] Budget check failed: ${budgetCheck.reason}`);
      return this.recordFailedEvaluation(
        submissionId,
        existingEval?.id,
        providerName,
        selectedModel,
        budgetCheck.reason || 'AI Judge spending budget exhausted.'
      );
    }

    // 3. Retrieve deck file from storage
    const storageKey = submission.storage_key || `decks/${submission.deck_file_name}`;
    let deckBuffer: Buffer | null = null;
    try {
      deckBuffer = await activeStorageService.getDeckBuffer(storageKey);
    } catch (err: any) {
      console.warn(`[AI Judge] Storage error reading '${storageKey}':`, err.message);
    }

    if (!deckBuffer) {
      return this.recordFailedEvaluation(
        submissionId,
        existingEval?.id,
        providerName,
        selectedModel,
        `Deck presentation file not found in storage for key '${storageKey}'.`
      );
    }

    // 4. Parse deck with DeckParser
    const originalFilename = submission.deck_file_name || 'deck.pdf';
    let parsedDeck: any;
    try {
      parsedDeck = await activeDeckParser.parseDeck(deckBuffer, originalFilename);
    } catch (err: any) {
      return this.recordFailedEvaluation(
        submissionId,
        existingEval?.id,
        providerName,
        selectedModel,
        `Failed to parse presentation deck: ${err.message}`
      );
    }

    // 5. Run AI Judge Provider with timeout & error handling
    let evalResponse: any;
    try {
      evalResponse = await provider.evaluateDeck({
        submissionId,
        teamName: submission.team_name,
        submissionName: submission.submission_name,
        deck: parsedDeck,
        modelOverride: selectedModel,
      });
    } catch (err: any) {
      console.error(`[AI Judge] Provider execution error (${providerName}):`, err);
      return this.recordFailedEvaluation(
        submissionId,
        existingEval?.id,
        providerName,
        selectedModel,
        `AI Evaluation execution failed (${providerName}): ${err.message}`
      );
    }

    // 6. Calculate Deterministic Final Score from Rubric Criteria
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

    // 8. Persist Real Evaluation to Database
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
      completionIso,
    ]);

    const inserted = await db.queryOne('SELECT * FROM evaluations WHERE id = ?', [evalId]);
    return this.mapRowToEvaluation(inserted);
  }

  /**
   * Persists a failed evaluation record without fake placeholder scores.
   * Records overallScore = 0 and status = 'failed' so the entry is never
   * published on the public leaderboard while explaining the exact error to organizers.
   */
  private async recordFailedEvaluation(
    submissionId: string,
    existingEvalId: string | undefined,
    provider: string,
    model: string,
    errorMessage: string
  ): Promise<Evaluation> {
    const evalId = existingEvalId || `eval_${crypto.randomUUID().slice(0, 8)}`;
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
        ?, ?, 'failed-v1', 'failed',
        0, 0, 0,
        0, 0, 0,
        ?, NULL, NULL, NULL,
        0, ?, ?,
        0, 0, 0, 0, 0,
        0.00,
        ?
      )
      ON CONFLICT (id) DO UPDATE SET
        evaluation_version = EXCLUDED.evaluation_version,
        evaluation_status = 'failed',
        overall_score = 0,
        problem_structuring_score = 0,
        analytical_rigor_score = 0,
        strategic_insight_score = 0,
        feasibility_impact_score = 0,
        communication_score = 0,
        ai_rationale = EXCLUDED.ai_rationale,
        is_mock = 0,
        provider = EXCLUDED.provider,
        model = EXCLUDED.model
    `, [evalId, submissionId, errorMessage, provider, model, nowIso]);

    const failedRow = await db.queryOne('SELECT * FROM evaluations WHERE id = ?', [evalId]);
    return this.mapRowToEvaluation(failedRow);
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

    return this.evaluateSubmission(submissionId, {
      forceAi: true,
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

    const effectiveOverallScore =
      row.human_override_score !== null && row.human_override_score !== undefined
        ? Number(row.human_override_score)
        : Number(row.overall_score || 0);

    return {
      id: row.id,
      submissionId: row.submission_id,
      evaluationVersion: row.evaluation_version,
      evaluationStatus: row.evaluation_status,
      overallScore: effectiveOverallScore,
      scores: {
        problemStructuring: Number(row.problem_structuring_score || 0),
        analyticalRigor: Number(row.analytical_rigor_score || 0),
        strategicInsight: Number(row.strategic_insight_score || 0),
        feasibilityImpact: Number(row.feasibility_impact_score || 0),
        communication: Number(row.communication_score || 0),
      },
      aiRationale: row.ai_rationale || undefined,
      strengths: Array.isArray(strengths) ? strengths.join('\n') : row.strengths,
      weaknesses: Array.isArray(weaknesses) ? weaknesses.join('\n') : row.weaknesses,
      evidence: Array.isArray(evidence) ? JSON.stringify(evidence) : row.evidence,
      isMock: Boolean(row.is_mock),
      provider: row.provider || 'featherless',
      model: row.model || DEFAULT_FEATHERLESS_MODEL,
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
