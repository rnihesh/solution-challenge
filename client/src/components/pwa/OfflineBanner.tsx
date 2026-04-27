"use client";

import { useNetwork } from "@/contexts/NetworkContext";
import { WifiOff, Wifi, CloudUpload } from "lucide-react";

export function OfflineBanner() {
  const { isOnline, wasOffline, pendingCount } = useNetwork();

  // Back online notification
  if (isOnline && wasOffline) {
    return (
      <div className="bg-emerald-600 text-white px-4 py-2 text-center text-sm font-medium animate-in slide-in-from-top-2 duration-300 flex items-center justify-center gap-2">
        <Wifi className="h-4 w-4" />
        <span>You&apos;re back online!</span>
        {pendingCount > 0 && (
          <span className="flex items-center gap-1 ml-2 bg-white/20 rounded-full px-2.5 py-0.5 text-xs">
            <CloudUpload className="h-3 w-3" />
            Syncing {pendingCount} issue{pendingCount > 1 ? "s" : ""}...
          </span>
        )}
      </div>
    );
  }

  // Offline banner
  if (!isOnline) {
    return (
      <div className="bg-amber-600 text-white px-4 py-2 text-center text-sm font-medium animate-in slide-in-from-top-2 duration-300 flex items-center justify-center gap-2">
        <WifiOff className="h-4 w-4" />
        <span>You&apos;re offline — you can still report issues</span>
        {pendingCount > 0 && (
          <span className="bg-white/20 rounded-full px-2.5 py-0.5 text-xs ml-2">
            {pendingCount} pending
          </span>
        )}
      </div>
    );
  }

  return null;
}
