'use strict';

// db/sync-firebase.js — runs in the Electron MAIN process only.
// Cloud FIRESTORE (not Realtime Database) is the sync backbone. Local
// login (db.js / verifyLogin) is completely untouched and still works fully
// offline — this module only pushes/pulls DATA in the background whenever
// the machine happens to have internet.
//
// Data layout: one Firestore collection per local collection, one document
// per record, keyed by its own primary key — e.g.
//   /users/{username}
//   /fee_catalog_templates/{templateId}
//   /payments/{paymentId}
// setDoc() always overwrites the full document at that path, so writes are
// naturally idempotent — re-pushing the same record just overwrites the
// same document, never duplicates.
//
// Unlike Realtime Database, Firestore doesn't use a separate databaseURL —
// the same apiKey/projectId in firebase-config.js is the whole connection.

const { initializeApp } = require('firebase/app');
const { getAuth, signInAnonymously } = require('firebase/auth');
const {
  getFirestore,
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  where
} = require('firebase/firestore');

const { initDatabase, getStationId, upsertMutableRecord } = require('./db');
const firebaseConfig = require('./firebase-config');

// Append-only ledger facts: never edited, so filtered/synced by createdAt.
const APPEND_ONLY_COLLECTIONS = ['fee_expectations', 'payments', 'allocations', 'admin_adjustments', 'adjustment_allocations'];
// Mutable reference data: can be edited, so filtered/synced by updatedAt and
// go through upsertMutableRecord's last-write-wins conflict resolution.
const MUTABLE_COLLECTIONS = [
  'users', 'classes', 'guardians', 'students', 'fee_catalog_templates',
  'courses', 'subjects', 'student_courses', 'sponsors', 'installment_plans',
  'fee_categories', 'fee_assignments'
];

function timestampField(name) {
  return APPEND_ONLY_COLLECTIONS.includes(name) ? 'createdAt' : 'updatedAt';
}

// Best-effort "did we write this ourselves" check across collections that
// don't all share the same provenance field name.
function ownedByThisStation(data, stationId) {
  return data.stationId === stationId || data.createdBy === stationId || data.updatedBy === stationId;
}

// Firestore document IDs can't be empty, can't contain "/", can't be
// exactly "." or "..", and can't match __.*__ (reserved for internal use).
// Our IDs (UUIDs, usernames) are already safe in practice, but guard here
// rather than let a bad write fail silently or hit a confusing SDK error.
function assertSafeKey(key) {
  const k = String(key);
  if (!k || k === '.' || k === '..' || k.includes('/') || /^__.*__$/.test(k)) {
    throw new Error(`Record key "${key}" is not a valid Firestore document ID.`);
  }
}

// Firestore's setDoc() rejects any field whose value is literally
// `undefined` (as opposed to a field that's simply absent, or `null`).
// RxDB's record.toJSON() can include optional schema fields as
// `undefined` (e.g. a student with no guardianId, no sponsorId, etc.) —
// that's perfectly valid locally, but poisons the whole document on push.
// Recursively strip those keys so an unset optional field just doesn't
// exist in the Firestore doc, exactly like it doesn't "exist" locally.
function stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefined);
  }
  if (value && typeof value === 'object') {
    const cleaned = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      cleaned[k] = stripUndefined(v);
    }
    return cleaned;
  }
  return value;
}

let firebaseApp = null;
let firestore = null;
let signInPromise = null;

function isConfigured() {
  // Firestore only needs apiKey + projectId — no databaseURL (that was
  // Realtime Database-specific and doesn't apply here).
  return (
    firebaseConfig.apiKey &&
    firebaseConfig.apiKey !== 'REPLACE_ME' &&
    firebaseConfig.projectId &&
    firebaseConfig.projectId !== 'REPLACE_ME'
  );
}

async function ensureFirebase() {
  if (!isConfigured()) {
    throw new Error('Firestore is not configured yet — fill in db/firebase-config.js (apiKey AND projectId).');
  }
  if (!firebaseApp) {
    firebaseApp = initializeApp(firebaseConfig);
    firestore = getFirestore(firebaseApp);
  }
  if (!signInPromise) {
    const auth = getAuth(firebaseApp);
    signInPromise = signInAnonymously(auth).catch((err) => {
      signInPromise = null; // allow retry on next sync attempt
      throw err;
    });
  }
  await signInPromise;
  return firestore;
}

// ---------- sync bookkeeping (stored locally) ----------

async function getMeta(key, fallback) {
  const db = await initDatabase();
  const record = await db.sync_meta.findOne({ selector: { key } }).exec();
  if (!record) return fallback;
  try {
    return JSON.parse(record.value);
  } catch {
    return fallback;
  }
}

async function setMeta(key, value) {
  const db = await initDatabase();
  const json = JSON.stringify(value);
  const existing = await db.sync_meta.findOne({ selector: { key } }).exec();
  if (existing) {
    await existing.incrementalPatch({ value: json });
  } else {
    await db.sync_meta.insert({ key, value: json });
  }
}

// ---------- push (local -> Firestore) ----------

