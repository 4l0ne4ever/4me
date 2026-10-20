// The reader's own wallpaper, kept in this browser's IndexedDB. It is never sent anywhere.
import { fitWithin } from "./wallpaper";

const DB = "4me";
const STORE = "files";
const KEY = "wallpaper";
const MAX_SIDE = 2560;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function loadUpload(): Promise<Blob | null> {
  try {
    return (await run<Blob | undefined>("readonly", (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function saveUpload(blob: Blob): Promise<void> {
  await run("readwrite", (s) => s.put(blob, KEY));
}

export async function deleteUpload(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    // nothing stored, nothing to remove
  }
}

/**
 * Decodes the picture and re-encodes it as JPEG at most `maxSide` px on its longest side, so storage stays small.
 * Re-encoding also drops whatever metadata the file carried (EXIF, GPS), after applying its rotation.
 */
export async function shrink(file: Blob, maxSide = MAX_SIDE): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/jpeg", 0.86),
    );
  } finally {
    bitmap.close();
  }
}
