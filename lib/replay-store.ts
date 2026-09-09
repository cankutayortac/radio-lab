import { validRecording, type FlightRecording } from './flight-review.ts';
import {
  validDraft,
  resumeDraft,
  validSavedResult,
  type FlightDraft,
} from './flight-session.ts';
import type { FlightResult } from './training.ts';

// This app's existing flight log is explicitly device-local. Large recordings
// are separate from its localStorage summaries so quota cannot erase the log.
export const RECORDING_LIMIT = 20;
const DB_NAME = 'radio-lab-flight-recordings';
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Yerel kayıt kullanılamıyor.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 2);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error('Yerel kayıt açılmadı.'));
    }, 6000);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains('recordings')
        ? request.transaction!.objectStore('recordings')
        : db.createObjectStore('recordings', { keyPath: 'id' });
      if (!store.indexNames.contains('savedOrder'))
        store.createIndex('savedOrder', 'savedOrder');
      if (!db.objectStoreNames.contains('drafts'))
        db.createObjectStore('drafts', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      clearTimeout(timeout);
      settled = true;
      reject(request.error);
    };
    request.onblocked = () => {
      clearTimeout(timeout);
      settled = true;
      reject(new Error('Başka sekme yerel kaydı kilitliyor.'));
    };
  });
}
export async function saveRecording(record: FlightRecording) {
  if (!validRecording(record)) throw new Error('Uçuş kaydı doğrulanamadı.');
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(['recordings', 'drafts'], 'readwrite');
      const store = tx.objectStore('recordings');
      const draftStore = tx.objectStore('drafts');
      const existing = draftStore.get(record.id);
      existing.onsuccess = () => {
        if (
          existing.result?.closed === 'resumed' ||
          existing.result?.closed === 'discarded'
        ) {
          tx.abort();
          return;
        }
        // Completion and checkpoint retirement are atomic. Late autosaves cannot resurrect it.
        draftStore.put({
          ...existing.result,
          id: record.id,
          closed: 'finished',
        });
        // A serialized, monotonic insertion order is independent of the device clock.
        const newest = store.index('savedOrder').openKeyCursor(null, 'prev');
        newest.onsuccess = () => {
          const savedOrder = Number(newest.result?.key ?? 0) + 1;
          store.put({ ...record, savedOrder });
          const request = store.index('savedOrder').openKeyCursor(null, 'prev');
          let count = 0;
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (++count > RECORDING_LIMIT) store.delete(cursor.primaryKey);
            cursor.continue();
          };
        };
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Kayıt yazılamadı.'));
      tx.onerror = () => reject(tx.error ?? new Error('Yerel kayıt dolu.'));
    });
  } finally {
    db.close();
  }
}

export async function saveDraft(draft: FlightDraft): Promise<boolean> {
  if (!validDraft(draft)) throw new Error('Ara kayıt doğrulanamadı.');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'),
        store = tx.objectStore('drafts');
      const get = store.get(draft.id);
      let saved = false;
      get.onsuccess = () => {
        if (get.result?.closed) return;
        if (get.result?.revision > draft.revision) {
          saved = true;
          return;
        }
        store.put(draft);
        saved = true;
      };
      tx.oncomplete = () => resolve(saved);
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error('Ara kayıt yazılamadı.'));
    });
  } finally {
    db.close();
  }
}

// Seal the checkpoint and its small result first. A large replay/quota failure
// must not turn a finished flight back into an unfinished checkpoint.
export async function finalizeDraft(result: FlightResult): Promise<boolean> {
  if (!validSavedResult(result)) throw new Error('Uçuş sonucu doğrulanamadı.');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'),
        store = tx.objectStore('drafts');
      const request = store.get(result.id);
      let accepted = false;
      request.onsuccess = () => {
        if (request.result?.closed) return;
        store.put({ id: result.id, closed: 'finished', result });
        accepted = true;
      };
      tx.oncomplete = () => resolve(accepted);
      tx.onerror = tx.onabort = () =>
        reject(tx.error ?? new Error('Uçuş sonlandırılamadı.'));
    });
  } finally {
    db.close();
  }
}
export async function savedResults(): Promise<FlightResult[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readonly'),
        request = tx.objectStore('drafts').getAll();
      request.onsuccess = () =>
        resolve(
          request.result
            .filter(
              (r) => r?.closed === 'finished' && validSavedResult(r.result),
            )
            .map((r) => r.result)
            .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
            .slice(0, 50),
        );
      request.onerror = tx.onabort = () => reject(request.error ?? tx.error);
    });
  } finally {
    db.close();
  }
}
export async function listDrafts(): Promise<FlightDraft[]> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readonly'),
        request = tx.objectStore('drafts').getAll();
      request.onsuccess = () =>
        resolve(
          request.result
            .filter(validDraft)
            .sort((a, b) => b.savedAt - a.savedAt),
        );
      request.onerror = tx.onabort = () => reject(request.error ?? tx.error);
    });
  } finally {
    db.close();
  }
}
// Claim a checkpoint once, in one transaction. Resumption gets a NEW flight id;
// the old id keeps a tiny tombstone so another tab's late write cannot clobber it.
export async function retireDraft(
  id: string,
  reason: 'resumed' | 'discarded',
  replacement?: { id: string; date: string },
): Promise<FlightDraft | null> {
  if (reason === 'resumed' && (!replacement || replacement.id === id))
    throw new Error('Yeni uçuş kimliği gerekli.');
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', 'readwrite'),
        store = tx.objectStore('drafts');
      const get = store.get(id);
      let draft: FlightDraft | null = null;
      get.onsuccess = () => {
        if (!validDraft(get.result)) return;
        draft = get.result;
        if (reason === 'resumed' && replacement) {
          draft = {
            ...resumeDraft(draft!),
            ...replacement,
            savedAt: Date.now(),
            revision: 0,
          };
          store.put(draft);
        }
        store.put({ id, closed: reason });
      };
      tx.oncomplete = () => resolve(draft);
      tx.onabort = tx.onerror = () =>
        reject(tx.error ?? new Error('Ara kayıt açılamadı.'));
    });
  } finally {
    db.close();
  }
}
export async function readRecording(
  id: string,
): Promise<FlightRecording | null> {
  const db = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('recordings', 'readonly');
      const request = tx.objectStore('recordings').get(id);
      request.onsuccess = () =>
        resolve(
          validRecording(request.result) && request.result.id === id
            ? request.result
            : null,
        );
      request.onerror = () => reject(request.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
