// server/services/aiJudge/tokenUsageService.ts
import { db } from '../../db';
import { TokenUsageStats } from '../../types';
import { ModelPricing } from './types';

export const MODEL_PRICING_CATALOG: Record<string, ModelPricing> = {
  // OpenAI Models
  'gpt-4o': {
    inputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
  },
  'gpt-4o-2024-08-06': {
    inputPerMillion: 2.50,
    cachedInputPerMillion: 1.25,
    outputPerMillion: 10.00,
  },
  'gpt-4o-mini': {
    inputPerMillion: 0.15,
    cachedInputPerMillion: 0.075,
    outputPerMillion: 0.60,
  },
  // Featherless AI Models
  'meta-llama/Meta-Llama-3.1-8B-Instruct': {
    inputPerMillion: 0.20,
    cachedInputPerMillion: 0.20,
    outputPerMillion: 0.20,
  },
  'meta-llama/Llama-3.2-11B-Vision-Instruct': {
    inputPerMillion: 0.20,
    cachedInputPerMillion: 0.20,
    outputPerMillion: 0.20,
  },
  'meta-llama/Llama-3.2-90B-Vision-Instruct': {
    inputPerMillion: 0.90,
    cachedInputPerMillion: 0.90,
    outputPerMillion: 0.90,
  },
  'Qwen/Qwen2-VL-7B-Instruct': {
    inputPerMillion: 0.15,
    cachedInputPerMillion: 0.15,
    outputPerMillion: 0.15,
  },
  // Default fallback
  default: {
    inputPerMillion: 1.00,
    cachedInputPerMillion: 0.50,
    outputPerMillion: 2.00,
  },
};

export class TokenUsageService {
  /**
   * Normalizes raw provider usage and calculates estimated cost in USD.
   */
  static calculateCost(model: string, usage: any): number {
    const pricing = MODEL_PRICING_CATALOG[model] || MODEL_PRICING_CATALOG.default;

    const cachedInput = usage.cachedTokens || usage.cachedInputTokens || 0;
    const promptTokens = usage.promptTokens ?? usage.inputTokens ?? 0;
    const regularInput = Math.max(0, promptTokens - cachedInput);
    const output = usage.completionTokens ?? usage.outputTokens ?? 0;

    const costRegularInput = (regularInput / 1_000_000) * pricing.inputPerMillion;
    const costCachedInput = (cachedInput / 1_000_000) * pricing.cachedInputPerMillion;
    const costOutput = (output / 1_000_000) * pricing.outputPerMillion;

    const totalCost = costRegularInput + costCachedInput + costOutput;
    return Number(totalCost.toFixed(6));
  }

  calculateCost(model: string, usage: any): number {
    return TokenUsageService.calculateCost(model, usage);
  }

  /**
   * Normalizes provider token usage fields.
   */
  static normalizeUsage(
    _provider: string,
    _model: string,
    rawUsage: any,
    requestId?: string
  ): {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    providerRequestId?: string;
  } {
    const promptTokens = rawUsage?.prompt_tokens ?? rawUsage?.inputTokens ?? rawUsage?.promptTokens ?? 0;
    const completionTokens = rawUsage?.completion_tokens ?? rawUsage?.outputTokens ?? rawUsage?.completionTokens ?? 0;
    const cachedTokens = rawUsage?.prompt_tokens_details?.cached_tokens ?? rawUsage?.cachedTokens ?? rawUsage?.cachedInputTokens ?? 0;
    const reasoningTokens = rawUsage?.completion_tokens_details?.reasoning_tokens ?? rawUsage?.reasoningTokens ?? 0;
    const totalTokens = rawUsage?.total_tokens ?? rawUsage?.totalTokens ?? (promptTokens + completionTokens);

    return {
      inputTokens: promptTokens,
      outputTokens: completionTokens,
      cachedInputTokens: cachedTokens,
      reasoningTokens,
      totalTokens,
      providerRequestId: requestId,
    };
  }

  normalizeUsage(provider: string, model: string, rawUsage: any, requestId?: string) {
    return TokenUsageService.normalizeUsage(provider, model, rawUsage, requestId);
  }

  /**
   * Verifies if budget is available before launching an AI evaluation.
   * Prevents race conditions with atomic budget reservation check.
   */
  static async checkBudgetAvailable(estimatedCostUsd: number = 0.005): Promise<{ allowed: boolean; reason?: string; remainingBudget: number }> {
    const config = await db.queryOne('SELECT * FROM admin_config WHERE id = ?', ['global']);
    const budgetUsd = Number(config?.ai_judge_budget_usd ?? (process.env.AI_JUDGE_BUDGET_USD ? Number(process.env.AI_JUDGE_BUDGET_USD) : 50.0));

    const spentRow = await db.queryOne<{ total_spent: number }>(`
      SELECT COALESCE(SUM(estimated_cost_usd), 0.0) as total_spent
      FROM evaluations
      WHERE is_mock = 0
    `);

    const dbSpent = Number(spentRow?.total_spent || 0);
    const configSpent = Number(config?.ai_judge_spent_usd || 0);
    const totalSpent = Math.max(dbSpent, configSpent);

    const remainingBudget = Math.max(0, Number((budgetUsd - totalSpent).toFixed(4)));

    if (totalSpent + estimatedCostUsd > budgetUsd) {
      return {
        allowed: false,
        reason: `Configured AI Judge budget of $${budgetUsd.toFixed(2)} USD would be exceeded (total spent: $${totalSpent.toFixed(2)} USD, remaining: $${remainingBudget.toFixed(2)} USD, requested: $${estimatedCostUsd.toFixed(2)} USD). New AI evaluations halted until budget is increased.`,
        remainingBudget,
      };
    }

    return {
      allowed: true,
      remainingBudget,
    };
  }

