// server/services/aiJudge/evaluationQueue.ts
import crypto from 'node:crypto';
import { db } from '../../db';
import { EvaluationJob, JobStatus } from '../../types';
import { activeOpenAIProvider } from './providers/openAIProvider';
import { activeFeatherlessProvider, resolveFeatherlessModel } from './providers/featherlessProvider';
import { activeDeckParser } from './deckParser';
import { activeScoreCalculator } from './scoreCalculator';
import { activeTokenUsageService } from './tokenUsageService';
import { activeEvaluationAuditService } from './evaluationAuditService';
import { activeStorageService } from '../storageService';

export class EvaluationQueue {
  private maxConcurrency: number;
  private maxRetries: number;
  private activeJobsCount = 0;
  private isProcessing = false;

  constructor(maxConcurrency = 2, maxRetries = 3) {
    this.maxConcurrency = maxConcurrency;
    this.maxRetries = maxRetries;
  }

  /**
   * Helper: Executes a function with exponential backoff and jitter.
   */
  static async executeWithRetry<T>(
    operation: () => Promise<T>,
    maxRetries = 3,
    initialDelayMs = 1000
  ): Promise<T> {
    let lastError: any;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await operation();
      } catch (err: any) {
        lastError = err;
        if (attempt === maxRetries) break;
        const delay = initialDelayMs * Math.pow(2, attempt - 1) + Math.random() * 200;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }

  /**
   * Enqueues a submission for asynchronous AI evaluation.
   * Ensures idempotency: If a pending or processing job already exists, reuses it.
   */
  async enqueueJob(
    submissionId: string,
    options: { provider?: 'openai' | 'featherless'; model?: string } = {}
  ): Promise<EvaluationJob> {
    const config = await db.queryOne('SELECT * FROM admin_config WHERE id = ?', ['global']);
    const provider: 'openai' | 'featherless' =
      options.provider || (config?.ai_judge_provider as any) || (process.env.AI_PROVIDER as any) || 'featherless';
    const model =
      provider === 'featherless'
        ? resolveFeatherlessModel(options.model || config?.ai_judge_model)
        : (options.model || config?.ai_judge_model || process.env.OPENAI_JUDGE_MODEL || 'gpt-4o');

    // Check for existing pending/processing job
    const existingJob = await db.queryOne(`
      SELECT * FROM evaluation_jobs
      WHERE submission_id = ? AND status IN ('pending', 'processing')
      ORDER BY created_at DESC LIMIT 1
    `, [submissionId]);

    if (existingJob) {
      return this.mapRowToJob(existingJob);
    }

    const jobId = `job_${crypto.randomUUID().slice(0, 8)}`;
    const nowIso = new Date().toISOString();

    await db.execute(`
      INSERT INTO evaluation_jobs (
        id, submission_id, status, provider, model, attempts, max_attempts, error_message, created_at, updated_at
      )
      VALUES (?, ?, 'pending', ?, ?, 0, ?, NULL, ?, ?)
      ON CONFLICT (id) DO NOTHING
    `, [jobId, submissionId, provider, model, this.maxRetries, nowIso, nowIso]);

    const inserted = await db.queryOne('SELECT * FROM evaluation_jobs WHERE id = ?', [jobId]);
    const job = this.mapRowToJob(inserted);

    // Trigger queue processing asynchronously (non-blocking)
    setImmediate(() => {
      this.processQueue().catch((err) => {
        console.error('[EvaluationQueue] Worker error:', err.message);
      });
    });

    return job;
  }

