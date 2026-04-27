/**
 * Push Notification Service (Server-side)
 *
 * Sends push notifications through Firebase Cloud Messaging to
 * municipality users, platform admins, and signed-in citizens.
 */

import { getMessaging } from "firebase-admin/messaging";
import { getAdminApp, getAdminDb, COLLECTIONS } from "../shared/firebase";
import type { GeoLocation, IssueType, UserRole } from "../shared/types";
import { ISSUE_TYPE_LABELS } from "../shared/types";

interface NewIssueNotificationPayload {
  issueId: string;
  issueType: IssueType;
  description: string;
  municipalityId: string;
}

interface SosNotificationPayload {
  sosId: string;
  municipalityId: string;
  note?: string | null;
  location?: GeoLocation;
}

interface SlaBreachNotificationPayload {
  issueId: string;
  issueType: IssueType;
  municipalityId: string;
  deadlineDays: number;
  reporterUid?: string | null;
}

interface PushMessageOptions {
  title: string;
  body: string;
  data: Record<string, string>;
  link: string;
}

async function getTokensForQuery(
  query: FirebaseFirestore.Query
): Promise<string[]> {
  const snapshot = await query.get();
  const tokens = new Set<string>();

  snapshot.docs.forEach((doc) => {
    const data = doc.data();
    if (Array.isArray(data.fcmTokens)) {
      data.fcmTokens
        .filter((token: unknown): token is string => typeof token === "string" && token.length > 0)
        .forEach((token) => tokens.add(token));
    }
  });

  return Array.from(tokens);
}

async function getMunicipalityUserTokens(municipalityId: string): Promise<string[]> {
  const db = getAdminDb();
  const [primaryTokens, legacyTokens] = await Promise.all([
    getTokensForQuery(
      db
        .collection(COLLECTIONS.USERS)
        .where("role", "==", "MUNICIPALITY_USER")
        .where("municipalityId", "==", municipalityId)
    ),
    getTokensForQuery(
      db
        .collection(COLLECTIONS.USERS)
        .where("role", "==", "municipality")
        .where("municipalityId", "==", municipalityId)
    ),
  ]);

  return Array.from(new Set([...primaryTokens, ...legacyTokens]));
}

async function getRoleTokens(role: UserRole | "admin" | "municipality" | "user") {
  const db = getAdminDb();
  return getTokensForQuery(
    db.collection(COLLECTIONS.USERS).where("role", "==", role)
  );
}

async function getUserTokens(uid: string): Promise<string[]> {
  const db = getAdminDb();
  const doc = await db.collection(COLLECTIONS.USERS).doc(uid).get();
  if (!doc.exists) {
    return [];
  }

  const data = doc.data();
  if (!Array.isArray(data?.fcmTokens)) {
    return [];
  }

  return data.fcmTokens.filter(
    (token: unknown): token is string => typeof token === "string" && token.length > 0
  );
}

async function sendPushToTokens(
  tokens: string[],
  message: PushMessageOptions
): Promise<{ sent: number; failed: number }> {
  const result = { sent: 0, failed: 0 };
  const uniqueTokens = Array.from(new Set(tokens));

  if (uniqueTokens.length === 0) {
    return result;
  }

  const messaging = getMessaging(getAdminApp());
  const payload = {
    notification: {
      title: message.title,
      body: message.body,
    },
    data: message.data,
    webpush: {
      notification: {
        icon: "/icons/icon-192x192.png",
        badge: "/icons/icon-192x192.png",
        vibrate: [120, 60, 120] as any,
        requireInteraction: true,
      },
      fcmOptions: {
        link: message.link,
      },
    },
  };

  await Promise.all(
    uniqueTokens.map(async (token) => {
      try {
        await messaging.send({
          ...payload,
          token,
        });
        result.sent += 1;
      } catch (error: any) {
        result.failed += 1;
        console.warn(
          `[Notifications] Failed to send to token ${token.slice(0, 10)}...`,
          error?.message
        );

        if (
          error?.code === "messaging/registration-token-not-registered" ||
          error?.code === "messaging/invalid-registration-token"
        ) {
          await removeInvalidToken(token);
        }
      }
    })
  );

  return result;
}

/**
 * Send notification to municipality users about a new issue
 */
