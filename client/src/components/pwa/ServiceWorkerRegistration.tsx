"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function ServiceWorkerRegistration() {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    registered.current = true;

    if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }

    const registerSW = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
        });

        console.log("[PWA] Service Worker registered with scope:", registration.scope);

        // Listen for updates
        registration.addEventListener("updatefound", () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener("statechange", () => {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // New version available
              toast("App update available!", {
                description: "Tap to refresh and get the latest version.",
                action: {
                  label: "Update",
                  onClick: () => {
                    newWorker.postMessage({ type: "SKIP_WAITING" });
                    window.location.reload();
                  },
                },
                duration: 10000,
              });
            }
          });
        });

        // Listen for messages from SW
        navigator.serviceWorker.addEventListener("message", (event) => {
          if (event.data?.type === "SYNC_OFFLINE_ISSUES") {
            // Dispatch custom event for the sync manager to handle
            window.dispatchEvent(new CustomEvent("sw-sync-issues"));
          }
        });
      } catch (error) {
        console.error("[PWA] Service Worker registration failed:", error);
      }
    };

    // Register after page load
    if (document.readyState === "complete") {
      registerSW();
    } else {
      window.addEventListener("load", registerSW);
    }
  }, []);

  return null;
}
