/* A tiny key-value store on IndexedDB, for data that is too large for the
   synced document and belongs on the device: the background image, gym
   history, bank transactions. Shares the database theme.js already uses. */
function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('hq-assets', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction('kv', mode), req = fn(t.objectStore('kv'));
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Storage is full or blocked.'));
  });
}
export const idbGet = async key => { try { return (await tx('readonly', s => s.get(key))) ?? null; } catch { return null; } };
export const idbSet = (key, value) => tx('readwrite', s => s.put(value, key));
export const idbDel = async key => { try { await tx('readwrite', s => s.delete(key)); } catch { /* nothing stored */ } };
