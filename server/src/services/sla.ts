import { COLLECTIONS, getAdminDb } from "../shared/firebase";
import { buildIssueSla, isSlaBreached } from "../shared/sla";
import type { IssueSla, IssueType } from "../shared/types";
import { sendIssueSlaBreachNotifications } from "./notifications";

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
let monitorStarted = false;
let monitorRunning = false;

function toDate(value: any): Date | null {
  if (!value) {
    return null;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeSla(issueType: IssueType, createdAt: Date, rawSla: any): IssueSla {
  const fallback = buildIssueSla(issueType, createdAt);

  return {
    deadlineDays:
      typeof rawSla?.deadlineDays === "number" && rawSla.deadlineDays > 0
        ? rawSla.deadlineDays
        : fallback.deadlineDays,
    dueAt: toDate(rawSla?.dueAt) ?? fallback.dueAt,
    breachedAt: toDate(rawSla?.breachedAt),
    breachAlertSentAt: toDate(rawSla?.breachAlertSentAt),
  };
}

async function processBreachedIssue(
  issueDoc: FirebaseFirestore.QueryDocumentSnapshot,
  now: Date
) {
  const db = getAdminDb();
  const data = issueDoc.data();
  const issueType = data.type as IssueType | undefined;
  const createdAt = toDate(data.createdAt);

  if (!issueType || !createdAt || data.status !== "OPEN") {
    return;
  }

  const normalizedSla = normalizeSla(issueType, createdAt, data.sla);
  if (!isSlaBreached(normalizedSla, now)) {
    if (!data.sla) {
      await issueDoc.ref.update({
        sla: normalizedSla,
        updatedAt: now,
      });
    }
    return;
  }

  const notificationPayload = await db.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(issueDoc.ref);
    if (!latestSnap.exists) {
      return null;
    }

    const latest = latestSnap.data();
    if (!latest || latest.status !== "OPEN") {
      return null;
    }

    const latestCreatedAt = toDate(latest.createdAt);
    const latestType = latest.type as IssueType | undefined;
    if (!latestCreatedAt || !latestType) {
      return null;
    }

    const latestSla = normalizeSla(latestType, latestCreatedAt, latest.sla);
    if (!isSlaBreached(latestSla, now) || latestSla.breachAlertSentAt) {
      if (!latest.sla) {
        transaction.update(issueDoc.ref, {
          sla: latestSla,
          updatedAt: now,
        });
      }
      return null;
    }

    transaction.update(issueDoc.ref, {
      sla: {
        ...latestSla,
        breachedAt: latestSla.breachedAt ?? now,
        breachAlertSentAt: now,
      },
      updatedAt: now,
    });

    return {
      issueId: issueDoc.id,
      issueType: latestType,
      municipalityId: latest.municipalityId as string,
      reporterUid: (latest.reporterUid as string | null | undefined) ?? null,
      deadlineDays: latestSla.deadlineDays,
    };
  });

  if (notificationPayload) {
    await sendIssueSlaBreachNotifications(notificationPayload);
  }
}

export async function runSlaSweep(): Promise<void> {
  if (monitorRunning) {
    return;
  }

  monitorRunning = true;
  try {
    const db = getAdminDb();
    const now = new Date();
    const openIssuesSnapshot = await db
      .collection(COLLECTIONS.ISSUES)
      .where("status", "==", "OPEN")
      .get();

    for (const issueDoc of openIssuesSnapshot.docs) {
      await processBreachedIssue(issueDoc, now);
    }
  } catch (error) {
    console.error("[SLA] Sweep failed:", error);
  } finally {
    monitorRunning = false;
  }
}

export function startSlaMonitor(intervalMs = DEFAULT_INTERVAL_MS) {
  if (monitorStarted) {
    return;
  }

  monitorStarted = true;
  void runSlaSweep();

  const timer = setInterval(() => {
    void runSlaSweep();
  }, intervalMs);

  timer.unref?.();
  console.log(`[SLA] Monitor started with ${Math.round(intervalMs / 1000)}s interval`);
}
