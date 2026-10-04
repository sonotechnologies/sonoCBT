/**
 * The exam's on-device store: one record per attempt in IndexedDB. Written
 * before anything is sent to the server, so a dropped connection, closed tab or
 * flat battery loses nothing. No library, to keep the runtime small.
 */
import type { LocalState } from "@/lib/exams/local";

const DB = "sonocbt-exam";
const STORE = "attempts";

let opening: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  if (opening) return opening;
  opening = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "attemptId" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

export async function loadLocal(attemptId: string): Promise<LocalState | null> {
  const db = await open();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(attemptId);
      req.onsuccess = () => resolve((req.result as LocalState | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Resolves once the write is durable (transaction complete). False if storage isn't available. */
export async function saveLocal(state: LocalState): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(state);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

/** After a confirmed submission, answers don't need to stay on a shared lab computer. */
export async function clearLocal(attemptId: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(attemptId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Can this browser keep answers on the device? (Private windows sometimes can't.) */
export async function storageWorks(): Promise<boolean> {
  return (await open()) !== null;
}
