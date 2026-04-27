/**
 * Sync Manager - Background sync for offline issue submissions
 *
 * When connectivity is restored, syncs queued issues:
 * 1. Upload images to Cloudinary
 * 2. Submit issue to API
 * 3. Update queue status
 */

import { uploadImages } from "./cloudinary";
import {
  getQueuedIssues,
  updateQueueStatus,
  removeFromQueue,
  getQueueCount,
  type OfflineIssue,
} from "./offlineQueue";
import { config } from "./config";

const API_BASE_URL = config.api.baseUrl;

export interface SyncResult {
  total: number;
  synced: number;
  failed: number;
  results: Array<{
    id: string;
    success: boolean;
    error?: string;
  }>;
}

let isSyncing = false;
let syncProgressCallback: ((progress: SyncProgress) => void) | null = null;

export interface SyncProgress {
  current: number;
  total: number;
  currentId: string;
  phase: "uploading" | "submitting" | "done";
}

export function onSyncProgress(callback: (progress: SyncProgress) => void) {
  syncProgressCallback = callback;
  return () => {
    syncProgressCallback = null;
  };
}

/**
 * Sync all pending offline issues
 */
export async function syncOfflineIssues(): Promise<SyncResult> {
  if (isSyncing) {
    return { total: 0, synced: 0, failed: 0, results: [] };
  }

  isSyncing = true;

  const result: SyncResult = {
    total: 0,
    synced: 0,
    failed: 0,
    results: [],
  };

  try {
    const pendingIssues = await getQueuedIssues("pending");
    // Also retry failed issues with less than 3 retries
    const failedIssues = (await getQueuedIssues("failed")).filter(
      (i) => i.retryCount < 3
    );
    const issuesToSync = [...pendingIssues, ...failedIssues];

    result.total = issuesToSync.length;

    if (issuesToSync.length === 0) {
      isSyncing = false;
      return result;
    }

    for (let i = 0; i < issuesToSync.length; i++) {
      const issue = issuesToSync[i];
      try {
        await syncSingleIssue(issue, i, issuesToSync.length);
        result.synced++;
        result.results.push({ id: issue.id, success: true });
      } catch (error) {
        result.failed++;
        result.results.push({
          id: issue.id,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    // Report completion
    if (syncProgressCallback) {
      syncProgressCallback({
        current: result.total,
        total: result.total,
        currentId: "",
        phase: "done",
      });
    }
  } catch (error) {
    console.error("[Sync] Error during sync:", error);
  } finally {
    isSyncing = false;
  }

  return result;
}

async function syncSingleIssue(
  issue: OfflineIssue,
  index: number,
  total: number
): Promise<void> {
  // Mark as syncing
  await updateQueueStatus(issue.id, "syncing");

  // Report progress: uploading
  if (syncProgressCallback) {
    syncProgressCallback({
      current: index + 1,
      total,
      currentId: issue.id,
      phase: "uploading",
    });
  }

  let imageUrls: string[] = [];

  // Upload images if present
  if (issue.imageBlobs && issue.imageBlobs.length > 0) {
    try {
      const files = issue.imageBlobs.map(
        (blob, idx) =>
          new File(
            [blob],
            issue.imageNames?.[idx] || `offline-issue-${Date.now()}-${idx}.jpg`,
            { type: blob.type || "image/jpeg" }
          )
      );

      const { urls, errors } = await uploadImages(files);
      imageUrls = urls;

      if (errors.length > 0 && urls.length === 0) {
        throw new Error("Failed to upload all images: " + errors.join(", "));
      }
    } catch (error) {
      console.error("[Sync] Image upload failed for issue:", issue.id, error);
      await updateQueueStatus(
        issue.id,
        "failed",
        "Image upload failed: " +
          (error instanceof Error ? error.message : "Unknown error")
      );
      throw error;
    }
  }

  // Report progress: submitting
  if (syncProgressCallback) {
    syncProgressCallback({
      current: index + 1,
      total,
      currentId: issue.id,
      phase: "submitting",
    });
  }

  // Submit to API
  try {
    const response = await fetch(`${API_BASE_URL}/issues`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        description: issue.description,
        type: issue.issueType,
        location: issue.location,
        imageUrls: imageUrls,
      }),
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || "Failed to submit issue");
    }

    // Success - remove from queue
    await removeFromQueue(issue.id);
    console.log("[Sync] Issue synced successfully:", issue.id);
  } catch (error) {
    console.error("[Sync] Issue submission failed:", issue.id, error);
    await updateQueueStatus(
      issue.id,
      "failed",
      "Submission failed: " +
        (error instanceof Error ? error.message : "Unknown error")
    );
    throw error;
  }
}

/**
 * Check if sync is in progress
 */
export function isSyncInProgress(): boolean {
  return isSyncing;
}

/**
 * Get the number of issues waiting to sync
 */
export async function getPendingSyncCount(): Promise<number> {
  return getQueueCount();
}

/**
 * Register for background sync via service worker
 */
export async function registerBackgroundSync(): Promise<void> {
  if ("serviceWorker" in navigator && "SyncManager" in window) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await (registration as any).sync.register("sync-offline-issues");
      console.log("[Sync] Background sync registered");
    } catch (error) {
      console.warn("[Sync] Background sync registration failed:", error);
      // Fallback: sync immediately
      await syncOfflineIssues();
    }
  }
}
