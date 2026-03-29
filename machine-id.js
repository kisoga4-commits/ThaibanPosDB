/**
 * Standalone Triple Layer Persistent Seed module.
 * Vanilla JS (ES6), no external dependencies.
 *
 * Note: Client-side storage can be tampered with by a determined attacker.
 * This module focuses on resilience + tamper-evidence + self-healing.
 */

const IDB_DB_NAME = 'sec-layer-db';
const IDB_STORE_NAME = 'machine-seed-store';
const IDB_KEY = 'machine-seed-record';

const CACHE_NAME = 'sec-layer-cache';
const CACHE_KEY_URL = '/__sec_seed_record__';

const LS_RECORD_KEY = 'sec_seed_record';
const LS_SEED_KEY = 'sec_seed_id';
const LS_TS_KEY = 'sec_first_install_ts';
const LS_FP_KEY = 'sec_canvas_fp';

const RECORD_VERSION = 'v1';

function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0'));
  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}

function isValidUUID(value) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}

function safeNowISO() {
  try {
    return new Date().toISOString();
  } catch (_error) {
    return '';
  }
}

function getCanvasFingerprint() {
  try {
    if (typeof document === 'undefined') return 'no-document';

    const canvas = document.createElement('canvas');
    canvas.width = 260;
    canvas.height = 100;

    const ctx = canvas.getContext('2d');
    if (!ctx) return 'no-2d-context';

    ctx.textBaseline = 'top';
    ctx.font = "16px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 10, 200, 50);
    ctx.fillStyle = '#069';
    ctx.fillText('triple-layer-seed', 14, 16);
    ctx.fillStyle = 'rgba(120, 30, 220, 0.8)';
    ctx.fillText(navigator.userAgent || 'ua', 14, 42);

    return canvas.toDataURL();
  } catch (_error) {
    return 'fp-error';
  }
}

function fallbackHash(input) {
  let hash = 2166136261;
  const text = String(input || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

async function sha256Hex(input) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
      const data = new TextEncoder().encode(String(input || ''));
      const digest = await crypto.subtle.digest('SHA-256', data);
      const bytes = Array.from(new Uint8Array(digest));
      return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (_error) {
    // fallback below
  }

  return fallbackHash(input);
}

async function buildRecord(machineId, installTimestamp, fingerprint) {
  const fpDigest = await sha256Hex(fingerprint);
  const integrity = await sha256Hex(`${RECORD_VERSION}|${machineId}|${installTimestamp}|${fpDigest}`);

  return {
    version: RECORD_VERSION,
    machineId,
    installTimestamp,
    fpDigest,
    integrity,
  };
}

async function validateRecord(record) {
  try {
    if (!record || typeof record !== 'object') return null;
    const machineId = record.machineId;
    const installTimestamp = record.installTimestamp;
    const fpDigest = record.fpDigest;
    const integrity = record.integrity;

    if (!isValidUUID(machineId)) return null;
    if (typeof installTimestamp !== 'string' || !installTimestamp) return null;
    if (typeof fpDigest !== 'string' || !fpDigest) return null;
    if (typeof integrity !== 'string' || !integrity) return null;

    const recomputed = await sha256Hex(`${RECORD_VERSION}|${machineId}|${installTimestamp}|${fpDigest}`);
    if (recomputed !== integrity) return null;

    return {
      version: RECORD_VERSION,
      machineId,
      installTimestamp,
      fpDigest,
      integrity,
    };
  } catch (_error) {
    return null;
  }
}

function serializeRecord(record) {
  try {
    return JSON.stringify(record);
  } catch (_error) {
    return '';
  }
}

function parseRecord(raw) {
  try {
    if (!raw || typeof raw !== 'string') return null;
    return JSON.parse(raw);
  } catch (_error) {
    return null;
  }
}

function openIdb() {
  return new Promise((resolve, reject) => {
    try {
      if (typeof window === 'undefined' || !('indexedDB' in window)) {
        reject(new Error('IndexedDB unavailable'));
        return;
      }

      const req = window.indexedDB.open(IDB_DB_NAME, 1);

      req.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
          db.createObjectStore(IDB_STORE_NAME);
        }
      };

      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB open failed'));
    } catch (error) {
      reject(error);
    }
  });
}

async function readFromIndexedDB() {
  try {
    const db = await openIdb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_STORE_NAME);
      const req = store.get(IDB_KEY);

      req.onsuccess = () => resolve(typeof req.result === 'string' ? req.result : null);
      req.onerror = () => reject(req.error || new Error('IndexedDB read failed'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    });
  } catch (_error) {
    return null;
  }
}