async function pushChanges(onStatus = () => {}) {
  const db = await initDatabase();
  const firestoreInstance = await ensureFirebase();
  const lastPushAt = await getMeta('firebaseLastPushAt', '1970-01-01T00:00:00.000Z');
  const nowIso = new Date().toISOString();

  let pushed = 0;
  const perCollection = {};

  for (const name of [...MUTABLE_COLLECTIONS, ...APPEND_ONLY_COLLECTIONS]) {
    const localCollection = db[name];
    if (!localCollection) continue;

    const primaryKey = localCollection.schema.primaryPath;
    const field = timestampField(name);
    const docs = await localCollection
      .find({ selector: { [field]: { $gt: lastPushAt } } })
      .exec()
      .catch(() => localCollection.find().exec()); // safe fallback: full resync if the filtered query fails for any reason

    let countForThis = 0;
    for (const record of docs) {
      const data = stripUndefined(record.toJSON());
      const key = String(data[primaryKey]);
      assertSafeKey(key);
      await setDoc(doc(firestoreInstance, name, key), data);
      pushed += 1;
      countForThis += 1;
    }
    if (countForThis > 0) perCollection[name] = countForThis;
  }

  await setMeta('firebaseLastPushAt', nowIso);
  console.log('[sync] push detail:', JSON.stringify(perCollection));
  onStatus(pushed > 0 ? `Pushed ${pushed} record(s) to Firestore.` : 'Nothing new to push.');
  return { pushed, perCollection };
}

// ---------- pull (Firestore -> local) ----------

async function pullChanges(onStatus = () => {}) {
  const firestoreInstance = await ensureFirebase();
  const stationId = getStationId();
  const lastPullAt = await getMeta('firebaseLastPullAt', '1970-01-01T00:00:00.000Z');
  const nowIso = new Date().toISOString();

  let pulled = 0;
  let conflicts = 0;
  const perCollection = {};

  for (const name of [...MUTABLE_COLLECTIONS, ...APPEND_ONLY_COLLECTIONS]) {
    const field = timestampField(name);
    const colRef = collection(firestoreInstance, name);
    // >= (inclusive) rather than > — re-processing the exact boundary
    // record is harmless here since every upsert below is already
    // idempotent, and this avoids ever missing a record due to a
    // same-millisecond timestamp tie at the boundary.
    const q = query(colRef, where(field, '>=', lastPullAt));
    const snapshot = await getDocs(q).catch(() => getDocs(collection(firestoreInstance, name))); // safe fallback: full resync

    if (snapshot.empty) continue;

    let countForThis = 0;
    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      if (ownedByThisStation(data, stationId)) continue; // skip our own writes reflected back

      if (MUTABLE_COLLECTIONS.includes(name)) {
        const result = await upsertMutableRecord(name, data);
        if (result.conflict) conflicts += 1;
      } else {
        const db = await initDatabase();
        const localCollection = db[name];
        if (!localCollection) continue;
        const primaryKey = localCollection.schema.primaryPath;
        const exists = await localCollection.findOne({ selector: { [primaryKey]: data[primaryKey] } }).exec();
        if (!exists) await localCollection.insert(data);
      }
      pulled += 1;
      countForThis += 1;
    }
    if (countForThis > 0) perCollection[name] = countForThis;
  }

  await setMeta('firebaseLastPullAt', nowIso);
  console.log('[sync] pull detail:', JSON.stringify(perCollection));
  onStatus(
    pulled > 0
      ? `Pulled ${pulled} record(s) from Firestore` + (conflicts > 0 ? ` (${conflicts} conflict(s) auto-resolved).` : '.')
      : 'No new records from other stations.'
  );
  return { pulled, conflicts, perCollection };
}

// ---------- one full round ----------

async function syncNow(onStatus = () => {}) {
  if (!isConfigured()) {
    onStatus('Firestore not configured yet — see db/firebase-config.js (needs apiKey AND projectId).');
    return { skipped: true };
  }
  try {
    const pushResult = await pushChanges(onStatus);
    const pullResult = await pullChanges(onStatus);
    await setMeta('firebaseLastSyncAt', new Date().toISOString());
    return { ...pushResult, ...pullResult };
  } catch (err) {
    // Almost always "no internet right now" — that's fine, this is
    // background/best-effort. Local login and local data entry are
    // completely unaffected by this failing.
    console.error('[sync] error:', err);
    onStatus(`Sync skipped (offline or Firebase error): ${err.message}`);
    return { error: err.message };
  }
}

// ---------- auto-sync timer ----------

let timer = null;

function startAutoSync(intervalMs = 5 * 60 * 1000, onStatus = () => {}) {
  if (timer) return;
  timer = setInterval(() => {
    syncNow(onStatus);
  }, intervalMs);
  setTimeout(() => syncNow(onStatus), 15 * 1000);
}

function stopAutoSync() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

// ---------- exposed status, for a Superadmin diagnostics panel ----------

async function getSyncStatus() {
  const [lastPushAt, lastPullAt, lastSyncAt] = await Promise.all([
    getMeta('firebaseLastPushAt', null),
    getMeta('firebaseLastPullAt', null),
    getMeta('firebaseLastSyncAt', null)
  ]);
  return {
    configured: isConfigured(),
    lastPushAt: lastPushAt === '1970-01-01T00:00:00.000Z' ? null : lastPushAt,
    lastPullAt: lastPullAt === '1970-01-01T00:00:00.000Z' ? null : lastPullAt,
    lastSyncAt,
    projectId: firebaseConfig.projectId || null
  };
}

module.exports = { syncNow, startAutoSync, stopAutoSync, isConfigured, getSyncStatus };