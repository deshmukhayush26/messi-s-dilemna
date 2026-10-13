// server/types.ts

export type UserRole = 'participant' | 'organizer';

export interface User {
  id: string;
  name: string;
  rollNumber: string;
  email?: string;
  passwordHash?: string;
  role: UserRole;
  createdAt: string;
  lastLoginAt?: string;
}

export type ReviewStatus = 'pending' | 'accepted' | 'rejected' | 'on_hold';

export interface Submission {
  id: string;
  userId: string;
  userName?: string;
  userRollNumber?: string;
  teamName: string;
  submissionName: string;
  deckFileName?: string;
  deckFileUrl?: string;
  storageKey?: string;
  fileType?: string;
  fileSize?: number;
  slideCount?: number;
  submissionDurationSec?: number;
  notes?: string;
  reviewStatus: ReviewStatus;
  isPublished: boolean;
  createdAt: string;
  updatedAt: string;
  evaluation?: Evaluation;
}

export type EvaluationStatus = 'mock_evaluated' | 'placeholder' | 'completed' | 'processing' | 'failed' | 'needs_review';

export interface CategoryScores {
  problemStructuring: number; // 0-100 percentage points (rating * 20)
  analyticalRigor: number; // 0-100 percentage points (rating * 20)
  strategicInsight: number; // 0-100 percentage points (rating * 20)
  feasibilityImpact: number; // 0-100 percentage points (rating * 20)
  communication: number; // 0-100 percentage points (rating * 20)
}

export interface CriterionDetail {
  criterion: string;
  rating: number; // 1-5 integer rating
  weight: number; // 20, 25, 25, 20, 10
  weightedContribution: number; // (rating / 5) * weight
  rationale: string;
  slideEvidence: string;
  recommendations: string;
}

export interface CriterionScoresJson {
  problemStructuring: CriterionDetail;
  analyticalRigor: CriterionDetail;
  strategicInsight: CriterionDetail;
  feasibilityImpact: CriterionDetail;
  communication: CriterionDetail;
}

export interface EvidenceCitation {
  slideNumber: number;
  claim: string;
  reference: string;
}

export interface StructuredJudgeOutput {
  overall_score: number; // calculated deterministically in code
  criterion_ratings: {
    problemStructuring: number;
    analyticalRigor: number;
    strategicInsight: number;
    feasibilityImpact: number;
    communication: number;
  };
  ratings?: any;
  executive_summary: string;
  recommendation: string;
  criterion_rationales: Record<string, { rating: number; rationale: string; slideEvidence: string; recommendations: string }>;
  strengths: string[];
  weaknesses: string[];
  evidence: EvidenceCitation[];
  assumptions_and_risks: string[];
  actionable_feedback: string[];
  confidence: number;
  needs_human_review: boolean;
  review_flags: string[];
  reviewFlags?: string[];
}

export interface Evaluation {
  id: string;
  submissionId: string;
  evaluationVersion: string; // e.g. 'mock-v1' or 'openai-gpt-4o-v1'
  evaluationStatus: EvaluationStatus;
  overallScore: number; // 0-100
  scores: CategoryScores;
  aiRationale: string | null;
  strengths: string | null;
  weaknesses: string | null;
  evidence: string | null;
  isMock: boolean;
  provider?: 'openai' | 'featherless' | 'mock';
  model?: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  totalTokens: number;
  estimatedCostUsd: number;
  providerRequestId?: string;
  executiveSummary?: string;
  recommendation?: string;
  assumptionsAndRisks?: string[];
  actionableFeedback?: string[];
  criterionScoresJson?: CriterionScoresJson;
  confidence?: number;
  needsHumanReview?: boolean;
  reviewFlags?: string[];
  humanReviewerId?: string;
  humanOverrideScore?: number;
  humanOverrideReason?: string;
  humanReviewedAt?: string;
  attemptNumber?: number;
  createdAt: string;
}

export type JobStatus = 'pending' | 'processing' | 'evaluated' | 'needs_review' | 'failed' | 'cancelled';

export interface EvaluationJob {
  id: string;
  submissionId: string;
  status: JobStatus;
  provider: 'openai' | 'featherless' | 'mock';
  model: string;
  attempts: number;
  maxAttempts: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface TokenUsageStats {
  mockEvaluationsCompleted: number;
  actualApiEvaluationsCompleted: number;
  failedEvaluationsCount: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualCachedTokens: number;
  actualReasoningTokens: number;
  actualTotalTokens: number;
  remainingConfiguredBudget: number;
  estimatedActualApiCostUsd: number;
  totalConfiguredBudget: number;
  isAiJudgeEnabled: boolean;
  aiJudgeProvider: 'openai' | 'featherless';
  aiJudgeModel: string;
  budgetUtilizationPercent: number;
  averageCostPerDeckUsd: number;
}

export interface AIJudgeConfig {
  isEnabled: boolean;
  provider: 'openai' | 'featherless';
  model: string;
  rubricVersion: string;
  maxConcurrency: number;
  maxRetries: number;
  budgetUsd: number;
  spentUsd: number;
  feedbackReleaseMode: 'immediate' | 'after_event' | 'manual_only';
}

export interface LeaderboardEntry {
  rank: number;
  submissionId: string;
  submissionName: string;
  teamName: string;
  submittedBy: string;
  rollNumber: string;
  totalScore: number;
  scores: CategoryScores;
  isMock: boolean;
  submittedAt: string;
  slideCount?: number;
}

export type TimerStatus = 'not_started' | 'running' | 'paused' | 'expired';

export interface EventTimer {
  id: string;
  status: TimerStatus;
  initialDurationSec: number;
  remainingDurationSec: number;
  startTimestamp: string | null;
  endTimestamp: string | null;
  lastUpdatedAt: string;
  lastUpdatedBy: string;
  version: number;
  remainingSeconds: number; // computed authoritative countdown seconds
}

export interface TimerActionLog {
  id: string;
  organizerId: string;
  action: string;
  durationAddedSec: number;
  previousState: TimerStatus;
  newState: TimerStatus;
  timestamp: string;
  notes?: string;
}
