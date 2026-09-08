import { validRecording, type FlightRecording } from './flight-review.ts';

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
    const request = indexedDB.open(DB_NAME, 1);
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      reject(new Error('Yerel kayıt açılmadı.'));
    }, 6000);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('recordings', {
        keyPath: 'id',
      });
      store.createIndex('savedOrder', 'savedOrder');
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
      const tx = db.transaction('recordings', 'readwrite');
      const store = tx.objectStore('recordings');
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
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Kayıt yazılamadı.'));
      tx.onerror = () => reject(tx.error ?? new Error('Yerel kayıt dolu.'));
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