export async function sendNewIssueNotification(
  payload: NewIssueNotificationPayload
): Promise<{ sent: number; failed: number }> {
  try {
    const tokens = await getMunicipalityUserTokens(payload.municipalityId);
    const issueLabel = ISSUE_TYPE_LABELS[payload.issueType] || payload.issueType;

    const result = await sendPushToTokens(tokens, {
      title: "New Issue",
      body: `${issueLabel} reported in your jurisdiction. Tap to review.`,
      data: {
        issueId: payload.issueId,
        issueType: payload.issueType,
        municipalityId: payload.municipalityId,
        url: "/municipality/issues",
        type: "NEW_ISSUE",
      },
      link: "/municipality/issues",
    });

    console.log(
      `[Notifications] Sent ${result.sent}/${tokens.length} new-issue notifications for ${payload.issueId}`
    );

    return result;
  } catch (error) {
    console.error("[Notifications] Error sending new issue notifications:", error);
    return { sent: 0, failed: 0 };
  }
}

export async function sendSosNotification(
  payload: SosNotificationPayload
): Promise<void> {
  try {
    const [municipalityTokens, adminTokens, legacyAdminTokens] = await Promise.all([
      getMunicipalityUserTokens(payload.municipalityId),
      getRoleTokens("PLATFORM_MAINTAINER"),
      getRoleTokens("admin"),
    ]);

    const preview = payload.note?.trim()
      ? payload.note.trim().slice(0, 80)
      : "Immediate attention requested from a citizen.";
    const body = `Emergency SOS reported. ${preview}`;

    await Promise.all([
      sendPushToTokens(municipalityTokens, {
        title: "Emergency SOS",
        body,
        data: {
          sosId: payload.sosId,
          municipalityId: payload.municipalityId,
          type: "SOS_ALERT",
          url: "/sos",
        },
        link: "/sos",
      }),
      sendPushToTokens([...adminTokens, ...legacyAdminTokens], {
        title: "Emergency SOS",
        body,
        data: {
          sosId: payload.sosId,
          municipalityId: payload.municipalityId,
          type: "SOS_ALERT",
          url: "/sos",
        },
        link: "/sos",
      }),
    ]);
  } catch (error) {
    console.error("[Notifications] Error sending SOS notifications:", error);
  }
}

export async function sendIssueSlaBreachNotifications(
  payload: SlaBreachNotificationPayload
): Promise<void> {
  try {
    const issueLabel = ISSUE_TYPE_LABELS[payload.issueType] || payload.issueType;
    const adminBody = `${issueLabel} exceeded its ${payload.deadlineDays}-day SLA and needs escalation.`;
    const citizenBody = `Your ${issueLabel.toLowerCase()} report has crossed its resolution deadline.`;
    const municipalityBody = `${issueLabel} has breached SLA in your queue. Immediate action is required.`;

    const [municipalityTokens, adminTokens, legacyAdminTokens, reporterTokens] =
      await Promise.all([
        getMunicipalityUserTokens(payload.municipalityId),
        getRoleTokens("PLATFORM_MAINTAINER"),
        getRoleTokens("admin"),
        payload.reporterUid ? getUserTokens(payload.reporterUid) : Promise.resolve([]),
      ]);

    await Promise.all([
      sendPushToTokens(municipalityTokens, {
        title: "SLA Breach",
        body: municipalityBody,
        data: {
          issueId: payload.issueId,
          issueType: payload.issueType,
          municipalityId: payload.municipalityId,
          type: "SLA_BREACH",
          url: "/municipality/issues",
        },
        link: "/municipality/issues",
      }),
      sendPushToTokens([...adminTokens, ...legacyAdminTokens], {
        title: "SLA Escalation Alert",
        body: adminBody,
        data: {
          issueId: payload.issueId,
          issueType: payload.issueType,
          municipalityId: payload.municipalityId,
          type: "SLA_BREACH",
          url: "/admin/dashboard",
        },
        link: "/admin/dashboard",
      }),
      sendPushToTokens(reporterTokens, {
        title: "Issue Update",
        body: citizenBody,
        data: {
          issueId: payload.issueId,
          issueType: payload.issueType,
          municipalityId: payload.municipalityId,
          type: "SLA_BREACH",
          url: "/map",
        },
        link: "/map",
      }),
    ]);
  } catch (error) {
    console.error("[Notifications] Error sending SLA breach notifications:", error);
  }
}

/**
 * Remove an invalid FCM token from all user documents
 */
async function removeInvalidToken(token: string): Promise<void> {
  try {
    const db = getAdminDb();
    const admin = require("firebase-admin");

    const usersSnapshot = await db
      .collection(COLLECTIONS.USERS)
      .where("fcmTokens", "array-contains", token)
      .get();

    await Promise.all(
      usersSnapshot.docs.map((doc) =>
        doc.ref.update({
          fcmTokens: admin.firestore.FieldValue.arrayRemove(token),
        })
      )
    );
  } catch (error) {
    console.error("[Notifications] Error removing invalid token:", error);
  }
}