  async checkBudgetAvailable(estimatedCostUsd: number = 0.005) {
    return TokenUsageService.checkBudgetAvailable(estimatedCostUsd);
  }

  /**
   * Atomically records spent cost in admin_config.
   */
  async recordCost(costUsd: number): Promise<void> {
    if (costUsd <= 0) return;
    try {
      await db.execute(`
        UPDATE admin_config
        SET ai_judge_spent_usd = ai_judge_spent_usd + ?
        WHERE id = 'global'
      `, [costUsd]);
    } catch {
      // Ignore background cost record errors
    }
  }

  /**
   * Returns aggregated token accounting metrics for the admin dashboard.
   */
  async getUsageStats(): Promise<TokenUsageStats> {
    const config = await db.queryOne('SELECT * FROM admin_config WHERE id = ?', ['global']);
    const totalConfiguredTokens = config?.app_token_budget ?? 500000;
    const budgetUsd = Number(process.env.AI_JUDGE_BUDGET_USD || config?.ai_judge_budget_usd || 50.0);

    // Mock evaluations count
    const mockCountRow = await db.queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM evaluations WHERE is_mock = 1
    `);

    // Real AI evaluations count and token aggregation
    const realUsageRow = await db.queryOne(`
      SELECT 
        COUNT(*) as completed_count,
        COALESCE(SUM(input_tokens), 0) as total_input,
        COALESCE(SUM(output_tokens), 0) as total_output,
        COALESCE(SUM(cached_tokens), 0) as total_cached,
        COALESCE(SUM(reasoning_tokens), 0) as total_reasoning,
        COALESCE(SUM(total_tokens), 0) as total_consumed,
        COALESCE(SUM(estimated_cost_usd), 0.0) as total_cost
      FROM evaluations 
      WHERE is_mock = 0
    `);

    // Failed jobs count
    const failedJobsRow = await db.queryOne<{ count: number }>(`
      SELECT COUNT(*) as count FROM evaluation_jobs WHERE status = 'failed'
    `);

    const actualCompletedCount = Number(realUsageRow?.completed_count || 0);
    const actualInputTokens = Number(realUsageRow?.total_input || 0);
    const actualOutputTokens = Number(realUsageRow?.total_output || 0);
    const actualCachedTokens = Number(realUsageRow?.total_cached || 0);
    const actualReasoningTokens = Number(realUsageRow?.total_reasoning || 0);
    const actualTotalTokens = Number(realUsageRow?.total_consumed || 0);
    const actualCostUsd = Number(realUsageRow?.total_cost || 0.0);

    const remainingTokens = Math.max(0, totalConfiguredTokens - actualTotalTokens);
    const budgetUtilization = budgetUsd > 0 ? Math.min(100, Number(((actualCostUsd / budgetUsd) * 100).toFixed(1))) : 0;
    const averageCost = actualCompletedCount > 0 ? Number((actualCostUsd / actualCompletedCount).toFixed(4)) : 0;

    const isEnabled = process.env.AI_JUDGE_ENABLED === 'true' || Boolean(config?.is_ai_judge_enabled);
    const provider = (process.env.AI_PROVIDER as any) || config?.ai_judge_provider || 'openai';
    const model = (process.env.OPENAI_JUDGE_MODEL || process.env.FEATHERLESS_JUDGE_MODEL || config?.ai_judge_model || 'gpt-4o');

    return {
      mockEvaluationsCompleted: Number(mockCountRow?.count || 0),
      actualApiEvaluationsCompleted: actualCompletedCount,
      failedEvaluationsCount: Number(failedJobsRow?.count || 0),
      actualInputTokens,
      actualOutputTokens,
      actualCachedTokens,
      actualReasoningTokens,
      actualTotalTokens,
      remainingConfiguredBudget: remainingTokens,
      estimatedActualApiCostUsd: Number(actualCostUsd.toFixed(4)),
      totalConfiguredBudget: totalConfiguredTokens,
      isAiJudgeEnabled: isEnabled,
      aiJudgeProvider: provider,
      aiJudgeModel: model,
      budgetUtilizationPercent: budgetUtilization,
      averageCostPerDeckUsd: averageCost,
    };
  }
}

export const activeTokenUsageService = new TokenUsageService();
