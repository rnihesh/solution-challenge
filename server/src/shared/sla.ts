import type { IssueSla, IssueType } from "./types";

export const ISSUE_SLA_DAYS: Record<IssueType, number> = {
  POTHOLE: 7,
  GARBAGE: 3,
  ILLEGAL_PARKING: 2,
  DAMAGED_SIGN: 5,
  FALLEN_TREE: 2,
  VANDALISM: 5,
  DEAD_ANIMAL: 2,
  DAMAGED_CONCRETE: 10,
  DAMAGED_ELECTRICAL: 3,
};

export function buildIssueSla(
  issueType: IssueType,
  createdAt: Date
): IssueSla {
  const deadlineDays = ISSUE_SLA_DAYS[issueType];
  const dueAt = new Date(createdAt.getTime() + deadlineDays * 24 * 60 * 60 * 1000);

  return {
    deadlineDays,
    dueAt,
    breachedAt: null,
    breachAlertSentAt: null,
  };
}

export function isSlaBreached(sla: IssueSla | null | undefined, now = new Date()) {
  if (!sla?.dueAt) {
    return false;
  }

  return sla.dueAt.getTime() <= now.getTime();
}
