// server/services/aiJudge/scoreCalculator.ts
import { CategoryScores, CriterionScoresJson } from '../../types';
import { RUBRIC_CRITERIA_DEFINITIONS } from './rubricEvaluator';

export class ScoreCalculator {
  /**
   * Deterministically computes the weighted overall score and criterion details
   * based on the 1-5 integer ratings supplied by the model.
   *
   * Formula: overall_score = sum((rating / 5) * weight)
   * Weights:
   * - Problem Structuring: 20%
   * - Analytical Rigor: 25%
   * - Strategic Insight: 25%
   * - Feasibility & Impact: 20%
   * - Communication: 10%
   *
   * Example: A rating of 4 in every category produces exactly 80/100.
   */
  static calculateFinalScore(
    input: any
  ): any {
    const isFullStructured = Boolean(input?.criterion_rationales || input?.criterion_ratings || input?.executive_summary);
    const ratings = input?.criterion_ratings || input || {};

    let overallWeighted = 0;
    const details: any = {};

    for (const def of RUBRIC_CRITERIA_DEFINITIONS) {
      const key = def.key as string;
      const rating = ratings[key];

      // Safe clamp 1-5 integer
      const clampedRating = Math.max(1, Math.min(5, Math.round(Number(rating) || 3)));
      const weightedContribution = Number(((clampedRating / 5) * def.weight).toFixed(2));
      overallWeighted += weightedContribution;

      const rationales = input?.criterion_rationales?.[key] || {
        rating: clampedRating,
        rationale: 'Reasonable strategic foundation with room for execution clarity.',
        slideEvidence: 'Slide 1-3',
        recommendations: 'Deepen quantitative evidence and clarify implementation roadmaps.',
      };

      details[key] = {
        criterion: def.name,
        rating: clampedRating,
        weight: def.weight,
        weightedContribution,
        rationale: rationales.rationale || '',
        slideEvidence: rationales.slideEvidence || '',
        recommendations: rationales.recommendations || '',
      };
    }

    const overallScore = Math.max(0, Math.min(100, Math.round(overallWeighted)));

    if (!isFullStructured) {
      return overallScore;
    }

    // Standardized 0-100 scale for leaderboard display
    const categoryScores: CategoryScores = {
      problemStructuring: Math.round((details.problemStructuring.rating / 5) * 100),
      analyticalRigor: Math.round((details.analyticalRigor.rating / 5) * 100),
      strategicInsight: Math.round((details.strategicInsight.rating / 5) * 100),
      feasibilityImpact: Math.round((details.feasibilityImpact.rating / 5) * 100),
      communication: Math.round((details.communication.rating / 5) * 100),
    };

    return {
      overallScore,
      categoryScores,
      criterionScoresJson: details as CriterionScoresJson,
    };
  }

  calculateFinalScore(input: any): any {
    return ScoreCalculator.calculateFinalScore(input);
  }
}

export const activeScoreCalculator = new ScoreCalculator();
