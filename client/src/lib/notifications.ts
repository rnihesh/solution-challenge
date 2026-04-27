/**
 * Push Notifications - Firebase Cloud Messaging
 *
 * Handles notification permission, FCM token management,
 * and foreground message display.
 */

import { getMessaging, getToken, onMessage, isSupported } from "firebase/messaging";
import { app } from "./firebase";
import { doc, updateDoc, arrayUnion } from "firebase/firestore";
import { db } from "./firebase";
import { COLLECTIONS } from "./firebase";

let messaging: ReturnType<typeof getMessaging> | null = null;

/**
 * Initialize Firebase Cloud Messaging
 */
async function initMessaging() {
  if (messaging) return messaging;

  const supported = await isSupported();
  if (!supported) {
    console.warn("[FCM] Push notifications not supported in this browser");
    return null;
  }

  messaging = getMessaging(app);
  return messaging;
}

/**
 * Request notification permission and get FCM token
 */
export async function requestNotificationPermission(): Promise<string | null> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      console.log("[FCM] Notification permission denied");
      return null;
    }

    const msg = await initMessaging();
    if (!msg) return null;

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;

    // Get registration for the sw
    const swRegistration = await navigator.serviceWorker.getRegistration("/");

    const token = await getToken(msg, {
      vapidKey: vapidKey || undefined,
      serviceWorkerRegistration: swRegistration || undefined,
    });

    console.log("[FCM] Token obtained:", token?.slice(0, 20) + "...");
    return token;
  } catch (error) {
    console.error("[FCM] Error getting notification permission:", error);
    return null;
  }
}

/**
 * Save FCM token to user's Firestore document
 */
export async function saveFcmToken(
  uid: string,
  token: string
): Promise<void> {
  try {
    const userRef = doc(db, COLLECTIONS.USERS, uid);
    await updateDoc(userRef, {
      fcmTokens: arrayUnion(token),
    });
    console.log("[FCM] Token saved to Firestore");
  } catch (error) {
    console.error("[FCM] Error saving token:", error);
  }
}

/**
 * Setup foreground message handler
 */
export async function setupForegroundMessages(
  onMessageReceived: (payload: {
    title: string;
    body: string;
    data?: Record<string, string>;
  }) => void
): Promise<(() => void) | null> {
  const msg = await initMessaging();
  if (!msg) return null;

  const unsubscribe = onMessage(msg, (payload) => {
    console.log("[FCM] Foreground message received:", payload);

    onMessageReceived({
      title: payload.notification?.title || "CivicLemma",
      body: payload.notification?.body || "New notification",
      data: payload.data,
    });
  });

  return unsubscribe;
}

/**
 * Check if notifications are supported and permitted
 */
export function getNotificationStatus(): "granted" | "denied" | "default" | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}