async function writeToIndexedDB(rawRecord) {
  try {
    const db = await openIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE_NAME, 'readwrite');
      tx.objectStore(IDB_STORE_NAME).put(rawRecord, IDB_KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB write aborted'));
    });
    db.close();
    return true;
  } catch (_error) {
    return false;
  }
}

async function readFromCache() {
  try {
    if (typeof window === 'undefined' || !('caches' in window)) return null;
    const cache = await window.caches.open(CACHE_NAME);
    const response = await cache.match(CACHE_KEY_URL);
    if (!response) return null;

    const value = await response.text();
    return value || null;
  } catch (_error) {
    return null;
  }
}

async function writeToCache(rawRecord) {
  try {
    if (typeof window === 'undefined' || !('caches' in window)) return false;
    const cache = await window.caches.open(CACHE_NAME);
    const response = new Response(rawRecord, {
      headers: { 'content-type': 'application/json;charset=utf-8' },
    });
    await cache.put(CACHE_KEY_URL, response);
    return true;
  } catch (_error) {
    return false;
  }
}

function readFromLocalStorage() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(LS_RECORD_KEY);
  } catch (_error) {
    return null;
  }
}

function writeToLocalStorage(rawRecord, machineId, installTimestamp, fingerprint) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;

    window.localStorage.setItem(LS_RECORD_KEY, rawRecord);
    window.localStorage.setItem(LS_SEED_KEY, machineId);

    const existingTs = window.localStorage.getItem(LS_TS_KEY);
    if (!existingTs) {
      window.localStorage.setItem(LS_TS_KEY, installTimestamp || safeNowISO());
    }

    window.localStorage.setItem(LS_FP_KEY, fingerprint);
    return true;
  } catch (_error) {
    return false;
  }
}

function selectCanonicalRecord(validRecords) {
  if (!validRecords.length) return null;

  const buckets = new Map();
  for (const record of validRecords) {
    const key = record.machineId;
    if (!buckets.has(key)) {
      buckets.set(key, []);
    }
    buckets.get(key).push(record);
  }

  let bestGroup = [];
  for (const group of buckets.values()) {
    if (group.length > bestGroup.length) {
      bestGroup = group;
    } else if (group.length === bestGroup.length && group.length > 0) {
      const groupTs = group[0].installTimestamp;
      const bestTs = bestGroup[0]?.installTimestamp || '';
      if (groupTs < bestTs) {
        bestGroup = group;
      }
    }
  }

  return bestGroup[0] || validRecords[0] || null;
}

/**
 * Get or generate machine ID using triple-layer persistence with self-healing.
 * @returns {Promise<{machineId: string, installTimestamp: string, fingerprint: string}>}
 */
export async function getOrGenerateMachineID() {
  const fingerprint = getCanvasFingerprint();

  const [idbRaw, cacheRaw, lsRaw] = await Promise.all([
    readFromIndexedDB(),
    readFromCache(),
    Promise.resolve(readFromLocalStorage()),
  ]);

  const [idbRecord, cacheRecord, lsRecord] = await Promise.all([
    validateRecord(parseRecord(idbRaw)),
    validateRecord(parseRecord(cacheRaw)),
    validateRecord(parseRecord(lsRaw)),
  ]);

  const validRecords = [idbRecord, cacheRecord, lsRecord].filter(Boolean);
  const canonical = selectCanonicalRecord(validRecords);

  const machineId = canonical?.machineId || generateUUID();
  const installTimestamp = canonical?.installTimestamp || safeNowISO();
  const newRecord = await buildRecord(machineId, installTimestamp, fingerprint);
  const rawRecord = serializeRecord(newRecord);

  const repairTasks = [];

  const idbNeedsRepair = !idbRecord || idbRecord.machineId !== machineId;
  const cacheNeedsRepair = !cacheRecord || cacheRecord.machineId !== machineId;
  const lsNeedsRepair = !lsRecord || lsRecord.machineId !== machineId;

  if (idbNeedsRepair) repairTasks.push(writeToIndexedDB(rawRecord));
  if (cacheNeedsRepair) repairTasks.push(writeToCache(rawRecord));
  if (lsNeedsRepair) {
    repairTasks.push(Promise.resolve(writeToLocalStorage(rawRecord, machineId, installTimestamp, fingerprint)));
  } else {
    writeToLocalStorage(rawRecord, machineId, installTimestamp, fingerprint);
  }

  try {
    await Promise.all(repairTasks);
  } catch (_error) {
    // fail-open
  }

  let finalInstallTimestamp = installTimestamp;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      finalInstallTimestamp = window.localStorage.getItem(LS_TS_KEY) || installTimestamp;
    }
  } catch (_error) {
    // keep fallback timestamp
  }

  return {
    machineId,
    installTimestamp: finalInstallTimestamp,
    fingerprint,
  };
}
