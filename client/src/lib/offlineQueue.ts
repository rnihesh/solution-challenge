/**
 * Offline Issue Queue - IndexedDB Storage
 *
 * Stores issue submissions locally when offline.
 * Issues include image blobs (since Cloudinary upload needs connectivity).
 */

const DB_NAME = "civiclemma-offline";
const DB_VERSION = 1;
const STORE_NAME = "offline-issues";

export interface OfflineIssue {
  id: string;
  description: string;
  issueType: string;
  location: {
    latitude: number;
    longitude: number;
  };
  locationDisplay: string;
  imageBlobs: Blob[];
  imageNames: string[];
  createdAt: string;
  status: "pending" | "syncing" | "synced" | "failed";
  error?: string;
  retryCount: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status", { unique: false });
        store.createIndex("createdAt", "createdAt", { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Add an issue to the offline queue
 */
export async function addToQueue(
  issue: Omit<OfflineIssue, "id" | "createdAt" | "status" | "retryCount">
): Promise<string> {
  const db = await openDB();
  const id = `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const entry: OfflineIssue = {
    ...issue,
    id,
    createdAt: new Date().toISOString(),
    status: "pending",
    retryCount: 0,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.add(entry);

    request.onsuccess = () => resolve(id);
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/**
 * Get all queued issues (optionally filtered by status)
 */
export async function getQueuedIssues(
  status?: OfflineIssue["status"]
): Promise<OfflineIssue[]> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    let request: IDBRequest;
    if (status) {
      const index = store.index("status");
      request = index.getAll(status);
    } else {
      request = store.getAll();
    }

    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/**
 * Update the status of a queued issue
 */
export async function updateQueueStatus(
  id: string,
  status: OfflineIssue["status"],
  error?: string
): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const getRequest = store.get(id);

    getRequest.onsuccess = () => {
      const issue = getRequest.result;
      if (!issue) {
        reject(new Error("Issue not found"));
        return;
      }

      issue.status = status;
      if (error) issue.error = error;
      if (status === "syncing") issue.retryCount += 1;

      const putRequest = store.put(issue);
      putRequest.onsuccess = () => resolve();
      putRequest.onerror = () => reject(putRequest.error);
    };

    getRequest.onerror = () => reject(getRequest.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * Remove a synced issue from the queue
 */
export async function removeFromQueue(id: string): Promise<void> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const request = store.delete(id);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/**
 * Get count of pending issues
 */
export async function getQueueCount(): Promise<number> {
  const db = await openDB();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("status");
    const request = index.count("pending");

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);

    tx.oncomplete = () => db.close();
  });
}

/**
 * Clear all synced issues
 */
export async function clearSynced(): Promise<void> {
  const issues = await getQueuedIssues("synced");
  for (const issue of issues) {
    await removeFromQueue(issue.id);
  }
}

/**
 * Check if there are any pending issues to sync
 */
export async function hasPendingIssues(): Promise<boolean> {
  const count = await getQueueCount();
  return count > 0;
}