  /**
   * Main background worker loop.
   * Concurrency-safe: Atomically claims pending jobs to prevent two workers from evaluating the same deck.
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      while (this.activeJobsCount < this.maxConcurrency) {
        const nowIso = new Date().toISOString();
        let claimedJob: any = null;

        if (db.isPostgres) {
          // Atomic claim under PostgreSQL using FOR UPDATE SKIP LOCKED
          const claimedRows = await db.query(`
            UPDATE evaluation_jobs
            SET status = 'processing', attempts = attempts + 1, updated_at = ?
            WHERE id = (
              SELECT id FROM evaluation_jobs
              WHERE status = 'pending'
              ORDER BY created_at ASC
              LIMIT 1
              FOR UPDATE SKIP LOCKED
            )
            RETURNING *
          `, [nowIso]);
          if (claimedRows && claimedRows.length > 0) {
            claimedJob = claimedRows[0];
          }
        } else {
          // Atomic claim for local SQLite testing
          const candidate = await db.queryOne(`
            SELECT * FROM evaluation_jobs
            WHERE status = 'pending'
            ORDER BY created_at ASC
            LIMIT 1
          `);
          if (candidate) {
            const updateRes = await db.execute(`
              UPDATE evaluation_jobs
              SET status = 'processing', attempts = attempts + 1, updated_at = ?
              WHERE id = ? AND status = 'pending'
            `, [nowIso, candidate.id]);
            if (updateRes.rowCount > 0) {
              claimedJob = { ...candidate, status: 'processing', attempts: candidate.attempts + 1 };
            }
          }
        }

        if (!claimedJob) break;

        this.activeJobsCount++;
        this.processClaimedJob(this.mapRowToJob(claimedJob)).finally(() => {
          this.activeJobsCount--;
          setImmediate(() => this.processQueue());
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Executes a claimed evaluation job end-to-end.
   */
  private async processClaimedJob(job: EvaluationJob): Promise<void> {
    try {
      // 1. Budget verification
      const budgetCheck = await activeTokenUsageService.checkBudgetAvailable();
      if (!budgetCheck.allowed) {
        throw new Error(budgetCheck.reason || 'AI Judge budget exhausted.');
      }

      // 2. Retrieve submission record
      const submission = await db.queryOne('SELECT * FROM submissions WHERE id = ?', [job.submissionId]);
      if (!submission) {
        throw new Error(`Submission '${job.submissionId}' not found.`);
      }

      // 3. Retrieve deck file from storage
      const storageKey = submission.storage_key || `decks/${submission.deck_file_name}`;
      const deckBuffer = await activeStorageService.getDeckBuffer(storageKey);
      if (!deckBuffer) {
        throw new Error(`Deck file not found in storage for key '${storageKey}'.`);
      }

      // 4. Parse deck with DeckParser
      const originalFilename = submission.deck_file_name || 'deck.pdf';
      const parsedDeck = await activeDeckParser.parseDeck(deckBuffer, originalFilename);

      // 5. Select provider
      const provider =
        job.provider === 'featherless' ? activeFeatherlessProvider : activeOpenAIProvider;
      const modelToUse =
        job.provider === 'featherless'
          ? resolveFeatherlessModel(job.model)
          : (job.model || 'gpt-4o');

      const evalResponse = await provider.evaluateDeck({
        submissionId: job.submissionId,
        teamName: submission.team_name,
        submissionName: submission.submission_name,
        deck: parsedDeck,
        modelOverride: modelToUse,
      });

      // 6. Calculate deterministic final scores
      const scoreResult = activeScoreCalculator.calculateFinalScore(evalResponse.structuredOutput);
      const costUsd = activeTokenUsageService.calculateCost(evalResponse.model, evalResponse.usage);
      await activeTokenUsageService.recordCost(costUsd);

      // 7. Check for existing evaluation to archive in history
      const existingEval = await db.queryOne('SELECT * FROM evaluations WHERE submission_id = ?', [job.submissionId]);
      if (existingEval) {
        await activeEvaluationAuditService.archiveEvaluation(existingEval, 're_evaluation_by_ai');
      }

      const evalVersion = `${evalResponse.provider}-${evalResponse.model}-v1`;
      const evalStatus = evalResponse.structuredOutput.needs_human_review ? 'needs_review' : 'completed';
      const evalId = existingEval?.id || `eval_${crypto.randomUUID().slice(0, 8)}`;
      const completionIso = new Date().toISOString();

      // 8. Persist evaluation record
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
        job.submissionId,
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
        job.attempts + 1,
        completionIso
      ]);

      // 9. Update job status to evaluated or needs_review
      const finalJobStatus: JobStatus = evalResponse.structuredOutput.needs_human_review ? 'needs_review' : 'evaluated';
      await db.execute(`
        UPDATE evaluation_jobs
        SET status = ?, error_message = NULL, updated_at = ?, completed_at = ?
        WHERE id = ?
      `, [finalJobStatus, completionIso, completionIso, job.id]);

    } catch (err: any) {
      const errorMsg = String(err?.message || 'Unknown evaluation failure');
      const failIso = new Date().toISOString();
      const currentAttempts = job.attempts + 1;

      if (currentAttempts < this.maxRetries) {
        // Exponential backoff with jitter
        const delayMs = Math.min(30000, Math.pow(2, currentAttempts) * 1000 + Math.random() * 500);
        console.warn(`[EvaluationQueue] Job ${job.id} failed (attempt ${currentAttempts}/${this.maxRetries}). Retrying in ${Math.round(delayMs)}ms: ${errorMsg}`);

        setTimeout(async () => {
          try {
            await db.execute(`
              UPDATE evaluation_jobs
              SET status = 'pending', error_message = ?, updated_at = ?
              WHERE id = ?
            `, [errorMsg, new Date().toISOString(), job.id]);
            this.processQueue().catch(() => {});
          } catch {}
        }, delayMs);
      } else {
        // Max retries reached; mark failed permanently
        console.error(`[EvaluationQueue] Job ${job.id} permanently failed after ${currentAttempts} attempts: ${errorMsg}`);
        await db.execute(`
          UPDATE evaluation_jobs
          SET status = 'failed', error_message = ?, updated_at = ?
          WHERE id = ?
        `, [errorMsg, failIso, job.id]);
      }
    }
  }

  /**
   * Retrieves all jobs or jobs for a specific submission.
   */
  async getJobs(submissionId?: string): Promise<EvaluationJob[]> {
    let rows: any[];
    if (submissionId) {
      rows = await db.query(`
        SELECT * FROM evaluation_jobs WHERE submission_id = ? ORDER BY created_at DESC
      `, [submissionId]);
    } else {
      rows = await db.query(`
        SELECT * FROM evaluation_jobs ORDER BY created_at DESC LIMIT 100
      `);
    }
    return rows.map((r) => this.mapRowToJob(r));
  }

  private mapRowToJob(row: any): EvaluationJob {
    return {
      id: row.id,
      submissionId: row.submission_id,
      status: row.status as JobStatus,
      provider: row.provider,
      model: row.model,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined,
    };
  }
}

export const activeEvaluationQueue = new EvaluationQueue();
