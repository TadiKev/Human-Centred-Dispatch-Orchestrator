// src/tech/idb.js
const DB_NAME = "hofsmart";
const DB_VERSION = 1;
const JOB_STORE = "jobs";
const OUTBOX_STORE = "outbox";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(JOB_STORE)) {
        db.createObjectStore(JOB_STORE, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: "cid", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txCompletePromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}

export async function cacheJobs(jobs = []) {
  const db = await openDB();
  const tx = db.transaction(JOB_STORE, "readwrite");
  const store = tx.objectStore(JOB_STORE);
  for (const j of jobs) store.put(j);
  await txCompletePromise(tx);
  db.close?.();
}

export async function getAllJobs() {
  const db = await openDB();
  const tx = db.transaction(JOB_STORE, "readonly");
  const store = tx.objectStore(JOB_STORE);
  return new Promise((resolve, reject) => {
    const arr = [];
    const cur = store.openCursor();
    cur.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        arr.push(cursor.value);
        cursor.continue();
      } else {
        resolve(arr);
      }
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function getJob(id) {
  const db = await openDB();
  const tx = db.transaction(JOB_STORE, "readonly");
  const store = tx.objectStore(JOB_STORE);
  return new Promise((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export async function putJob(job) {
  const db = await openDB();
  const tx = db.transaction(JOB_STORE, "readwrite");
  const store = tx.objectStore(JOB_STORE);
  store.put(job);
  await txCompletePromise(tx);
  db.close?.();
}

export async function queueEvent(event) {
  const db = await openDB();
  const tx = db.transaction(OUTBOX_STORE, "readwrite");
  const store = tx.objectStore(OUTBOX_STORE);
  const record = {
    event: event.event,
    payload: event.payload || {},
    client_ts: event.client_ts || new Date().toISOString(),
    queued_at: new Date().toISOString(),
  };
  return new Promise((resolve, reject) => {
    const req = store.add(record);
    req.onsuccess = () => {
      const key = req.result;
      tx.oncomplete = () => {
        db.close?.();
        resolve(key);
      };
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getOutbox() {
  const db = await openDB();
  const tx = db.transaction(OUTBOX_STORE, "readonly");
  const store = tx.objectStore(OUTBOX_STORE);
  return new Promise((resolve, reject) => {
    const arr = [];
    const cur = store.openCursor();
    cur.onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        arr.push({ cid: cursor.key, ...cursor.value });
        cursor.continue();
      } else {
        resolve(arr);
      }
    };
    cur.onerror = () => reject(cur.error);
  });
}

export async function removeOutboxItem(cid) {
  const db = await openDB();
  const tx = db.transaction(OUTBOX_STORE, "readwrite");
  const store = tx.objectStore(OUTBOX_STORE);
  store.delete(cid);
  await txCompletePromise(tx);
  db.close?.();
}
