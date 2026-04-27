"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useNetwork } from "@/contexts/NetworkContext";
import {
  syncOfflineIssues,
  onSyncProgress,
  type SyncProgress,
  type SyncResult,
} from "@/lib/syncManager";
import { getQueueCount } from "@/lib/offlineQueue";
import { toast } from "sonner";
import { CloudUpload, Check, AlertCircle, Loader2 } from "lucide-react";

export function SyncStatusIndicator() {
  const { isOnline, setPendingCount } = useNetwork();
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);
  const [showResult, setShowResult] = useState(false);
  const hasSynced = useRef(false);

  // Update pending count periodically
  const refreshPendingCount = useCallback(async () => {
    try {
      const count = await getQueueCount();
      setPendingCount(count);
    } catch {
      // IndexedDB might not be available
    }
  }, [setPendingCount]);

  // Auto sync when coming online
  useEffect(() => {
    if (isOnline && !hasSynced.current) {
      hasSynced.current = true;
      const doSync = async () => {
        const count = await getQueueCount();
        if (count > 0) {
          const result = await syncOfflineIssues();
          setLastResult(result);
          setShowResult(true);

          if (result.synced > 0) {
            toast.success(
              `${result.synced} issue${result.synced > 1 ? "s" : ""} synced successfully!`,
              {
                description:
                  result.failed > 0
                    ? `${result.failed} failed — they'll retry automatically.`
                    : "All offline reports have been submitted.",
              }
            );
          }

          if (result.failed > 0 && result.synced === 0) {
            toast.error("Failed to sync offline issues", {
              description: "They'll retry when you're next online.",
            });
          }

          // Hide result after delay
          setTimeout(() => {
            setShowResult(false);
            setLastResult(null);
          }, 5000);

          refreshPendingCount();
        }
      };

      doSync();
    }

    if (!isOnline) {
      hasSynced.current = false;
    }
  }, [isOnline, refreshPendingCount]);

  // Listen for sync progress
  useEffect(() => {
    const unsubscribe = onSyncProgress((p) => {
      setProgress(p.phase === "done" ? null : p);
    });
    return unsubscribe;
  }, []);

  // Listen for SW-triggered sync
  useEffect(() => {
    const handler = () => {
      syncOfflineIssues().then((result) => {
        setLastResult(result);
        setShowResult(true);
        refreshPendingCount();
        setTimeout(() => {
          setShowResult(false);
          setLastResult(null);
        }, 5000);
      });
    };

    window.addEventListener("sw-sync-issues", handler);
    return () => window.removeEventListener("sw-sync-issues", handler);
  }, [refreshPendingCount]);

  // Refresh count on mount
  useEffect(() => {
    refreshPendingCount();
  }, [refreshPendingCount]);

  // Show sync progress
  if (progress) {
    return (
      <div className="fixed bottom-20 right-4 z-50 animate-in slide-in-from-right-5 duration-300">
        <div className="bg-card border border-border rounded-xl shadow-lg px-4 py-3 flex items-center gap-3 min-w-[220px]">
          <Loader2 className="h-5 w-5 text-emerald-500 animate-spin flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">
              Syncing issues...
            </p>
            <p className="text-xs text-muted-foreground">
              {progress.current}/{progress.total} —{" "}
              {progress.phase === "uploading"
                ? "Uploading photos"
                : "Submitting report"}
            </p>
            <div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-300"
                style={{
                  width: `${(progress.current / progress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Show sync result briefly
  if (showResult && lastResult && lastResult.total > 0) {
    const isSuccess = lastResult.failed === 0;
    return (
      <div className="fixed bottom-20 right-4 z-50 animate-in slide-in-from-right-5 duration-300">
        <div className="bg-card border border-border rounded-xl shadow-lg px-4 py-3 flex items-center gap-3">
          {isSuccess ? (
            <Check className="h-5 w-5 text-emerald-500 flex-shrink-0" />
          ) : (
            <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
          )}
          <div>
            <p className="text-xs font-medium text-foreground">
              {isSuccess ? "All synced!" : "Sync partially complete"}
            </p>
            <p className="text-xs text-muted-foreground">
              {lastResult.synced} synced
              {lastResult.failed > 0
                ? `, ${lastResult.failed} failed`
                : ""}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
