import type { CategoryScores, CriterionScoresJson, StructuredJudgeOutput } from '../../types';
export type { CategoryScores, CriterionScoresJson, StructuredJudgeOutput };

export interface ParsedSlide {
  slideNumber: number;
  title: string;
  text: string;
  wordCount: number;
  tables?: string[][];
  chartLabels?: string[];
  hasVisuals: boolean;
  imageDataUrl?: string; // data:image/png;base64,... or data:image/jpeg;base64,...
  visualPreview?: string;
  isSparseText: boolean;
}

export interface ParsedDeck {
  fileType: 'pdf' | 'pptx';
  slideCount: number;
  slides: ParsedSlide[];
  totalWordCount: number;
  hasVisuals: boolean;
}

export interface DeckEvaluationParams {
  submissionId?: string;
  teamName?: string;
  submissionName?: string;
  deck?: ParsedDeck;
  parsedDeck?: ParsedDeck;
  systemPrompt?: string;
  userPrompt?: string;
  maxOutputTokens?: number;
  rubricVersion?: string;
  providerOverride?: 'openai' | 'featherless';
  modelOverride?: string;
}

export interface RawJudgeUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
  providerRequestId?: string;
}

export interface RawJudgeResponse {
  rawJson: string;
  structuredOutput: StructuredJudgeOutput;
  rawOutput: StructuredJudgeOutput;
  usage: RawJudgeUsage;
  providerRequestId?: string;
  model: string;
  provider: 'openai' | 'featherless';
  latencyMs: number;
}

export interface IAIJudgeProvider {
  readonly name: 'openai' | 'featherless';
  readonly defaultModel: string;
  validateConfig(): { valid: boolean; error?: string };
  evaluateDeck(params: DeckEvaluationParams): Promise<RawJudgeResponse>;
}

export interface ModelPricing {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

export interface BenchmarkMetrics {
  totalEvaluated: number;
  totalDecks: number;
  meanAbsoluteErrorCriterion: number;
  meanAbsoluteErrorOverall: number;
  rankCorrelation: number; // Spearman or Pearson
  topKOverlap: number; // top-3 overlap percentage
  evidenceAccuracyScore: number;
  averageLatencyMs: number;
  averageTokensPerDeck: number;
  averageCostPerDeckUsd: number;
}
