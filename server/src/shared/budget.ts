import type {
  BudgetEstimateSource,
  IssueBudget,
  IssueType,
} from "./types";

const ISSUE_BUDGET_CONFIG: Record<
  IssueType,
  {
    baseAmount: number;
    severityStepAmount: number;
    defaultSeverity: number;
    minAmount: number;
    maxAmount: number;
  }
> = {
  POTHOLE: {
    baseAmount: 2500,
    severityStepAmount: 1700,
    defaultSeverity: 5.5,
    minAmount: 2500,
    maxAmount: 20000,
  },
  GARBAGE: {
    baseAmount: 1200,
    severityStepAmount: 700,
    defaultSeverity: 4,
    minAmount: 1200,
    maxAmount: 9000,
  },
  ILLEGAL_PARKING: {
    baseAmount: 800,
    severityStepAmount: 450,
    defaultSeverity: 3.5,
    minAmount: 800,
    maxAmount: 6000,
  },
  DAMAGED_SIGN: {
    baseAmount: 1800,
    severityStepAmount: 900,
    defaultSeverity: 4.5,
    minAmount: 1800,
    maxAmount: 12000,
  },
  FALLEN_TREE: {
    baseAmount: 4500,
    severityStepAmount: 2100,
    defaultSeverity: 7,
    minAmount: 4500,
    maxAmount: 28000,
  },
  VANDALISM: {
    baseAmount: 1600,
    severityStepAmount: 850,
    defaultSeverity: 4,
    minAmount: 1600,
    maxAmount: 10000,
  },
  DEAD_ANIMAL: {
    baseAmount: 1000,
    severityStepAmount: 650,
    defaultSeverity: 5,
    minAmount: 1000,
    maxAmount: 7000,
  },
  DAMAGED_CONCRETE: {
    baseAmount: 3200,
    severityStepAmount: 1900,
    defaultSeverity: 6,
    minAmount: 3200,
    maxAmount: 24000,
  },
  DAMAGED_ELECTRICAL: {
    baseAmount: 5000,
    severityStepAmount: 2400,
    defaultSeverity: 7.5,
    minAmount: 5000,
    maxAmount: 32000,
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function roundToNearestHundred(value: number) {
  return Math.round(value / 100) * 100;
}

export function createIssueBudgetEstimate(params: {
  issueType: IssueType;
  now: Date;
  severityScore?: number | null;
  confidence?: number | null;
  hadImage: boolean;
}): IssueBudget {
  const config = ISSUE_BUDGET_CONFIG[params.issueType];
  const usedSeverity = params.severityScore ?? config.defaultSeverity;
  const rawAmount =
    config.baseAmount + Math.max(0, usedSeverity - 1) * config.severityStepAmount;
  const amount = roundToNearestHundred(
    clamp(rawAmount, config.minAmount, config.maxAmount)
  );

  const aiEstimateSource: BudgetEstimateSource = params.severityScore
    ? "PHOTO_ANALYSIS"
    : "TYPE_FALLBACK";

  const aiReasoning = params.severityScore
    ? `AI photo analysis estimated a severity of ${params.severityScore.toFixed(
        1
      )}/10 for this issue type.`
    : params.hadImage
      ? "A fallback estimate was generated from the issue type because photo analysis was unavailable."
      : "A fallback estimate was generated from the issue type because no photo was provided.";

  return {
    currency: "INR",
    aiEstimatedAmount: amount,
    aiEstimatedAt: params.now,
    aiEstimateSource,
    aiEstimateConfidence: params.confidence ?? null,
    aiSeverityScore: Number(usedSeverity.toFixed(1)),
    aiReasoning,
    approvedAmount: null,
    approvedAt: null,
    approvedBy: null,
    approvalNote: null,
  };
}
