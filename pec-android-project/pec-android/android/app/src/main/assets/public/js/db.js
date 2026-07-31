/**
 * IndexedDB wrapper for PEC handheld.
 * Stores: operators, equipment, checklist, shifts, pendingSessions, completedSessions, sites, lockoutReasons
 */
const PecDB = (function() {
  const DB_NAME = 'pec_handheld';
  const DB_VERSION = 2;
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) { resolve(_db); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('operators'))
          db.createObjectStore('operators', { keyPath: 'operatorId' });
        if (!db.objectStoreNames.contains('equipment'))
          db.createObjectStore('equipment', { keyPath: 'equipmentId' });
        if (!db.objectStoreNames.contains('checklist'))
          db.createObjectStore('checklist', { keyPath: 'itemId' });
        if (!db.objectStoreNames.contains('shifts'))
          db.createObjectStore('shifts', { keyPath: 'shiftId' });
        if (!db.objectStoreNames.contains('pendingSessions'))
          db.createObjectStore('pendingSessions', { keyPath: 'clientGuid' });
        if (!db.objectStoreNames.contains('completedSessions'))
          db.createObjectStore('completedSessions', { keyPath: 'clientGuid' });
        if (!db.objectStoreNames.contains('sites'))
          db.createObjectStore('sites', { keyPath: 'siteId' });
        if (!db.objectStoreNames.contains('lockoutReasons'))
          db.createObjectStore('lockoutReasons', { keyPath: 'reasonId' });
      };
      req.onblocked = () => {
        console.warn('[PecDB] Upgrade blocked — close other tabs and reload');
        reject(new Error('IndexedDB upgrade blocked'));
      };
      req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
      req.onerror = (e) => reject(e.target.error);
    });
  }

  async function getAll(storeName) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(storeName, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readonly');
      const req = tx.objectStore(storeName).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function put(storeName, item) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function remove(storeName, key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function clear(storeName) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function bulkPut(storeName, items) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);
      for (const item of items) store.put(item);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { open, getAll, get, put, remove, clear, bulkPut };
})();
