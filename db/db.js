'use strict';

// db.js — runs in the Electron MAIN process only.
// Owns the local RxDB database (LokiJS storage = real on-disk file, no native
// compile step). This is where users + (later) the append-only payment
// ledger live.

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { app } = require('electron');
const { createRxDatabase, addRxPlugin } = require('rxdb');
const { RxDBMigrationPlugin } = require('rxdb/plugins/migration');
addRxPlugin(RxDBMigrationPlugin);
const { getRxStorageLoki } = require('rxdb/plugins/storage-lokijs');
const LokiFsStructuredAdapter = require('lokijs/src/loki-fs-structured-adapter');
const {
  classSchema,
  guardianSchema,
  studentSchema,
  feeCatalogTemplateSchema,
  feeExpectationSchema,
  paymentSchema,
  allocationSchema,
  adminAdjustmentSchema,
  academicYearSchema,
  termSchema,
  paymentCorrectionSchema,
  adjustmentAllocationSchema,
  // NEW schemas
  courseSchema,
  subjectSchema,
  studentCourseSchema,
  sponsorSchema,
  installmentPlanSchema,
  feeCategorySchema,
  feeAssignmentSchema
} = require('./schemas/ledger');
const ledgerEngine = require('./ledger-engine');

// ---------- local date formatting ----------
// `.toISOString()` converts to UTC — for a school ahead of UTC (like
// Namibia, UTC+2), a locally-constructed date for local midnight on
// the 1st of a month becomes 22:00 the *previous* day once converted,
// which rolls the "YYYY-MM" key back into the previous month entirely.
// The same happens at the day level for "today" between midnight and
// the timezone offset. Every "what month/day is this" computation in
// this file needs to stay in local time throughout — never construct
// a local Date and then read it back via toISOString().
function localDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function localMonthKey(date) {
  return localDateStr(date).slice(0, 7);
}

// ---------- station identity ----------
function getStationId() {
  return (process.env.STATION_ID || os.hostname() || 'unknown-station')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-');
}

/** Live record counts per collection — an in-app version of what
 * tools/dump-db.js shows from the command line, for a Superadmin
 * diagnostics panel rather than requiring a terminal. */
async function getDatabaseStats() {
  const db = await initDatabase();
  const collectionNames = [
    'users', 'classes', 'guardians', 'students', 'fee_catalog_templates',
    'fee_expectations', 'payments', 'allocations', 'admin_adjustments', 'payment_corrections',
    'adjustment_allocations', 'courses', 'subjects', 'student_courses',
    'sponsors', 'installment_plans', 'fee_categories', 'fee_assignments'
  ];
  const counts = {};
  for (const name of collectionNames) {
    if (!db[name]) continue;
    counts[name] = await db[name].count().exec();
  }
  return { counts, stationId: getStationId(), dbPath: DB_NAME };
}

if (!app.isPackaged) {
  const { RxDBDevModePlugin } = require('rxdb/plugins/dev-mode');
  addRxPlugin(RxDBDevModePlugin);
}

// Stored under the user's per-machine app-data folder
const DB_NAME = path.join(app.getPath('userData'), 'fms-data');
console.log('[db] userData folder:', app.getPath('userData'));
try {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
} catch (_) { /* already exists, fine */ }

// ---------- Schemas ----------
const usersSchema = {
  title: 'users schema',
  version: 1,
  primaryKey: 'username',
  type: 'object',
  properties: {
    username: { type: 'string', maxLength: 64 },
    passwordHash: { type: 'string' },
    salt: { type: 'string' },
    role: { type: 'string', enum: ['Superadmin', 'Admin', 'Secretary'] },
    section: { type: 'string', enum: ['WENDY', 'KEILA', 'Both'] },
    firstName: { type: 'string' },
    lastName: { type: 'string' },
    email: { type: 'string' },
    phone: { type: 'string' },
    avatarDataUrl: { type: 'string' },
    lastLoginAt: { type: 'string' },
    passwordChangedAt: { type: 'string' },
    isActive: { type: 'boolean', default: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    updatedBy: { type: 'string' }
  },
  required: ['username', 'passwordHash', 'salt', 'role', 'section', 'updatedAt', 'updatedBy']
};

const conflictLogSchema = {
  title: 'conflict log schema',
  version: 0,
  primaryKey: 'id',
  type: 'object',
  properties: {
    id: { type: 'string', maxLength: 128 },
    collectionName: { type: 'string' },
    recordId: { type: 'string' },
    loserData: { type: 'string' },
    winnerUpdatedAt: { type: 'string' },
    loserUpdatedAt: { type: 'string' },
    loserUpdatedBy: { type: 'string' },
    resolvedAt: { type: 'string' }
  },
  required: ['id', 'collectionName', 'recordId', 'loserData', 'resolvedAt']
};

const syncMetaSchema = {
  title: 'sync meta schema',
  version: 0,
  primaryKey: 'key',
  type: 'object',
  properties: {
    key: { type: 'string', maxLength: 128 },
    value: { type: 'string' }
  },
  required: ['key', 'value']
};

let dbInstance = null;
let initPromise = null;
let hasAttemptedWipeThisProcess = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------- password hashing ----------
function hashPassword(password, existingSalt) {
  const salt = existingSalt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, salt, expectedHash) {
  const { hash } = hashPassword(password, salt);
  const a = Buffer.from(hash, 'hex');
  const b = Buffer.from(expectedHash, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ---------- database lifecycle ----------
async function initDatabase(onProgress = () => {}) {
  if (dbInstance) return dbInstance;
  if (initPromise) return initPromise;
  initPromise = attemptInit(onProgress).catch((err) => {
    initPromise = null;
    throw err;
  });
  return initPromise;
}

/**
 * Properly closes the database, flushing any pending writes to disk
 * first — used on app quit. Without this, closing the app right after a
 * write (a payment just captured, a student just registered) races
 * against LokiJS's own interval-based autosave: if the process exits
 * before that autosave fires, the write can be lost, or in the worst
 * case the file ends up partially written if something was mid-flush
 * when the process died. RxDB's own .destroy() waits for its storage
 * adapter to finish any in-flight persistence before resolving, which
 * is exactly the guarantee needed here.
 */
async function closeDatabase() {
  if (!dbInstance) return;
  const instance = dbInstance;
  dbInstance = null;
  initPromise = null;
  try {
    await instance.destroy();
  } catch (err) {
    console.error('[db] Error while closing database:', err.message);
  }
}

async function wipeLocalDatabaseFiles() {
  async function removeWithRetry(targetPath) {
    for (let attempt = 1; attempt <= 8; attempt++) {
      try {
        fs.rmSync(targetPath, { recursive: true, force: true });
      } catch (_) {}
      if (!fs.existsSync(targetPath)) return true;
      await delay(150 * attempt);
    }
    return false;
  }
  await removeWithRetry(DB_NAME);
  const dir = path.dirname(DB_NAME);
  const prefix = path.basename(DB_NAME);
  let entries = [];
  try {
    entries = fs.readdirSync(dir).filter((e) => e.startsWith(prefix));
  } catch (_) { return; }
  const stillLocked = [];
  for (const entry of entries) {
    const ok = await removeWithRetry(path.join(dir, entry));
    if (!ok) stillLocked.push(entry);
  }
  if (stillLocked.length > 0) {
    throw new Error(
      `Could not clear the old database files — they appear to be locked by another process: ${stillLocked.join(', ')}. ` +
      `Close every other running copy of Fee Management System (check Task Manager too) and try again.`
    );
  }
}

async function attemptInit(onProgress) {
  onProgress('Opening local database...');
  let db;
  try {
    db = await createRxDatabase({
      name: DB_NAME,
      storage: getRxStorageLoki({
        adapter: new LokiFsStructuredAdapter()
      }),
      multiInstance: false,
      ignoreDuplicate: true
    });

    onProgress('Preparing collections...');
    await db.addCollections({
      users: {
        schema: usersSchema,
        migrationStrategies: {
          1: (oldDoc) => ({ ...oldDoc, avatarDataUrl: oldDoc.avatarDataUrl || null, passwordChangedAt: oldDoc.passwordChangedAt || null })
        }
      },
      conflict_log: { schema: conflictLogSchema },
      sync_meta: { schema: syncMetaSchema },
      classes: { schema: classSchema },
      guardians: {
        schema: guardianSchema,
        // v0 -> v1: added employer fields. Existing guardians just have none
        // on record yet — nothing to backfill, real data preserved.
        migrationStrategies: {
          1: (oldDoc) => ({ ...oldDoc, employerName: oldDoc.employerName || null, jobTitle: oldDoc.jobTitle || null, employerPhone: oldDoc.employerPhone || null, employerAddress: oldDoc.employerAddress || null }),
          2: (oldDoc) => ({ ...oldDoc, isForeignNational: oldDoc.isForeignNational || false, nationalId: oldDoc.nationalId || null, passport: oldDoc.passport || null })
        }
      },
      students: {
        schema: studentSchema,
        migrationStrategies: {
          1: (oldDoc) => ({ ...oldDoc, registeredBy: oldDoc.registeredBy || null }),
          // v1 -> v2: added documentsPdfPath + summaryPdfPath. Existing
          // students just don't have documents on file yet.
          2: (oldDoc) => ({ ...oldDoc, documentsPdfPath: oldDoc.documentsPdfPath || null, summaryPdfPath: oldDoc.summaryPdfPath || null }),
          3: (oldDoc) => ({ ...oldDoc, isOnScholarship: oldDoc.isOnScholarship || false }),
          4: (oldDoc) => ({ ...oldDoc, deletionRequestedAt: null, deletionRequestedBy: null, deletionReason: null, deletionDecisionAt: null, deletionDecisionBy: null, deletionDecision: null }),
          5: (oldDoc) => ({ ...oldDoc, emergencyContactName: oldDoc.emergencyContactName || null })
        }
      },
      fee_catalog_templates: {
        schema: feeCatalogTemplateSchema,
        migrationStrategies: {
          1: (oldDoc) => ({ ...oldDoc, gradePricing: oldDoc.gradePricing || [] })
        }
      },
      fee_expectations: {
        schema: feeExpectationSchema,
        migrationStrategies: {
          1: (oldDoc) => ({ ...oldDoc, frequency: oldDoc.frequency || 'one-time', installmentPlanId: oldDoc.installmentPlanId || null }),
          2: (oldDoc) => ({ ...oldDoc, sourceAssignmentId: oldDoc.sourceAssignmentId || null, billingPeriod: oldDoc.billingPeriod || null })
        }
      },
      payments: {
        schema: paymentSchema,
        migrationStrategies: {
          1: (oldDoc) => ({ ...oldDoc, bankName: oldDoc.bankName || '', senderAccountRef: oldDoc.senderAccountRef || '' })
        }
      },
      allocations: { schema: allocationSchema },
      admin_adjustments: { schema: adminAdjustmentSchema },
      academic_years: { schema: academicYearSchema },
      terms: { schema: termSchema },
      payment_corrections: { schema: paymentCorrectionSchema },
      adjustment_allocations: { schema: adjustmentAllocationSchema },
      // NEW collections
      courses: { schema: courseSchema },
      subjects: { schema: subjectSchema },
      student_courses: { schema: studentCourseSchema },
      sponsors: {
        schema: sponsorSchema,
        // v0 -> v1: school enum widened from ['KEILA'] to ['WENDY','KEILA'] —
        // every existing sponsor was already 'KEILA', which is still valid
        // under the new, broader enum, so nothing needs to change.
        migrationStrategies: { 1: (oldDoc) => oldDoc }
      },
      installment_plans: {
        schema: installmentPlanSchema,
        migrationStrategies: {
          1: (oldDoc) => ({ ...oldDoc, updatedAt: oldDoc.createdAt, updatedBy: oldDoc.createdBy })
        }
      },
      fee_categories: { schema: feeCategorySchema },
      fee_assignments: { schema: feeAssignmentSchema }
    });
  } catch (err) {
    const isSchemaMismatch = err && (err.code === 'DB6' || /DB6/.test(String(err.message || '')));
    if (isSchemaMismatch && !app.isPackaged && !hasAttemptedWipeThisProcess) {
      hasAttemptedWipeThisProcess = true;
      console.warn('[db] Schema mismatch detected (DB6) — wiping local dev database.');
      onProgress('Schema changed — resetting local dev database...');
      if (db) {
        try { await db.destroy(); } catch (_) { /* ignore */ }
      }
      await delay(400);
      await wipeLocalDatabaseFiles();
      const restartErr = new Error('Local database was reset after a schema change. The app needs to restart.');
      restartErr.restartRequired = true;
      throw restartErr;
    }
    if (isSchemaMismatch && hasAttemptedWipeThisProcess) {
      const stuckErr = new Error(
        'The local database still will not open after being reset. This usually means another copy of ' +
        'Fee Management System is still running (check Task Manager) and has the database files locked. ' +
        'Close every other copy of the app, then reopen it.'
      );
      throw stuckErr;
    }
    throw err;
  }

  onProgress('Checking user accounts...');
  const existingUsers = await db.users.find().exec();
  if (existingUsers.length === 0) {
    onProgress('Creating default accounts...');
    const now = new Date().toISOString();
    const by = getStationId();
    const defaultAccounts = [
      { username: 'admin', password: 'password123', role: 'Superadmin', section: 'Both', firstName: 'System', lastName: 'Administrator', email: 'admin@fms.local' },
      { username: 'ceo', password: 'ChangeMe2026!', role: 'Admin', section: 'Both', firstName: 'CEO', lastName: 'Account', email: 'ceo@fms.local' },
      { username: 'secretary_wendy', password: 'ChangeMe2026!', role: 'Secretary', section: 'WENDY', firstName: 'Wendy', lastName: 'Secretary', email: 'secretary.wendy@fms.local' },
      { username: 'secretary_keila', password: 'ChangeMe2026!', role: 'Secretary', section: 'KEILA', firstName: 'Keila', lastName: 'Secretary', email: 'secretary.keila@fms.local' }
    ];
    for (const acct of defaultAccounts) {
      const { hash, salt } = hashPassword(acct.password);
      await db.users.insert({
        username: acct.username,
        passwordHash: hash,
        salt,
        role: acct.role,
        section: acct.section,
        firstName: acct.firstName,
        lastName: acct.lastName,
        email: acct.email,
        phone: '',
        lastLoginAt: '',
        isActive: true,
        createdAt: now,
        updatedAt: now,
        updatedBy: by
      });
    }
  }

  onProgress('Checking fee catalog...');
  const existingTemplates = await db.fee_catalog_templates.find().exec();
  if (existingTemplates.length === 0) {
    onProgress('Seeding starting fee catalog...');
    await seedFeeCatalog(db);
  } else {
    // Backfill for installs that already ran the seed before this fix
    // existed: WENDY had a "Registration Fee" tagged category Tuition but
    // it's one-time — there was never an actual monthly tuition template,
    // so tying "Tuition" and generating monthly invoices had nothing
    // correctly-frequenced to bill. Only adds this one specific missing
    // item; leaves every existing template (and anything already tied to
    // them) completely untouched.
    const hasWendyMonthlyTuition = existingTemplates.some(
      (t) => t.school === 'WENDY' && t.category === 'Tuition' && t.frequency === 'monthly'
    );
    if (!hasWendyMonthlyTuition) {
      onProgress('Adding missing Tuition fee template...');
      await db.fee_catalog_templates.insert({
        templateId: crypto.randomUUID(), isActive: true,
        updatedAt: new Date().toISOString(), updatedBy: getStationId(),
        school: 'WENDY', itemName: 'Tuition', category: 'Tuition',
        standardCharge: 900, priorityTier: 1, frequency: 'monthly'
      });
    }
  }

  onProgress('Ready');
  dbInstance = db;
  const [userCount, templateCount] = await Promise.all([
    db.users.count().exec(),
    db.fee_catalog_templates.count().exec()
  ]);
  console.log(`[db] Ready. Path: ${DB_NAME}`);
  console.log(`[db] users: ${userCount}, fee_catalog_templates: ${templateCount}`);
  return db;
}

async function seedFeeCatalog(db) {
  const now = new Date().toISOString();
  const by = getStationId();
  const mk = (fields) => ({
    templateId: crypto.randomUUID(),
    isActive: true,
    updatedAt: now,
    updatedBy: by,
    ...fields
  });
  const templates = [
    mk({ school: 'SHARED', itemName: 'Bus - Kinder', category: 'Bus', standardCharge: 500, priorityTier: 2, frequency: 'monthly' }),
    mk({ school: 'SHARED', itemName: 'Bus - Pre-Grade', category: 'Bus', standardCharge: 500, priorityTier: 2, frequency: 'monthly' }),
    mk({ school: 'SHARED', itemName: 'Bus - Grade 1-12', category: 'Bus', standardCharge: 1000, priorityTier: 2, frequency: 'monthly' }),
    mk({ school: 'SHARED', itemName: 'Hostel - Boarding', category: 'Boarding', standardCharge: 2000, priorityTier: 2, frequency: 'monthly' }),
    mk({ school: 'SHARED', itemName: 'Hostel - Day Care', category: 'Boarding', standardCharge: 2000, priorityTier: 2, frequency: 'monthly' }),
    mk({ school: 'SHARED', itemName: 'Hostel - Full-Time', category: 'Boarding', standardCharge: 2000, priorityTier: 2, frequency: 'monthly' }),
    mk({ school: 'WENDY', itemName: 'Registration Fee', category: 'Tuition', standardCharge: 500, priorityTier: 1, frequency: 'one-time' }),
    mk({ school: 'WENDY', itemName: 'Tuition', category: 'Tuition', standardCharge: 900, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'WENDY', itemName: 'Swimming Club', category: 'Extracurricular', standardCharge: 150, priorityTier: 3, frequency: 'monthly' }),
    mk({ school: 'WENDY', itemName: 'Music (Piano)', category: 'Extracurricular', standardCharge: 250, priorityTier: 3, frequency: 'monthly' }),
    mk({ school: 'WENDY', itemName: 'Chess Club', category: 'Extracurricular', standardCharge: 80, priorityTier: 3, frequency: 'monthly' }),
    mk({ school: 'WENDY', itemName: 'Debate Team', category: 'Extracurricular', standardCharge: 100, priorityTier: 3, frequency: 'monthly' }),
    mk({ school: 'WENDY', itemName: 'Uniform', category: 'Uniform', standardCharge: 450, priorityTier: 3, frequency: 'one-time' }),
    mk({ school: 'WENDY', itemName: 'Library Fine', category: 'Fine', standardCharge: 20, priorityTier: 4, frequency: 'one-time' }),
    mk({ school: 'WENDY', itemName: 'Locker Key Replacement', category: 'Fine', standardCharge: 15, priorityTier: 4, frequency: 'one-time' }),
    mk({ school: 'KEILA', itemName: 'Mathematics', category: 'Tuition', standardCharge: 300, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'English', category: 'Tuition', standardCharge: 280, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'Physics', category: 'Tuition', standardCharge: 320, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'Chemistry', category: 'Tuition', standardCharge: 320, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'Biology', category: 'Tuition', standardCharge: 310, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'History', category: 'Tuition', standardCharge: 250, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'Geography', category: 'Tuition', standardCharge: 250, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'Accounting', category: 'Tuition', standardCharge: 290, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'Business Studies', category: 'Tuition', standardCharge: 270, priorityTier: 1, frequency: 'monthly' }),
    mk({ school: 'KEILA', itemName: 'Registration Fee', category: 'Tuition', standardCharge: 300, priorityTier: 1, frequency: 'one-time' })
  ];
  await db.fee_catalog_templates.bulkInsert(templates);
}

// ---------- Authentication ----------
async function verifyLogin(username, password) {
  const db = await initDatabase();
  const user = await db.users.findOne({ selector: { username } }).exec();
  if (!user || user.isActive === false) {
    return { success: false, message: 'Invalid username or password.' };
  }
  const ok = verifyPassword(password, user.salt, user.passwordHash);
  if (!ok) {
    return { success: false, message: 'Invalid username or password.' };
  }
  await user.incrementalPatch({
    lastLoginAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    updatedBy: getStationId()
  });
  return {
    success: true,
    username: user.username,
    role: user.role,
    section: user.section
  };
}

// ---------- Ledger orchestration ----------
async function createGuardian(data) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = { guardianId: crypto.randomUUID(), isActive: true, updatedAt: now, updatedBy: getStationId(), ...data };
  await db.guardians.insert(doc);
  return doc;
}

/**
 * Turns the raw expectations/payments/adjustments arrays into a proper
 * chronological ledger — the actual date/description/debit/credit/running-
 * balance table a statement needs. This was a known gap (getStudentLedger
 * returns the raw arrays separately, not merged into one timeline) —
 * building it properly here rather than leaving the statement's ledger
 * table empty the way the Financial Ledger tab's was.
 */
function buildLedgerTransactions({ expectations, payments, adjustments }) {
  const entries = [];
  expectations.forEach((e) => entries.push({
    date: e.dueDate, description: e.description || e.category, debit: e.originalAmount, credit: 0
  }));
  payments.forEach((p) => entries.push({
    date: p.paymentDate, description: `Payment received (${p.paymentMethod} — ${p.transactionReference})`, debit: 0, credit: p.amount
  }));
  adjustments.forEach((a) => entries.push({
    date: a.approvalTimestamp?.slice(0, 10), description: `${a.type}: ${a.reasonCode || ''}`.trim(), debit: 0, credit: a.amount
  }));
  entries.sort((a, b) => new Date(a.date) - new Date(b.date));
  let running = 0;
  return entries.map((entry) => {
    running = ledgerEngine.round2(running + entry.debit - entry.credit);
    return { ...entry, balance: running };
  });
}

/** Everything a Student Statement or Parent Audit Report needs, in one call. */
async function getStudentStatementData(studentId) {
  const db = await initDatabase();
  const studentDoc = await db.students.findOne({ selector: { studentId } }).exec();
  if (!studentDoc) throw new Error('Student not found.');
  const student = studentDoc.toJSON();
  const guardianDoc = student.guardianId ? await db.guardians.findOne({ selector: { guardianId: student.guardianId } }).exec() : null;
  const ledger = await getStudentLedger(studentId);
  const transactions = buildLedgerTransactions(ledger);
  return {
    student,
    guardian: guardianDoc ? guardianDoc.toJSON() : null,
    ledger,
    transactions
  };
}

/**
 * The parent-facing version of a statement — same underlying numbers,
 * but a correction never appears as its own line. Internally (this
 * app's own reports, All Payments) a correction is shown openly: it's a
 * real event in the school's own audit trail and staff should see it
 * plainly. On paper, sent to a parent, showing "corrected from N$500 to
 * N$700" reads as the school admitting an error in writing, which isn't
 * the point of the letter — the point is an accurate, professional
 * statement of what's owed. So here, a correction is folded directly
 * into the original payment or charge it belongs to: the payment (or
 * charge) simply shows its final, correct amount, as if that had been
 * the figure all along. The totals are identical either way — only the
 * presentation differs.
 */
async function getStudentStatementDataForLetter(studentId) {
  const db = await initDatabase();
  const studentDoc = await db.students.findOne({ selector: { studentId } }).exec();
  if (!studentDoc) throw new Error('Student not found.');
  const student = studentDoc.toJSON();
  const guardianDoc = student.guardianId ? await db.guardians.findOne({ selector: { guardianId: student.guardianId } }).exec() : null;
  const ledger = await getStudentLedger(studentId);
  const correctionsRaw = await db.payment_corrections.find({ selector: { studentId } }).exec();
  const corrections = correctionsRaw.map((c) => c.toJSON());

  const excludedAdjustmentIds = new Set(corrections.map((c) => c.relatedAdjustmentId).filter(Boolean));
  const excludedExpectationIds = new Set(corrections.map((c) => c.relatedExpectationId).filter(Boolean));
  const amountDeltaByPaymentId = {};
  corrections.forEach((c) => {
    amountDeltaByPaymentId[c.originalPaymentId] = (amountDeltaByPaymentId[c.originalPaymentId] || 0) + c.correctionAmount;
  });

  const cleanPayments = ledger.payments.map((p) => {
    const delta = amountDeltaByPaymentId[p.paymentId];
    return delta ? { ...p, amount: ledgerEngine.round2(p.amount + delta) } : p;
  });
  const cleanExpectations = ledger.expectations.filter((e) => !excludedExpectationIds.has(e.expectationId));
  const cleanAdjustments = ledger.adjustments.filter((a) => !excludedAdjustmentIds.has(a.adjustmentId));

  const transactions = buildLedgerTransactions({
    expectations: cleanExpectations, payments: cleanPayments, adjustments: cleanAdjustments
  });

  // A printed statement for a parent doesn't need the student's entire
  // multi-year history — three months of recent activity is what's
  // actually useful, and keeps the document a reasonable length. An
  // "Opening Balance" line carries forward everything before that
  // window as a single figure, so the running balance shown still adds
  // up correctly from the first printed row — it's the same total,
  // just not itemized further back than three months.
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 3);
  const cutoffStr = localDateStr(cutoff);
  const beforeCutoff = transactions.filter((t) => (t.date || '') < cutoffStr);
  const withinWindow = transactions.filter((t) => (t.date || '') >= cutoffStr);
  const recentTransactions = beforeCutoff.length > 0
    ? [{ date: cutoffStr, description: 'Opening Balance (carried forward)', debit: 0, credit: 0, balance: beforeCutoff[beforeCutoff.length - 1].balance }, ...withinWindow]
    : withinWindow;

  return {
    student,
    guardian: guardianDoc ? guardianDoc.toJSON() : null,
    ledger,
    transactions: recentTransactions
  };
}

/**
 * The hierarchical filter — combines grade/class, scholarship status,
 * debtor status, and a specific fee category, any subset at once. This is
 * what "grade + scholarship + debtors + a specific extracurricular fee"
 * means concretely: every filter provided narrows the same result set
 * further, rather than being 4 separate single-purpose reports.
 */
async function getStudentsByFilters(filters = {}) {
  const db = await initDatabase();
  const selector = {};
  if (filters.school && filters.school !== 'Both') selector.school = filters.school;
  if (filters.classId) selector.classId = filters.classId;
  if (filters.isOnScholarship !== undefined && filters.isOnScholarship !== '') selector.isOnScholarship = filters.isOnScholarship;
  if (filters.enrollmentStatus) selector.enrollmentStatus = filters.enrollmentStatus;
  if (filters.sponsorType) selector.sponsorType = filters.sponsorType;
  if (filters.usesBus !== undefined && filters.usesBus !== '') selector.usesBus = filters.usesBus;
  if (filters.isHostelite !== undefined && filters.isHostelite !== '') selector.isHostelite = filters.isHostelite;

  const studentsRaw = await db.students.find({ selector }).exec();
  const [guardiansRaw, classesRaw] = await Promise.all([db.guardians.find().exec(), db.classes.find().exec()]);
  const guardianById = Object.fromEntries(guardiansRaw.map((g) => [g.guardianId, g.toJSON()]));
  const classById = Object.fromEntries(classesRaw.map((c) => [c.classId, c.toJSON()]));
  let students = studentsRaw.map((s) => {
    const doc = s.toJSON();
    const guardian = guardianById[doc.guardianId];
    const cls = classById[doc.classId];
    return {
      ...doc,
      guardianName: guardian ? `${guardian.firstName} ${guardian.lastName}`.trim() : '',
      guardianPhone: guardian ? guardian.phonePrimary : '',
      className: cls ? cls.className : '',
      gradeLevel: cls ? cls.gradeLevel : undefined
    };
  });

  // This was silently accepted but never applied — any caller passing
  // a search term (like an autocomplete search box) got back every
  // student in the school regardless of what was typed, which is a
  // real risk of selecting the wrong student in a school with more
  // than a handful of names.
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    students = students.filter((s) =>
      `${s.firstName} ${s.lastName}`.toLowerCase().includes(q) ||
      (s.studentNumber || '').toLowerCase().includes(q)
    );
  }

  if (filters.gradeLevel !== undefined && filters.gradeLevel !== '') {
    const matchingClassIds = new Set(classesRaw.map((c) => c.toJSON()).filter((c) => c.gradeLevel === Number(filters.gradeLevel)).map((c) => c.classId));
    students = students.filter((s) => matchingClassIds.has(s.classId));
  }

  const needsFinancials = filters.debtorStatus || filters.feeCategory ||
    filters.minBalance !== undefined || filters.maxBalance !== undefined || filters.attachFinancials;

  if (needsFinancials) {
    const [expectationsRaw, paymentsRaw, allocationsRaw, adjAllocRaw, adjustmentsRaw] = await Promise.all([
      db.fee_expectations.find().exec(), db.payments.find().exec(), db.allocations.find().exec(),
      db.adjustment_allocations.find().exec(), db.admin_adjustments.find().exec()
    ]);
    const expectations = expectationsRaw.map((e) => e.toJSON());
    const payments = paymentsRaw.map((p) => p.toJSON());
    const allocations = allocationsRaw.map((a) => a.toJSON());
    const adjustments = adjustmentsRaw.map((a) => a.toJSON());
    const adjAllocations = adjAllocRaw.map((a) => a.toJSON());

    students = students
      .map((s) => {
        const exps = expectations.filter((e) => e.studentId === s.studentId);
        const pays = payments.filter((p) => p.studentId === s.studentId);
        const expIds = new Set(exps.map((e) => e.expectationId));
        const adjAllocs = adjAllocations.filter((a) => expIds.has(a.expectationId));
        const studentAdjustments = adjustments.filter((a) => a.studentId === s.studentId);
        const health = ledgerEngine.computeFinancialHealth({ expectations: exps, payments: pays, allocations, adjustmentAllocations: adjAllocs, adjustments: studentAdjustments });
        return { ...s, balance: health.balance, financialStatus: health.status, matchesCategory: !filters.feeCategory || exps.some((e) => e.category === filters.feeCategory) };
      })
      .filter((s) => {
        if (!s.matchesCategory) return false;
        if (filters.debtorStatus && s.financialStatus !== filters.debtorStatus) return false;
        if (filters.minBalance !== undefined && filters.minBalance !== '' && s.balance < Number(filters.minBalance)) return false;
        if (filters.maxBalance !== undefined && filters.maxBalance !== '' && s.balance > Number(filters.maxBalance)) return false;
        return true;
      });
  }

  return students;
}

/** Aggregated ledger totals for every student in a class or grade level —
 * pass classId for a Class Statement, gradeLevel for a Grade Statement. */
async function getClassOrGradeStatement({ school, classId, gradeLevel }) {
  const students = await getStudentsByFilters({ school, classId, gradeLevel });
  const db = await initDatabase();
  const studentIds = students.map((s) => s.studentId);
  if (studentIds.length === 0) return { students: [], totalExpected: 0, totalCollected: 0, totalOutstanding: 0 };

  const [expectationsRaw, paymentsRaw, allocationsRaw, adjAllocRaw, adjustmentsRaw] = await Promise.all([
    db.fee_expectations.find({ selector: { studentId: { $in: studentIds } } }).exec(),
    db.payments.find({ selector: { studentId: { $in: studentIds } } }).exec(),
    db.allocations.find().exec(),
    db.adjustment_allocations.find().exec(),
    db.admin_adjustments.find({ selector: { studentId: { $in: studentIds } } }).exec()
  ]);
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const payments = paymentsRaw.map((p) => p.toJSON());
  const correctedPayments = await withCorrectedAmounts(db, payments);
  const correctedByStudentId = {};
  correctedPayments.forEach((p) => { (correctedByStudentId[p.studentId] = correctedByStudentId[p.studentId] || []).push(p); });
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());
  const adjustments = adjustmentsRaw.map((a) => a.toJSON());

  const rows = students.map((s) => {
    const exps = expectations.filter((e) => e.studentId === s.studentId);
    const pays = payments.filter((p) => p.studentId === s.studentId);
    const studentAdjustments = adjustments.filter((a) => a.studentId === s.studentId);
    const expIds = new Set(exps.map((e) => e.expectationId));
    const studentAdjustmentAllocations = adjustmentAllocations.filter((a) => expIds.has(a.expectationId));
    const health = ledgerEngine.computeFinancialHealth({ expectations: exps, payments: pays, allocations, adjustmentAllocations: studentAdjustmentAllocations, adjustments: studentAdjustments });
    return {
      studentId: s.studentId, name: `${s.firstName} ${s.lastName}`, studentNumber: s.studentNumber,
      expected: exps.reduce((sum, e) => sum + e.originalAmount, 0),
      collected: (correctedByStudentId[s.studentId] || []).reduce((sum, p) => sum + p.amount, 0),
      balance: health.balance, status: health.status
    };
  });

  return {
    students: rows,
    totalExpected: rows.reduce((s, r) => s + r.expected, 0),
    totalCollected: rows.reduce((s, r) => s + r.collected, 0),
    totalOutstanding: rows.reduce((s, r) => s + Math.max(0, r.balance), 0)
  };
}

/** Every charge under one fee category (e.g. "Sports", "Hostel", "Transport")
 * with who owes what — powers both the generic Fee Category Report and the
 * specific Sports/Hostel/Transport Fees report buttons (same function,
 * different category argument). */
/**
 * Returns a new array of payments with .amount adjusted to reflect any
 * corrections applied since — the actual, final amount, not what was
 * originally typed in. This exists because payment.amount gets summed
 * directly in many places across reports and dashboards; rather than
 * patch each of those sums individually (easy to miss one, and each
 * copy could drift out of sync with how corrections actually work),
 * every function that reports on payment totals calls this once, right
 * after fetching payments, and everything downstream is automatically
 * correct.
 */
async function withCorrectedAmounts(db, payments) {
  const paymentIds = payments.map((p) => p.paymentId);
  if (paymentIds.length === 0) return payments;
  const correctionsRaw = await db.payment_corrections.find({ selector: { originalPaymentId: { $in: paymentIds } } }).exec();
  if (correctionsRaw.length === 0) return payments;
  const deltaByPaymentId = {};
  correctionsRaw.map((c) => c.toJSON()).forEach((c) => {
    deltaByPaymentId[c.originalPaymentId] = (deltaByPaymentId[c.originalPaymentId] || 0) + c.correctionAmount;
  });
  return payments.map((p) => {
    const delta = deltaByPaymentId[p.paymentId];
    return delta ? { ...p, amount: ledgerEngine.round2(p.amount + delta) } : p;
  });
}

async function getFeeCategoryReport({ school, category }) {
  const db = await initDatabase();
  const selector = school && school !== 'Both' ? { school, category } : { category };
  const expectationsRaw = await db.fee_expectations.find({ selector }).exec();
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const expectationIds = expectations.map((e) => e.expectationId);
  const studentIds = [...new Set(expectations.map((e) => e.studentId))];

  const [allocationsRaw, adjAllocRaw, studentsRaw] = await Promise.all([
    expectationIds.length ? db.allocations.find({ selector: { expectationId: { $in: expectationIds } } }).exec() : [],
    expectationIds.length ? db.adjustment_allocations.find({ selector: { expectationId: { $in: expectationIds } } }).exec() : [],
    studentIds.length ? db.students.find({ selector: { studentId: { $in: studentIds } } }).exec() : []
  ]);
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());
  const studentById = Object.fromEntries(studentsRaw.map((s) => [s.studentId, s.toJSON()]));

  const rows = expectations.map((e) => {
    const remaining = ledgerEngine.computeExpectationRemaining(e, allocations, adjustmentAllocations);
    const s = studentById[e.studentId];
    return {
      studentName: s ? `${s.firstName} ${s.lastName}` : 'Unknown', studentNumber: s?.studentNumber || '',
      description: e.description, amount: e.originalAmount, remaining, dueDate: e.dueDate
    };
  });

  return {
    category, rows,
    totalExpected: rows.reduce((s, r) => s + r.amount, 0),
    totalOutstanding: rows.reduce((s, r) => s + Math.max(0, r.remaining), 0),
    totalCollected: rows.reduce((s, r) => s + (r.amount - Math.max(0, r.remaining)), 0)
  };
}

/**
 * Every payment, joined with student/class names and what it was actually
 * allocated to — the data behind the All Payments page. Filters mirror
 * what a bursar actually needs: date range, method, and a free-text search
 * across student name/admission number/reference.
 */
async function getAllPaymentsDetailed({ school, startDate, endDate, paymentMethod, search } = {}) {
  const db = await initDatabase();
  const selector = {};
  if (school && school !== 'Both') selector.school = school;
  if (paymentMethod) selector.paymentMethod = paymentMethod;

  const paymentsRaw = await db.payments.find({ selector }).exec();
  let payments = paymentsRaw.map((p) => p.toJSON());

  if (startDate) payments = payments.filter((p) => p.paymentDate >= startDate);
  if (endDate) payments = payments.filter((p) => p.paymentDate <= endDate);

  const studentIds = [...new Set(payments.map((p) => p.studentId))];
  const paymentIds = payments.map((p) => p.paymentId);
  const [studentsRaw, allocationsRaw, expectationsRaw, correctionsRaw] = await Promise.all([
    studentIds.length ? db.students.find({ selector: { studentId: { $in: studentIds } } }).exec() : [],
    paymentIds.length ? db.allocations.find({ selector: { paymentId: { $in: paymentIds } } }).exec() : [],
    db.fee_expectations.find().exec(),
    paymentIds.length ? db.payment_corrections.find({ selector: { originalPaymentId: { $in: paymentIds } } }).exec() : []
  ]);
  const correctionsByPayment = {};
  correctionsRaw.map((c) => c.toJSON()).forEach((c) => {
    (correctionsByPayment[c.originalPaymentId] = correctionsByPayment[c.originalPaymentId] || []).push(c);
  });
  const studentById = Object.fromEntries(studentsRaw.map((s) => [s.studentId, s.toJSON()]));
  const guardianIds = [...new Set(studentsRaw.map((s) => s.toJSON().guardianId).filter(Boolean))];
  const classIds = [...new Set(studentsRaw.map((s) => s.toJSON().classId).filter(Boolean))];
  const [guardiansRaw, classesRaw] = await Promise.all([
    guardianIds.length ? db.guardians.find({ selector: { guardianId: { $in: guardianIds } } }).exec() : [],
    classIds.length ? db.classes.find({ selector: { classId: { $in: classIds } } }).exec() : []
  ]);
  const guardianById = Object.fromEntries(guardiansRaw.map((g) => [g.guardianId, g.toJSON()]));
  const classById = Object.fromEntries(classesRaw.map((c) => [c.classId, c.toJSON()]));
  const expectationById = Object.fromEntries(expectationsRaw.map((e) => [e.expectationId, e.toJSON()]));
  const allocationsByPayment = {};
  allocationsRaw.forEach((a) => {
    const data = a.toJSON();
    (allocationsByPayment[data.paymentId] = allocationsByPayment[data.paymentId] || []).push(data);
  });

  let rows = payments.map((p) => {
    const student = studentById[p.studentId];
    const guardian = student ? guardianById[student.guardianId] : null;
    const cls = student ? classById[student.classId] : null;
    const allocs = allocationsByPayment[p.paymentId] || [];
    const paidFor = allocs.map((a) => expectationById[a.expectationId]?.category).filter(Boolean);
    const corrections = correctionsByPayment[p.paymentId] || [];
    return {
      ...p,
      studentName: student ? `${student.firstName} ${student.lastName}` : 'Unknown',
      studentNumber: student?.studentNumber || '',
      classId: student?.classId || '',
      className: cls ? cls.className : '',
      // The payment record's own payerName is left untouched (it's the
      // actual record of who was typed in at the time) — this is a
      // separate, display-only field: whoever actually paid if it was
      // recorded, otherwise the student's guardian, since that's who
      // pays by default unless someone else was named.
      displayPayerName: p.payerName || (guardian ? `${guardian.firstName} ${guardian.lastName}`.trim() : ''),
      paidFor: [...new Set(paidFor)].join(', ') || (allocs.length === 0 ? 'Unallocated (credit)' : ''),
      // What was actually recorded, plus any corrections since — shown
      // openly here (unlike the parent-facing letter, which merges this
      // silently). Internal views should never hide that a correction
      // happened.
      corrections,
      correctedAmount: corrections.length
        ? ledgerEngine.round2(p.amount + corrections.reduce((sum, c) => sum + c.correctionAmount, 0))
        : p.amount
    };
  });

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) =>
      r.studentName.toLowerCase().includes(q) ||
      r.studentNumber.toLowerCase().includes(q) ||
      r.transactionReference.toLowerCase().includes(q)
    );
  }

  rows.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));

  const totalAmount = rows.reduce((sum, r) => sum + r.amount, 0);
  return {
    rows,
    stats: {
      totalTransactions: rows.length,
      totalAmount: ledgerEngine.round2(totalAmount),
      averagePayment: rows.length ? ledgerEngine.round2(totalAmount / rows.length) : 0
    }
  };
}

/** General-purpose student record patch — used here to attach saved
 * document PDF paths after registration, but usable for any field edit. */
/** Secretary-initiated step — a request, not an actual deletion. Nothing
 * about the student changes yet; it just becomes visible in the Admin's
 * pending-approvals queue. */
async function requestStudentDeletion({ studentId, reason, requestedBy }) {
  const db = await initDatabase();
  const target = await db.students.findOne({ selector: { studentId } }).exec();
  if (!target) throw new Error('Student not found.');
  const now = new Date().toISOString();
  const patch = {
    deletionRequestedAt: now, deletionRequestedBy: requestedBy, deletionReason: reason || '',
    deletionDecisionAt: null, deletionDecisionBy: null, deletionDecision: null,
    updatedAt: now, updatedBy: requestedBy
  };
  await target.incrementalPatch(patch);
  return { ...target.toJSON(), ...patch };
}

/** Everything currently awaiting an Admin/Superadmin decision — a request
 * counts as pending only while it has no decision recorded yet. */
async function listPendingDeletionRequests(school) {
  const db = await initDatabase();
  const selector = school && school !== 'Both' ? { school } : {};
  const studentsRaw = await db.students.find({ selector }).exec();
  return studentsRaw
    .map((s) => s.toJSON())
    .filter((s) => s.deletionRequestedAt && !s.deletionDecisionAt);
}

/** Admin's actual decision. Approving deactivates the student (marks
 * Withdrawn) rather than truly erasing the record — consistent with every
 * other "delete" in this app: the history stays, nothing referencing this
 * student (payments, expectations) becomes orphaned. */
async function decideStudentDeletion({ studentId, decision, decidedBy }) {
  if (!['Approved', 'Rejected'].includes(decision)) {
    throw new Error('Decision must be Approved or Rejected.');
  }
  const db = await initDatabase();
  const target = await db.students.findOne({ selector: { studentId } }).exec();
  if (!target) throw new Error('Student not found.');
  if (!target.deletionRequestedAt || target.deletionDecisionAt) {
    throw new Error('This student has no pending deletion request.');
  }
  const now = new Date().toISOString();
  const patch = {
    deletionDecisionAt: now, deletionDecisionBy: decidedBy, deletionDecision: decision,
    updatedAt: now, updatedBy: decidedBy
  };
  if (decision === 'Approved') {
    patch.enrollmentStatus = 'Withdrawn';
  }
  await target.incrementalPatch(patch);
  return { ...target.toJSON(), ...patch };
}

/**
 * Every meaningful action a secretary took — payments captured, adjustments
 * approved, students registered, deletion decisions made — combined into
 * one chronological trail with real timestamps. This is what "audit a
 * secretary's actions with time and everything" means concretely.
 *
 * One honest limitation: students only carry updatedAt/updatedBy, not a
 * separate createdAt — so "Student Registered" timestamps are the
 * student's last-updated time, which is accurate for a student who's never
 * been edited since registration, but wouldn't distinguish a later edit
 * from the original registration for one that has.
 */
async function getSecretaryAuditReport({ school, secretary, startDate, endDate }) {
  const db = await initDatabase();
  const schoolFilter = school && school !== 'Both' ? { school } : {};

  const [paymentsRaw, adjustmentsRaw, studentsRaw, correctionsRaw] = await Promise.all([
    db.payments.find({ selector: schoolFilter }).exec(),
    db.admin_adjustments.find({ selector: schoolFilter }).exec(),
    db.students.find({ selector: schoolFilter }).exec(),
    db.payment_corrections.find({ selector: schoolFilter }).exec()
  ]);

  const entries = [];
  paymentsRaw.forEach((doc) => {
    const p = doc.toJSON();
    entries.push({ timestamp: p.createdAt, actor: p.processedBy, action: 'Payment Captured', detail: `${p.transactionReference} \u2014 ${dbMoney(p.amount)} (${p.paymentMethod})`, studentId: p.studentId });
  });
  adjustmentsRaw.forEach((doc) => {
    const a = doc.toJSON();
    // Payment-correction adjustments are logged below via
    // payment_corrections instead, with the actual correction reason
    // attached — logging the same event twice here would just be
    // duplicate, less-informative noise in the trail.
    if (a.type === 'CORRECTION') return;
    entries.push({ timestamp: a.approvalTimestamp, actor: a.approvedByUserId, action: `Adjustment: ${a.type}`, detail: `${dbMoney(a.amount)} \u2014 ${a.reasonCode}`, studentId: a.studentId });
  });
  studentsRaw.forEach((doc) => {
    const s = doc.toJSON();
    if (s.registeredBy) entries.push({ timestamp: s.updatedAt, actor: s.registeredBy, action: 'Student Registered', detail: `${s.firstName} ${s.lastName}`, studentId: s.studentId });
    if (s.deletionDecisionBy) entries.push({ timestamp: s.deletionDecisionAt, actor: s.deletionDecisionBy, action: `Deletion Request ${s.deletionDecision}`, detail: `${s.firstName} ${s.lastName}`, studentId: s.studentId });
  });
  correctionsRaw.forEach((doc) => {
    const c = doc.toJSON();
    // Covers both directions uniformly — a positive correction (money
    // that came in but wasn't recorded) and a negative one (recorded
    // as more than was actually received) use different underlying
    // mechanisms internally, but both are logged here the same way,
    // with the actual reason given at the time.
    entries.push({
      timestamp: c.createdAt, actor: c.correctedByUserId,
      action: `Payment Correction (${c.correctionAmount > 0 ? '+' : ''}${dbMoney(c.correctionAmount)})`,
      detail: c.reason, studentId: c.studentId
    });
  });

  let filtered = entries.filter((e) => e.timestamp);
  if (secretary) filtered = filtered.filter((e) => e.actor === secretary);
  if (startDate) filtered = filtered.filter((e) => e.timestamp >= startDate);
  if (endDate) filtered = filtered.filter((e) => e.timestamp <= endDate + 'T23:59:59.999Z');
  filtered.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return filtered;
}

function dbMoney(n) { return 'N$ ' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

/** Transaction volume per secretary, bucketed by day/week/month — "how
 * much did each secretary process, and how often" rather than the
 * individual-transaction detail the audit report gives. */
async function getSecretaryTransactionSummary({ school, groupBy = 'day', startDate, endDate }) {
  const db = await initDatabase();
  const schoolFilter = school && school !== 'Both' ? { school } : {};
  const paymentsRaw = await db.payments.find({ selector: schoolFilter }).exec();
  let payments = paymentsRaw.map((p) => p.toJSON());
  if (startDate) payments = payments.filter((p) => p.paymentDate >= startDate);
  if (endDate) payments = payments.filter((p) => p.paymentDate <= endDate);

  function bucketFor(dateStr) {
    const d = new Date(dateStr);
    if (groupBy === 'month') return dateStr.slice(0, 7); // YYYY-MM
    if (groupBy === 'week') {
      const onejan = new Date(d.getFullYear(), 0, 1);
      const week = Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
      return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
    }
    return dateStr; // day — raw YYYY-MM-DD
  }

  const buckets = {}; // bucket -> secretary -> { count, total }
  payments.forEach((p) => {
    const bucket = bucketFor(p.paymentDate);
    const secretary = p.processedBy || 'Unknown';
    buckets[bucket] = buckets[bucket] || {};
    buckets[bucket][secretary] = buckets[bucket][secretary] || { count: 0, total: 0 };
    buckets[bucket][secretary].count += 1;
    buckets[bucket][secretary].total = ledgerEngine.round2(buckets[bucket][secretary].total + p.amount);
  });

  const rows = Object.entries(buckets)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([bucket, bySecretary]) => ({
      bucket,
      secretaries: Object.entries(bySecretary).map(([secretary, stats]) => ({ secretary, ...stats })),
      bucketTotal: ledgerEngine.round2(Object.values(bySecretary).reduce((s, v) => s + v.total, 0)),
      bucketCount: Object.values(bySecretary).reduce((s, v) => s + v.count, 0)
    }));

  return { groupBy, rows };
}

async function updateStudent(studentId, patch) {
  const db = await initDatabase();
  const target = await db.students.findOne({ selector: { studentId } }).exec();
  if (!target) throw new Error('Student not found.');
  const fullPatch = { ...patch, updatedAt: new Date().toISOString(), updatedBy: getStationId() };
  await target.incrementalPatch(fullPatch);
  return { ...target.toJSON(), ...fullPatch };
}

/** Same patch applied to many students at once — bus/hostel assignment,
 * moving a group to a different class, etc. Runs the patches in
 * parallel rather than one sequential loop from the frontend. */
async function bulkUpdateStudents(studentIds, patch) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const stationId = getStationId();
  const fullPatch = { ...patch, updatedAt: now, updatedBy: stationId };
  const docs = await db.students.find({ selector: { studentId: { $in: studentIds } } }).exec();
  await Promise.all(docs.map((doc) => doc.incrementalPatch(fullPatch)));
  return { updated: docs.length };
}

/**
 * Saves a base64-encoded PDF to disk and returns its path. Deliberately
 * NOT stored as a data URL on the student record — a certificates PDF
 * combining several photos could be a few hundred KB to a few MB even
 * compressed, and RxDB documents live in memory (LokiJS) and get synced;
 * bloating every student record with embedded binary content would hurt
 * both. The record just holds this returned path.
 */
async function saveStudentDocumentsPdf(studentId, pdfBase64, kind) {
  const documentsDir = path.join(path.dirname(DB_NAME), 'student-documents');
  if (!fs.existsSync(documentsDir)) fs.mkdirSync(documentsDir, { recursive: true });
  const safeKind = kind === 'summary' ? 'summary' : 'documents';
  const filePath = path.join(documentsDir, `${studentId}-${safeKind}.pdf`);
  const buffer = Buffer.from(pdfBase64, 'base64');
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

/** Saves an uploaded bank transfer receipt (photo or PDF) so it can be
 * retrieved later — not just used transiently for OCR. Called after
 * capturePayment so the file is named by the real paymentId; the caller
 * then patches proofOfPaymentPath onto that payment record with the
 * returned path. extension should be a plain lowercase type like 'jpg',
 * 'png', or 'pdf' — whatever the uploaded file actually was. */
async function savePaymentReceipt(paymentId, fileBase64, extension) {
  const receiptsDir = path.join(path.dirname(DB_NAME), 'payment-receipts');
  if (!fs.existsSync(receiptsDir)) fs.mkdirSync(receiptsDir, { recursive: true });
  const safeExt = /^[a-z0-9]{2,5}$/.test(extension) ? extension : 'jpg';
  const filePath = path.join(receiptsDir, `${paymentId}.${safeExt}`);
  const buffer = Buffer.from(fileBase64, 'base64');
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

async function createClass(data) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = { classId: crypto.randomUUID(), isActive: true, updatedAt: now, updatedBy: getStationId(), ...data };
  await db.classes.insert(doc);
  return doc;
}

async function listClasses(school) {
  const db = await initDatabase();
  const selector = school && school !== 'Both' ? { school } : {};
  return (await db.classes.find({ selector }).exec()).map(d => d.toJSON());
}

/**
 * Moves a group of students up to the next grade for a new academic
 * year — the actual "roll everyone over" action a school does once a
 * year. Existing fee and payment history is never touched; only where
 * a student is *currently* enrolled changes going forward, so nothing
 * about last year's records gets rewritten. If the target class (the
 * next grade, in the new year) doesn't exist yet, it's created
 * automatically — this is meant to be a routine, once-a-year action,
 * not something that requires setting up classes by hand first.
 */
async function promoteStudents({ studentIds, school, targetYearId, gradeOverride }) {
  const db = await initDatabase();
  if (!studentIds || studentIds.length === 0) throw new Error('Select at least one student to promote.');
  const targetYearDoc = await db.academic_years.findOne({ selector: { yearId: targetYearId } }).exec();
  if (!targetYearDoc) throw new Error('Target academic year not found.');
  const targetYear = targetYearDoc.toJSON();

  const studentsRaw = await db.students.find({ selector: { studentId: { $in: studentIds } } }).exec();
  const classIds = [...new Set(studentsRaw.map((s) => s.toJSON().classId).filter(Boolean))];
  const currentClassesRaw = classIds.length ? await db.classes.find({ selector: { classId: { $in: classIds } } }).exec() : [];
  const currentClassById = Object.fromEntries(currentClassesRaw.map((c) => [c.toJSON().classId, c.toJSON()]));

  let targetClassesRaw = await db.classes.find({ selector: { school, academicYear: targetYear.label } }).exec();
  let targetClasses = targetClassesRaw.map((c) => c.toJSON());

  const results = [];
  for (const studentDoc of studentsRaw) {
    const student = studentDoc.toJSON();
    const currentClass = currentClassById[student.classId];
    if (!currentClass) {
      results.push({ studentId: student.studentId, name: `${student.firstName} ${student.lastName}`.trim(), success: false, reason: 'No current class on record — nothing to promote from.' });
      continue;
    }
    const targetGrade = gradeOverride !== undefined && gradeOverride !== null ? gradeOverride : currentClass.gradeLevel + 1;
    let targetClass = targetClasses.find((c) => c.gradeLevel === targetGrade && c.section === currentClass.section);
    if (!targetClass) {
      targetClass = await createClass({
        school, className: `Grade ${targetGrade}${currentClass.section ? currentClass.section : ''}`,
        gradeLevel: targetGrade, section: currentClass.section || '', academicYear: targetYear.label,
        monthlyTuitionFee: currentClass.monthlyTuitionFee || 0
      });
      targetClasses.push(targetClass);
    }
    await studentDoc.incrementalPatch({ classId: targetClass.classId, academicYear: targetYear.label });
    results.push({
      studentId: student.studentId, name: `${student.firstName} ${student.lastName}`.trim(), success: true,
      fromGrade: currentClass.gradeLevel, fromClassName: currentClass.className,
      toGrade: targetGrade, toClassName: targetClass.className, toAcademicYear: targetYear.label
    });
  }
  return results;
}

function generateStudentNumber(school) {
  const prefix = (school || 'STU').slice(0, 3).toUpperCase();
  const datePart = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const randomPart = crypto.randomBytes(2).toString('hex').toUpperCase();
  return `${prefix}-${datePart}-${randomPart}`;
}

async function createStudent(data) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = {
    studentId: crypto.randomUUID(),
    studentNumber: data.studentNumber || generateStudentNumber(data.school),
    enrollmentStatus: 'Active',
    updatedAt: now,
    updatedBy: getStationId(),
    ...data
  };
  await db.students.insert(doc);
  return doc;
}

async function listGuardians() {
  const db = await initDatabase();
  return (await db.guardians.find().exec()).map((g) => g.toJSON());
}

async function listStudents(school) {
  const db = await initDatabase();
  const selector = school && school !== 'Both' ? { school } : {};
  const [studentsRaw, guardiansRaw, classesRaw] = await Promise.all([
    db.students.find({ selector }).exec(),
    db.guardians.find().exec(),
    db.classes.find().exec()
  ]);
  const guardianById = Object.fromEntries(guardiansRaw.map((g) => [g.guardianId, g.toJSON()]));
  const classById = Object.fromEntries(classesRaw.map((c) => [c.classId, c.toJSON()]));
  return studentsRaw
    .map((s) => s.toJSON())
    .map((s) => {
      const guardian = guardianById[s.guardianId];
      const cls = classById[s.classId];
      return {
        ...s,
        guardianName: guardian ? `${guardian.firstName} ${guardian.lastName}`.trim() : '',
        guardianPhone: guardian ? guardian.phonePrimary : '',
        className: cls ? cls.className : '',
        gradeLevel: cls ? cls.gradeLevel : undefined
      };
    })
    .sort((a, b) => new Date(b.createdAt || b.updatedAt) - new Date(a.createdAt || a.updatedAt));
}

/**
 * When a student has already paid ahead — money sitting unallocated
 * from an earlier payment that covered more than was due at the time —
 * and a new charge is created for them (a new month's invoice, a new
 * one-time fee), that existing credit should apply automatically rather
 * than the student showing as owing money the school is already
 * holding on their behalf.
 *
 * This finds any of the student's past payments with leftover,
 * unallocated amounts (oldest first, so the earliest prepayment gets
 * used first) and creates real allocation records linking that leftover
 * directly to the new expectation, up to what the new charge actually
 * needs. It never touches or moves money between students — only
 * applies a student's own existing surplus to their own new charge.
 */
async function sweepSurplusOntoNewExpectation(db, studentId, expectation) {
  const round2 = ledgerEngine.round2;
  let stillNeeded = round2(expectation.originalAmount);
  if (stillNeeded <= 0) return;

  const [paymentsRaw, allocationsRaw] = await Promise.all([
    db.payments.find({ selector: { studentId } }).exec(),
    db.allocations.find().exec()
  ]);
  const payments = paymentsRaw.map((p) => p.toJSON()).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const allocatedByPayment = {};
  allocations.forEach((a) => { allocatedByPayment[a.paymentId] = round2((allocatedByPayment[a.paymentId] || 0) + a.amountAllocated); });

  const now = new Date().toISOString();
  const newAllocations = [];
  for (const payment of payments) {
    if (stillNeeded <= 0) break;
    const alreadyAllocated = allocatedByPayment[payment.paymentId] || 0;
    const leftover = round2(payment.amount - alreadyAllocated);
    if (leftover <= 0) continue;
    const toApply = round2(Math.min(leftover, stillNeeded));
    newAllocations.push({
      allocationId: crypto.randomUUID(), paymentId: payment.paymentId, expectationId: expectation.expectationId,
      amountAllocated: toApply, appliedDate: now, createdAt: now
    });
    stillNeeded = round2(stillNeeded - toApply);
  }
  if (newAllocations.length > 0) await db.allocations.bulkInsert(newAllocations);
  return { sweptAmount: round2(expectation.originalAmount - stillNeeded), allocationsCreated: newAllocations.length };
}

/**
 * A real academic year, not a free-text field retyped inconsistently
 * across three different forms. Exactly one year per school is
 * "current" at a time — that's what new registrations and new billing
 * default to, without anyone needing to remember or retype it.
 */
async function listAcademicYears(school) {
  const db = await initDatabase();
  const raw = await db.academic_years.find({ selector: { school } }).exec();
  return raw.map((y) => y.toJSON()).sort((a, b) => b.label.localeCompare(a.label, undefined, { numeric: true }));
}

async function createAcademicYear({ school, label, startDate, endDate, makeCurrent }) {
  const db = await initDatabase();
  const existing = await db.academic_years.findOne({ selector: { school, label } }).exec();
  if (existing) throw new Error(`Academic year "${label}" already exists for this school.`);
  const now = new Date().toISOString();
  const doc = { yearId: crypto.randomUUID(), school, label, startDate: startDate || '', endDate: endDate || '', isCurrent: false, createdAt: now };
  await db.academic_years.insert(doc);
  if (makeCurrent) await setCurrentAcademicYear(school, doc.yearId);
  return doc;
}

async function setCurrentAcademicYear(school, yearId) {
  const db = await initDatabase();
  const allDocs = await db.academic_years.find({ selector: { school } }).exec();
  await Promise.all(allDocs.map((doc) => {
    const shouldBeCurrent = doc.toJSON().yearId === yearId;
    return doc.toJSON().isCurrent !== shouldBeCurrent ? doc.incrementalPatch({ isCurrent: shouldBeCurrent }) : Promise.resolve();
  }));
  return { success: true };
}

async function getCurrentAcademicYear(school) {
  const db = await initDatabase();
  const doc = await db.academic_years.findOne({ selector: { school, isCurrent: true } }).exec();
  return doc ? doc.toJSON() : null;
}

async function createFeeExpectation(data) {
  const db = await initDatabase();
  const doc = {
    expectationId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    createdBy: getStationId(),
    ...data
  };
  await db.fee_expectations.insert(doc);
  if (doc.studentId) await sweepSurplusOntoNewExpectation(db, doc.studentId, doc);
  return doc;
}

/**
 * Same as createFeeExpectation, but when a templateId is given, resolves
 * the actual charge amount server-side from that student's real grade —
 * the same resolution bulkAssignFee already uses when tying a fee to many
 * students at once. Without this, charging a single student one-off from
 * the catalog (e.g. Process Payment's "Add Charge") would silently use
 * the template's flat standardCharge even for a template with grade-tier
 * pricing, undercharging or overcharging depending on the student's
 * actual grade. When there's no templateId (a fully custom charge with
 * no catalog entry to resolve against), the given originalAmount is used
 * as-is — there's nothing to look up.
 */
async function createChargeFromTemplate(data) {
  const db = await initDatabase();
  if (!data.templateId) {
    return createFeeExpectation(data);
  }
  const templateDoc = await db.fee_catalog_templates.findOne({ selector: { templateId: data.templateId } }).exec();
  if (!templateDoc) throw new Error('Fee template not found.');
  const template = templateDoc.toJSON();

  const studentDoc = await db.students.findOne({ selector: { studentId: data.studentId } }).exec();
  const student = studentDoc ? studentDoc.toJSON() : null;
  let gradeLevel;
  if (student && student.classId) {
    const classDoc = await db.classes.findOne({ selector: { classId: student.classId } }).exec();
    gradeLevel = classDoc ? classDoc.toJSON().gradeLevel : undefined;
  }
  const resolvedAmount = resolveFeeAmount(template, gradeLevel);
  return createFeeExpectation({ ...data, originalAmount: resolvedAmount });
}

async function createInstallmentPlan({
  studentId, school, category, description, totalAmount, numberOfInstallments,
  startDate, priorityTier, createdBy
}) {
  if (!Number.isInteger(numberOfInstallments) || numberOfInstallments < 2) {
    throw new Error('A payment plan needs at least 2 installments — for 1, just create a normal fee expectation.');
  }
  if (!(totalAmount > 0)) {
    throw new Error('totalAmount must be greater than 0.');
  }
  const db = await initDatabase();
  const installmentPlanId = crypto.randomUUID();
  const baseAmount = Math.floor((totalAmount / numberOfInstallments) * 100) / 100;
  const remainder = ledgerEngine.round2(totalAmount - baseAmount * numberOfInstallments);
  const start = new Date(startDate);
  const docs = [];
  for (let i = 0; i < numberOfInstallments; i++) {
    const due = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
    const amount = i === 0 ? ledgerEngine.round2(baseAmount + remainder) : baseAmount;
    docs.push({
      expectationId: crypto.randomUUID(),
      studentId, school, category,
      description: `${description} — Installment ${i + 1} of ${numberOfInstallments}`,
      originalAmount: amount,
      dueDate: localDateStr(due),
      priorityTier,
      frequency: 'monthly',
      installmentPlanId,
      createdAt: new Date().toISOString(),
      createdBy: createdBy || getStationId()
    });
  }
  await db.fee_expectations.bulkInsert(docs);
  return { installmentPlanId, expectations: docs };
}

/** One-time charge (Registration, Uniform, a school trip) for many students
 * at once, no installment split — the "pay it in full" companion to
 * bulkCreateInstallmentPlans below. */
/**
 * Flags which of the given students already have a matching one-time
 * charge billed this month — same category+description, same calendar
 * month — without blocking anything. The caller decides what to do with
 * the flagged ones: a genuinely new instance of the same item (a
 * replacement uniform because the old one no longer fits) is a real,
 * valid second charge, not a mistake, so this only ever warns, never
 * silently refuses.
 */
async function checkDuplicateCharges({ studentIds, category, description, billingPeriod }) {
  const db = await initDatabase();
  const period = billingPeriod || new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const existingRaw = await db.fee_expectations.find({
    selector: { studentId: { $in: studentIds }, category, description }
  }).exec();
  const duplicateStudentIds = new Set(
    existingRaw
      .map((e) => e.toJSON())
      .filter((e) => (e.createdAt || '').slice(0, 7) === period)
      .map((e) => e.studentId)
  );
  return { duplicateStudentIds: [...duplicateStudentIds] };
}

async function bulkCreateFeeExpectations({ studentIds, school, category, description, amount, dueDate, priorityTier, templateId }) {
  if (!(amount > 0)) throw new Error('Amount must be greater than 0.');
  if (!studentIds || studentIds.length === 0) throw new Error('Select at least one student.');
  const db = await initDatabase();
  const now = new Date().toISOString();
  const stationId = getStationId();
  const docs = studentIds.map((studentId) => ({
    expectationId: crypto.randomUUID(),
    studentId, school, category, description,
    originalAmount: amount, dueDate, priorityTier,
    frequency: 'one-time',
    ...(templateId ? { templateId } : {}),
    createdAt: now, createdBy: stationId
  }));
  await db.fee_expectations.bulkInsert(docs);
  for (const expectation of docs) {
    await sweepSurplusOntoNewExpectation(db, expectation.studentId, expectation);
  }
  return { studentsCount: studentIds.length, expectationsCreated: docs.length };
}

/**
 * Same installment-splitting math as createInstallmentPlan, but for many
 * students at once — a one-time fee (Registration, Uniform, a school trip)
 * that some parents can't pay in full, applied to a whole selection of
 * students in a single batched insert rather than one IPC round trip per
 * student. Each student gets their own installmentPlanId, so a plan is
 * still tracked per-student even though this created many at once.
 */
async function bulkCreateInstallmentPlans({ studentIds, school, category, description, totalAmount, numberOfInstallments, startDate, priorityTier, templateId }) {
  if (!Number.isInteger(numberOfInstallments) || numberOfInstallments < 2) {
    throw new Error('A payment plan needs at least 2 installments — for 1, just create a normal fee expectation.');
  }
  if (!(totalAmount > 0)) {
    throw new Error('totalAmount must be greater than 0.');
  }
  if (!studentIds || studentIds.length === 0) {
    throw new Error('Select at least one student.');
  }
  const db = await initDatabase();
  const baseAmount = Math.floor((totalAmount / numberOfInstallments) * 100) / 100;
  const remainder = ledgerEngine.round2(totalAmount - baseAmount * numberOfInstallments);
  const start = new Date(startDate);
  const now = new Date().toISOString();
  const stationId = getStationId();

  const docs = [];
  const planIds = [];
  for (const studentId of studentIds) {
    const installmentPlanId = crypto.randomUUID();
    planIds.push(installmentPlanId);
    for (let i = 0; i < numberOfInstallments; i++) {
      const due = new Date(start.getFullYear(), start.getMonth() + i, start.getDate());
      const amount = i === 0 ? ledgerEngine.round2(baseAmount + remainder) : baseAmount;
      docs.push({
        expectationId: crypto.randomUUID(),
        studentId, school, category,
        description: `${description} — Installment ${i + 1} of ${numberOfInstallments}`,
        originalAmount: amount,
        dueDate: localDateStr(due),
        priorityTier,
        frequency: 'monthly',
        installmentPlanId,
        ...(templateId ? { templateId } : {}),
        createdAt: now,
        createdBy: stationId
      });
    }
  }
  await db.fee_expectations.bulkInsert(docs);
  return { studentsCount: studentIds.length, expectationsCreated: docs.length, planIds };
}

async function listFeeCatalogTemplates(school) {
  const db = await initDatabase();
  const selector = school && school !== 'Both' ? { school: { $in: [school, 'SHARED'] } } : {};
  const templates = await db.fee_catalog_templates.find({ selector }).exec();
  return templates.map((t) => t.toJSON()).filter((t) => t.isActive !== false);
}

/**
 * Same as listFeeCatalogTemplates but WITHOUT filtering out inactive
 * templates — for the Fee Structure Manager's own management table, where
 * a deactivated ("deleted") template needs to stay visible (that's the
 * whole point of the Active/Inactive status badge) rather than disappear
 * the moment it's deactivated.
 */
async function listAllFeeCatalogTemplates(school) {
  const db = await initDatabase();
  const selector = school && school !== 'Both' ? { school: { $in: [school, 'SHARED'] } } : {};
  const templates = await db.fee_catalog_templates.find({ selector }).exec();
  return templates.map((t) => t.toJSON());
}

async function createFeeTemplate(data) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = { templateId: crypto.randomUUID(), isActive: true, updatedAt: now, updatedBy: getStationId(), ...data };
  await db.fee_catalog_templates.insert(doc);
  return doc;
}

/**
 * Edits a fee template's fields, or deactivates it (patch: {isActive:false}).
 * There's no hard-delete here — same reasoning as everywhere else in this
 * app (students get a deletion *request* that preserves the record,
 * users get deactivated, not deleted): a template that's already been used
 * to generate real fee_expectations shouldn't vanish out from under that
 * history. "Delete" in the UI means this — deactivate, not erase.
 */
async function updateFeeCatalogTemplate(templateId, patch) {
  const db = await initDatabase();
  const target = await db.fee_catalog_templates.findOne({ selector: { templateId } }).exec();
  if (!target) throw new Error('Fee template not found.');
  const fullPatch = { ...patch, updatedAt: new Date().toISOString(), updatedBy: getStationId() };
  await target.incrementalPatch(fullPatch);
  return { ...target.toJSON(), ...fullPatch };
}

async function getStudentBillingSummary(studentId, school) {
  const [ledger, catalog] = await Promise.all([
    getStudentLedger(studentId),
    listFeeCatalogTemplates(school)
  ]);
  return {
    ...ledger,
    outstanding: ledger.expectations.filter((e) => e.remaining > 0).sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate)),
    catalog
  };
}

async function getStudentLedger(studentId) {
  const db = await initDatabase();
  const expectationsRaw = await db.fee_expectations.find({ selector: { studentId } }).exec();
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const expectationIds = expectations.map((e) => e.expectationId);
  const [paymentsRaw, allocationsRaw, adjustmentsRaw, adjAllocRaw] = await Promise.all([
    db.payments.find({ selector: { studentId } }).exec(),
    expectationIds.length ? db.allocations.find({ selector: { expectationId: { $in: expectationIds } } }).exec() : [],
    db.admin_adjustments.find({ selector: { studentId } }).exec(),
    expectationIds.length ? db.adjustment_allocations.find({ selector: { expectationId: { $in: expectationIds } } }).exec() : []
  ]);
  const payments = paymentsRaw.map((p) => p.toJSON());
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustments = adjustmentsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());
  const expectationsWithRemaining = expectations.map((e) => ({
    ...e,
    remaining: ledgerEngine.computeExpectationRemaining(e, allocations, adjustmentAllocations)
  }));
  const health = ledgerEngine.computeFinancialHealth({ expectations, payments, allocations, adjustmentAllocations, adjustments });
  return {
    expectations: expectationsWithRemaining,
    payments,
    allocations,
    adjustments,
    adjustmentAllocations,
    balance: health.balance,
    status: health.status,
    maxAgeDays: health.maxAgeDays || 0
  };
}

async function capturePayment({
  studentId, school, amount, paymentMethod, transactionReference,
  bankReference, bankName, senderAccountRef, payerName, payerPhone, proofOfPaymentPath, paymentDate,
  processedBy, mode = 'auto', directedAllocationSet = []
}) {
  const db = await initDatabase();
  if (!['EFT', 'POS'].includes(paymentMethod)) {
    throw new Error('Cashless enforcement: paymentMethod must be EFT or POS.');
  }
  if (!transactionReference) {
    throw new Error('Reference Lock: a transaction reference is required to capture a payment.');
  }
  const ledger = await getStudentLedger(studentId);
  const outstanding = ledger.expectations.filter((e) => e.remaining > 0);
  const allocationResult =
    mode === 'directed'
      ? ledgerEngine.allocatePaymentDirected(
          amount,
          directedAllocationSet,
          Object.fromEntries(outstanding.map((e) => [e.expectationId, e]))
        )
      : ledgerEngine.allocatePaymentAutoFIFO(amount, outstanding);
  const paymentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const paymentDoc = {
    paymentId,
    studentId,
    school,
    amount,
    paymentMethod,
    transactionReference,
    bankReference: bankReference || '',
    bankName: bankName || '',
    senderAccountRef: senderAccountRef || '',
    payerName: payerName || '',
    payerPhone: payerPhone || '',
    proofOfPaymentPath: proofOfPaymentPath || '',
    paymentDate: paymentDate || now,
    processedBy,
    stationId: getStationId(),
    createdAt: now
  };
  await db.payments.insert(paymentDoc);
  const allocationDocs = allocationResult.allocations.map((a) => ({
    allocationId: crypto.randomUUID(),
    paymentId,
    expectationId: a.expectationId,
    amountAllocated: a.amountAllocated,
    appliedDate: paymentDoc.paymentDate,
    createdAt: now
  }));
  if (allocationDocs.length) await db.allocations.bulkInsert(allocationDocs);
  return {
    payment: paymentDoc,
    allocations: allocationDocs,
    unallocatedSurplus: allocationResult.unallocatedSurplus
  };
}

/** Links a receipt file (already saved via savePaymentReceipt) back onto
 * its payment record. Two-step by design: capturePayment creates the
 * payment and returns its real paymentId, the receipt file gets saved
 * using that real ID, then this attaches the resulting path — rather
 * than trying to save the file before a paymentId even exists. */
async function updatePaymentReceiptPath(paymentId, filePath) {
  const db = await initDatabase();
  const paymentDoc = await db.payments.findOne({ selector: { paymentId } }).exec();
  if (!paymentDoc) throw new Error('Payment not found.');
  await paymentDoc.incrementalPatch({ proofOfPaymentPath: filePath });
  return paymentDoc.toJSON();
}

async function applyAdminAdjustment({
  studentId, school, type, targetCategory, targetExpectationId,
  amount, reasonCode, explanation, approvedByUserId
}) {
  const db = await initDatabase();
  if (!reasonCode) {
    throw new Error('A mandatory reason code is required for every admin adjustment.');
  }
  const ledger = await getStudentLedger(studentId);
  const candidates = ledger.expectations.filter((e) => e.remaining > 0);
  const result = ledgerEngine.allocateAdjustment({ amount, targetCategory, targetExpectationId }, candidates);
  const adjustmentId = crypto.randomUUID();
  const now = new Date().toISOString();
  const adjustmentDoc = {
    adjustmentId,
    studentId,
    school,
    type,
    targetCategory: targetCategory || '',
    targetExpectationId: targetExpectationId || '',
    amount,
    reasonCode,
    explanation: explanation || '',
    approvedByUserId,
    approvalTimestamp: now,
    stationId: getStationId(),
    createdAt: now
  };
  await db.admin_adjustments.insert(adjustmentDoc);
  const allocationDocs = result.allocations.map((a) => ({
    allocationId: crypto.randomUUID(),
    adjustmentId,
    expectationId: a.expectationId,
    amountAllocated: a.amountAllocated,
    appliedDate: now,
    createdAt: now
  }));
  if (allocationDocs.length) await db.adjustment_allocations.bulkInsert(allocationDocs);
  return { adjustment: adjustmentDoc, allocations: allocationDocs, unusedAmount: result.unusedAmount };
}

/**
 * Corrects a specific past payment that was captured with the wrong
 * amount — e.g. the secretary typed N$500 but the bank slip actually
 * shows N$700, or vice versa. The original payment record is never
 * edited or deleted (this ledger stays append-only, same as everywhere
 * else in this app) — instead:
 *
 * - correctionAmount > 0 (more was actually received than recorded):
 *   the difference gets allocated against the student's outstanding
 *   balance exactly like a normal payment would be, via the existing
 *   admin-adjustment mechanism.
 * - correctionAmount < 0 (less was actually received than recorded):
 *   a new charge for the shortfall is added to what the student owes —
 *   admin_adjustments' own allocation logic doesn't handle negative
 *   amounts correctly (it silently skips them), so this uses a plain
 *   fee_expectation instead, which is also a clearer audit trail: "a
 *   correction charge of N$200" is easier to understand later than a
 *   negative number buried in an adjustment record.
 *
 * Either way, a payment_corrections record links the fix back to the
 * exact original payment, so "what corrections has this payment had"
 * is a direct lookup later.
 */
async function correctPaymentAmount({ originalPaymentId, correctionAmount, reason, correctedByUserId }) {
  const db = await initDatabase();
  if (!correctionAmount || correctionAmount === 0) {
    throw new Error('Correction amount must be a non-zero number.');
  }
  if (!reason || !reason.trim()) {
    throw new Error('A reason is required for every payment correction.');
  }
  const originalDoc = await db.payments.findOne({ selector: { paymentId: originalPaymentId } }).exec();
  if (!originalDoc) throw new Error('Original payment not found.');
  const original = originalDoc.toJSON();

  const now = new Date().toISOString();
  const correctionId = crypto.randomUUID();
  const stationId = getStationId();
  let relatedAdjustmentId = '';
  let relatedExpectationId = '';

  if (correctionAmount > 0) {
    // applyAdminAdjustment only allocates when given an explicit target
    // category/expectation — it has no "spread across everything owed,
    // priority order" mode the way capturePayment does. A correction for
    // money that simply wasn't recorded should behave exactly like that
    // extra money arriving as a normal payment, so the allocation is
    // computed the same way here directly, then recorded through the
    // admin_adjustments audit trail (still correct for computing
    // remaining balances, since that reads adjustment_allocations
    // regardless of how they were produced).
    const ledger = await getStudentLedger(original.studentId);
    const outstanding = ledger.expectations.filter((e) => e.remaining > 0 && new Date(e.dueDate) <= new Date());
    const allocationResult = ledgerEngine.allocatePaymentAutoFIFO(correctionAmount, outstanding);

    const adjustmentId = crypto.randomUUID();
    const adjustmentDoc = {
      adjustmentId, studentId: original.studentId, school: original.school, type: 'CORRECTION',
      targetCategory: '', targetExpectationId: '', amount: correctionAmount,
      reasonCode: 'PAYMENT_CORRECTION_UNDER_RECORDED',
      explanation: `${reason} (correcting payment ref: ${original.transactionReference})`,
      approvedByUserId: correctedByUserId, approvalTimestamp: now, stationId, createdAt: now
    };
    await db.admin_adjustments.insert(adjustmentDoc);
    const allocationDocs = allocationResult.allocations.map((a) => ({
      allocationId: crypto.randomUUID(), adjustmentId, expectationId: a.expectationId,
      amountAllocated: a.amountAllocated, appliedDate: now, createdAt: now
    }));
    if (allocationDocs.length) await db.adjustment_allocations.bulkInsert(allocationDocs);
    relatedAdjustmentId = adjustmentId;
  } else {
    const expectationDoc = {
      expectationId: crypto.randomUUID(),
      studentId: original.studentId,
      school: original.school,
      category: 'Correction',
      description: `Payment correction — ${reason} (correcting payment ref: ${original.transactionReference})`,
      originalAmount: Math.abs(correctionAmount),
      dueDate: now.slice(0, 10),
      priorityTier: 1, // treated as urgent — this is money that should already have been collected
      createdAt: now,
      createdBy: stationId
    };
    await db.fee_expectations.insert(expectationDoc);
    relatedExpectationId = expectationDoc.expectationId;
  }

  const correctionDoc = {
    correctionId, originalPaymentId, studentId: original.studentId, school: original.school,
    correctionAmount, relatedAdjustmentId, relatedExpectationId, reason: reason.trim(),
    correctedByUserId, stationId, createdAt: now
  };
  await db.payment_corrections.insert(correctionDoc);
  return { correction: correctionDoc };
}

/** Every correction ever applied to a given payment — shown when
 * looking at a payment's details, so a past fix is never hidden. */
async function getCorrectionsForPayment(paymentId) {
  const db = await initDatabase();
  const raw = await db.payment_corrections.find({ selector: { originalPaymentId: paymentId } }).exec();
  return raw.map((c) => c.toJSON()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

// ---------- Sync conflict resolution ----------
async function upsertMutableRecord(collectionName, incomingDoc) {
  const db = await initDatabase();
  const collection = db[collectionName];
  if (!collection) throw new Error(`Unknown collection: ${collectionName}`);
  const primaryKey = collection.schema.primaryPath;
  const existing = await collection.findOne({ selector: { [primaryKey]: incomingDoc[primaryKey] } }).exec();
  if (!existing) {
    await collection.insert(incomingDoc);
    return { applied: true, conflict: false };
  }
  const existingJson = JSON.stringify(existing.toJSON());
  const incomingJson = JSON.stringify(incomingDoc);
  if (existingJson === incomingJson) {
    return { applied: false, conflict: false };
  }
  const existingUpdatedAt = existing.updatedAt || '';
  const incomingUpdatedAt = incomingDoc.updatedAt || '';
  let incomingWins = incomingUpdatedAt > existingUpdatedAt;
  if (incomingUpdatedAt === existingUpdatedAt) {
    incomingWins = (incomingDoc.updatedBy || '') > (existing.updatedBy || '');
  }
  const loser = incomingWins ? existing.toJSON() : incomingDoc;
  const winner = incomingWins ? incomingDoc : existing.toJSON();
  await db.conflict_log.insert({
    id: `${collectionName}_${incomingDoc[primaryKey]}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    collectionName,
    recordId: String(incomingDoc[primaryKey]),
    loserData: JSON.stringify(loser),
    winnerUpdatedAt: winner.updatedAt || '',
    loserUpdatedAt: loser.updatedAt || '',
    loserUpdatedBy: loser.updatedBy || '',
    resolvedAt: new Date().toISOString()
  });
  if (incomingWins) {
    await existing.incrementalPatch(incomingDoc);
  }
  return { applied: true, conflict: true, incomingWins };
}

// ---------- User management ----------
function generateTempPassword() {
  return crypto.randomBytes(8).toString('hex');
}

function stripSecrets(userDoc) {
  const { passwordHash, salt, ...safe } = userDoc;
  return safe;
}

async function listUsers(requestingRole) {
  const db = await initDatabase();
  const all = (await db.users.find().exec()).map((u) => stripSecrets(u.toJSON()));
  if (requestingRole === 'Superadmin') return all;
  if (requestingRole === 'Admin') return all.filter((u) => u.role === 'Secretary');
  throw new Error('Not authorized to view users.');
}

async function createUser({ requestingRole, username, firstName, lastName, email, phone, role, section }) {
  if (requestingRole === 'Admin' && role !== 'Secretary') {
    throw new Error('As an Admin, you can only create Secretary users.');
  }
  if (requestingRole !== 'Superadmin' && requestingRole !== 'Admin') {
    throw new Error('Not authorized to create users.');
  }
  if (!username || !role || !section) {
    throw new Error('username, role, and section are required.');
  }
  const db = await initDatabase();
  const existing = await db.users.findOne({ selector: { username } }).exec();
  if (existing) throw new Error(`Username "${username}" is already taken.`);
  const tempPassword = generateTempPassword();
  const { hash, salt } = hashPassword(tempPassword);
  const now = new Date().toISOString();
  await db.users.insert({
    username,
    passwordHash: hash,
    salt,
    role,
    section,
    firstName: firstName || '',
    lastName: lastName || '',
    email: email || '',
    phone: phone || '',
    lastLoginAt: '',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: getStationId()
  });
  return { username, tempPassword };
}

async function updateUser({ requestingRole, username, firstName, lastName, email, phone, role, section, isActive }) {
  const db = await initDatabase();
  const target = await db.users.findOne({ selector: { username } }).exec();
  if (!target) throw new Error('User not found.');
  if (requestingRole === 'Admin') {
    if (target.role !== 'Secretary') throw new Error('As an Admin, you can only edit Secretary users.');
    if (role !== 'Secretary') throw new Error('As an Admin, you can only assign the Secretary role.');
  } else if (requestingRole !== 'Superadmin') {
    throw new Error('Not authorized to edit users.');
  }
  await target.incrementalPatch({
    firstName: firstName || '',
    lastName: lastName || '',
    email: email || '',
    phone: phone || '',
    role,
    section,
    isActive: !!isActive,
    updatedAt: new Date().toISOString(),
    updatedBy: getStationId()
  });
  return true;
}

async function resetUserPassword({ requestingRole, username }) {
  const db = await initDatabase();
  const target = await db.users.findOne({ selector: { username } }).exec();
  if (!target) throw new Error('User not found.');
  if (requestingRole === 'Admin' && target.role !== 'Secretary') {
    throw new Error('As an Admin, you can only reset passwords for Secretary users.');
  } else if (requestingRole !== 'Superadmin' && requestingRole !== 'Admin') {
    throw new Error('Not authorized to reset passwords.');
  }
  const tempPassword = generateTempPassword();
  const { hash, salt } = hashPassword(tempPassword);
  await target.incrementalPatch({
    passwordHash: hash,
    salt,
    updatedAt: new Date().toISOString(),
    updatedBy: getStationId()
  });
  return { username, tempPassword };
}

async function getOwnProfile(username) {
  const db = await initDatabase();
  const target = await db.users.findOne({ selector: { username } }).exec();
  if (!target) throw new Error('User not found.');
  return stripSecrets(target.toJSON());
}

async function updateOwnProfile({ username, firstName, lastName, email, phone, avatarDataUrl }) {
  const db = await initDatabase();
  const target = await db.users.findOne({ selector: { username } }).exec();
  if (!target) throw new Error('User not found.');
  const patch = {
    firstName: firstName ?? target.firstName,
    lastName: lastName ?? target.lastName,
    email: email ?? target.email,
    phone: phone ?? target.phone,
    updatedAt: new Date().toISOString(),
    updatedBy: getStationId()
  };
  if (avatarDataUrl !== undefined) patch.avatarDataUrl = avatarDataUrl;
  await target.incrementalPatch(patch);
  return { ...target.toJSON(), ...patch };
}

async function changeOwnPassword({ username, currentPassword, newPassword }) {
  const db = await initDatabase();
  const target = await db.users.findOne({ selector: { username } }).exec();
  if (!target) throw new Error('User not found.');
  const ok = verifyPassword(currentPassword, target.salt, target.passwordHash);
  if (!ok) throw new Error('Current password is incorrect.');
  if (!newPassword || newPassword.length < 8) {
    throw new Error('New password must be at least 8 characters.');
  }
  const { hash, salt } = hashPassword(newPassword);
  const now = new Date().toISOString();
  await target.incrementalPatch({
    passwordHash: hash,
    salt,
    passwordChangedAt: now,
    updatedAt: now,
    updatedBy: getStationId()
  });
  return true;
}

// ---------- Dashboard & reports ----------
async function getSecretaryDashboardData(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const selector = scoped ? { school } : {};
  const [studentsRaw, paymentsRaw, expectationsRaw, allocationsRaw, adjAllocRaw, adjustmentsRaw] = await Promise.all([
    db.students.find({ selector }).exec(),
    db.payments.find({ selector }).exec(),
    db.fee_expectations.find({ selector }).exec(),
    db.allocations.find().exec(),
    db.adjustment_allocations.find().exec(),
    db.admin_adjustments.find({ selector }).exec()
  ]);
  const students = studentsRaw.map((s) => s.toJSON());
  // Two separate payment views, deliberately: `payments` (raw) feeds
  // computeFinancialHealth below, which already correctly accounts for
  // corrections through admin_adjustments/fee_expectations — inflating
  // payment.amount AND letting that same correction flow through
  // adjustmentAllocations would double-count it, producing a balance
  // that's wrong in the dangerous direction (looks paid off when it
  // isn't). `correctedPayments` is only for the simple sums below
  // (today/month/trend) and the recent-payments display list, neither
  // of which separately processes adjustments — those actually do need
  // the corrected figure to be accurate.
  const payments = paymentsRaw.map((p) => p.toJSON());
  const correctedPayments = await withCorrectedAmounts(db, payments);
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());
  const adjustments = adjustmentsRaw.map((a) => a.toJSON());
  const now = new Date();
  const todayStr = localDateStr(now);
  const monthStr = now.toISOString().slice(0, 7);
  const todaysPayments = correctedPayments.filter((p) => (p.paymentDate || '').slice(0, 10) === todayStr);
  const todayCount = todaysPayments.length;
  const todayTotal = todaysPayments.reduce((sum, p) => sum + p.amount, 0);
  const monthlyTotal = correctedPayments
    .filter((p) => (p.paymentDate || '').slice(0, 7) === monthStr)
    .reduce((sum, p) => sum + p.amount, 0);
  const studentSummaries = students.map((s) => {
    const exps = expectations.filter((e) => e.studentId === s.studentId);
    const pays = payments.filter((p) => p.studentId === s.studentId);
    const expIds = new Set(exps.map((e) => e.expectationId));
    const adjAllocs = adjustmentAllocations.filter((a) => expIds.has(a.expectationId));
    const studentAdjustments = adjustments.filter((a) => a.studentId === s.studentId);
    const health = ledgerEngine.computeFinancialHealth({ expectations: exps, payments: pays, allocations, adjustmentAllocations: adjAllocs, adjustments: studentAdjustments });
    return {
      studentId: s.studentId,
      name: `${s.firstName} ${s.lastName}`.trim(),
      studentNumber: s.studentNumber,
      classId: s.classId || '',
      ...health
    };
  });
  const outstanding = studentSummaries.filter((s) => s.status === 'Debtors' || s.status === 'Chronic Debtors');
  const highAlert = [...outstanding].sort((a, b) => b.balance - a.balance).slice(0, 10);
  const studentById = Object.fromEntries(students.map((s) => [s.studentId, s]));
  const recentPayments = [...correctedPayments]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6)
    .map((p) => {
      const s = studentById[p.studentId];
      return { ...p, studentName: s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown student' };
    });
  const trend = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = localMonthKey(d);
    const total = correctedPayments.filter((p) => (p.paymentDate || '').slice(0, 7) === key).reduce((sum, p) => sum + p.amount, 0);
    trend.push({ month: d.toLocaleDateString('en-US', { month: 'short' }), total });
  }
  return {
    todayCount,
    todayTotal,
    monthlyTotal,
    pendingBalancesCount: outstanding.length,
    recentPayments,
    highAlert,
    trend,
    yearlyTotal: trend.reduce((sum, t) => sum + t.total, 0)
  };
}

/**
 * Best and worst payers within each individual fee — not the overall
 * "who pays the most across everything" ranking, but "who's paid the
 * most toward Tuition specifically," "who owes the most on Bus fees
 * specifically," and so on for every category the school actually
 * charges. A student can rank well overall while still lagging on one
 * particular fee, and this is what surfaces that.
 */
async function getFeeCategoryLeaderboards(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const selector = scoped ? { school } : {};
  const [expectationsRaw, studentsRaw, allocationsRaw, adjAllocRaw] = await Promise.all([
    db.fee_expectations.find({ selector }).exec(),
    db.students.find({ selector }).exec(),
    db.allocations.find().exec(),
    db.adjustment_allocations.find().exec()
  ]);
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const studentById = Object.fromEntries(studentsRaw.map((s) => [s.studentId, s.toJSON()]));
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());

  const categories = [...new Set(expectations.map((e) => e.category))].sort();
  const leaderboards = categories.map((category) => {
    const catExpectations = expectations.filter((e) => e.category === category);
    const byStudent = {};
    catExpectations.forEach((e) => {
      const remaining = ledgerEngine.computeExpectationRemaining(e, allocations, adjustmentAllocations);
      const paid = ledgerEngine.round2(e.originalAmount - remaining);
      if (!byStudent[e.studentId]) byStudent[e.studentId] = { studentId: e.studentId, expected: 0, paid: 0, outstanding: 0 };
      byStudent[e.studentId].expected = ledgerEngine.round2(byStudent[e.studentId].expected + e.originalAmount);
      byStudent[e.studentId].paid = ledgerEngine.round2(byStudent[e.studentId].paid + paid);
      byStudent[e.studentId].outstanding = ledgerEngine.round2(byStudent[e.studentId].outstanding + Math.max(0, remaining));
    });
    const rows = Object.values(byStudent).map((r) => {
      const s = studentById[r.studentId];
      return { ...r, name: s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown', studentNumber: s?.studentNumber || '' };
    });
    return {
      category,
      studentsInvolved: rows.length,
      topPayers: [...rows].filter((r) => r.paid > 0).sort((a, b) => b.paid - a.paid).slice(0, 10),
      mostOwing: [...rows].filter((r) => r.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding).slice(0, 10)
    };
  });

  return leaderboards;
}

async function getTopListsData(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const selector = scoped ? { school } : {};
  const [studentsRaw, expectationsRaw, paymentsRaw, allocationsRaw, adjAllocRaw, adjustmentsRaw] = await Promise.all([
    db.students.find({ selector }).exec(),
    db.fee_expectations.find({ selector }).exec(),
    db.payments.find({ selector }).exec(),
    db.allocations.find().exec(),
    db.adjustment_allocations.find().exec(),
    db.admin_adjustments.find({ selector }).exec()
  ]);
  const students = studentsRaw.map((s) => s.toJSON());
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const payments = paymentsRaw.map((p) => p.toJSON());
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());
  const adjustments = adjustmentsRaw.map((a) => a.toJSON());
  const summaries = students.map((s) => {
    const exps = expectations.filter((e) => e.studentId === s.studentId);
    const pays = payments.filter((p) => p.studentId === s.studentId);
    const expIds = new Set(exps.map((e) => e.expectationId));
    const adjAllocs = adjustmentAllocations.filter((a) => expIds.has(a.expectationId));
    const studentAdjustments = adjustments.filter((a) => a.studentId === s.studentId);
    const health = ledgerEngine.computeFinancialHealth({ expectations: exps, payments: pays, allocations, adjustmentAllocations: adjAllocs, adjustments: studentAdjustments });
    return {
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      name: `${s.firstName} ${s.lastName}`.trim(),
      classId: s.classId || '',
      ...health
    };
  });
  const topDebtors = summaries
    .filter((s) => s.status === 'Debtors' || s.status === 'Chronic Debtors')
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 10);
  // "Top Payers" — the families who have actually paid the most,
  // historically. Ranking by "currently Overpaid" status alone was too
  // narrow: most reliable, paid-in-full families simply sit at a zero
  // balance rather than carrying a credit, so that list was often empty
  // even at a school collecting well. Total paid is a metric every
  // paying family contributes to, so this reliably has real data.
  const totalPaidByStudent = {};
  payments.forEach((p) => { totalPaidByStudent[p.studentId] = ledgerEngine.round2((totalPaidByStudent[p.studentId] || 0) + p.amount); });
  const topPayers = summaries
    .filter((s) => (totalPaidByStudent[s.studentId] || 0) > 0)
    .map((s) => ({ ...s, totalPaid: totalPaidByStudent[s.studentId] || 0 }))
    .sort((a, b) => b.totalPaid - a.totalPaid)
    .slice(0, 10);
  return { topDebtors, topPayers };
}

async function getArrearsLetterData(studentId) {
  const db = await initDatabase();
  const studentDoc = await db.students.findOne({ selector: { studentId } }).exec();
  if (!studentDoc) throw new Error('Student not found.');
  const student = studentDoc.toJSON();
  const guardianDoc = await db.guardians.findOne({ selector: { guardianId: student.guardianId } }).exec();
  const guardian = guardianDoc ? guardianDoc.toJSON() : null;
  const ledger = await getStudentLedger(studentId);
  const outstanding = ledger.expectations
    .filter((e) => e.remaining > 0)
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  return {
    student,
    guardian,
    outstanding,
    totalArrears: ledger.balance,
    status: ledger.status
  };
}

async function getFinancialReportData(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const selector = scoped ? { school } : {};
  const [studentsRaw, expectationsRaw, paymentsRaw, allocationsRaw, adjAllocRaw, adjustmentsRaw] = await Promise.all([
    db.students.find({ selector }).exec(),
    db.fee_expectations.find({ selector }).exec(),
    db.payments.find({ selector }).exec(),
    db.allocations.find().exec(),
    db.adjustment_allocations.find().exec(),
    db.admin_adjustments.find({ selector }).exec()
  ]);
  const students = studentsRaw.map((s) => s.toJSON());
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const payments = paymentsRaw.map((p) => p.toJSON());
  // Same split as getSecretaryDashboardData: `payments` (raw) feeds
  // computeFinancialHealth below, which already correctly accounts for
  // corrections through admin_adjustments/fee_expectations. `corrected
  // Payments` is only for the pure display totals further down
  // (totalPaid, totalCollected, monthCollections) — none of which
  // separately add adjustments back in, so they need the real, final
  // figure directly.
  const correctedPayments = await withCorrectedAmounts(db, payments);
  const correctedByStudentId = {};
  correctedPayments.forEach((p) => { (correctedByStudentId[p.studentId] = correctedByStudentId[p.studentId] || []).push(p); });
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());
  const adjustments = adjustmentsRaw.map((a) => a.toJSON());
  const rows = students.map((s) => {
    const exps = expectations.filter((e) => e.studentId === s.studentId);
    const pays = payments.filter((p) => p.studentId === s.studentId);
    const expIds = new Set(exps.map((e) => e.expectationId));
    const adjAllocs = adjustmentAllocations.filter((a) => expIds.has(a.expectationId));
    const studentAdjustments = adjustments.filter((a) => a.studentId === s.studentId);
    const health = ledgerEngine.computeFinancialHealth({ expectations: exps, payments: pays, allocations, adjustmentAllocations: adjAllocs, adjustments: studentAdjustments });
    const unpaidCount = exps.filter((e) => ledgerEngine.computeExpectationRemaining(e, allocations, adjustmentAllocations) > 0).length;
    let monthsAhead = null;
    if (health.status === 'Overpaid' && exps.length > 0) {
      const avgPerPeriod = exps.reduce((sum, e) => sum + e.originalAmount, 0) / exps.length;
      if (avgPerPeriod > 0) monthsAhead = Math.round((Math.abs(health.balance) / avgPerPeriod) * 10) / 10;
    }
    const totalExpected = exps.reduce((sum, e) => sum + e.originalAmount, 0);
    const totalPaid = (correctedByStudentId[s.studentId] || []).reduce((sum, p) => sum + p.amount, 0);
    return {
      studentId: s.studentId,
      studentNumber: s.studentNumber,
      name: `${s.firstName} ${s.lastName}`.trim(),
      school: s.school,
      status: health.status,
      balance: health.balance,
      maxAgeDays: health.maxAgeDays || 0,
      unpaidCount,
      monthsAhead,
      totalExpected,
      totalPaid,
      usesBus: !!s.usesBus,
      isHostelite: !!s.isHostelite
    };
  });
  const categoryCounts = { 'Chronic Debtors': 0, Debtors: 0, OK: 0, Good: 0, Overpaid: 0 };
  rows.forEach((r) => { categoryCounts[r.status] = (categoryCounts[r.status] || 0) + 1; });
  const totalCollected = correctedPayments.reduce((sum, p) => sum + p.amount, 0);
  const totalExpectedAll = expectations.reduce((sum, e) => sum + e.originalAmount, 0);
  const totalOutstanding = Math.max(0, rows.reduce((sum, r) => sum + Math.max(0, r.balance), 0));
  // Clamped at 100% — a student prepaying ahead pushes raw cash
  // received above what's ever been billed, which is real and useful
  // to know, but showing "Collection Rate: 111%" reads as a broken
  // report to anyone looking at it. That surplus is already tracked
  // separately (students paying ahead), so this figure stays a
  // genuine percentage of what was expected, not an unbounded ratio.
  const collectionRatePct = totalExpectedAll > 0 ? Math.min(100, Math.round((totalCollected / totalExpectedAll) * 100)) : 0;
  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);
  const monthCollections = correctedPayments.filter((p) => (p.paymentDate || '').slice(0, 7) === monthKey).reduce((sum, p) => sum + p.amount, 0);
  const monthExpectations = expectations.filter((e) => (e.dueDate || '').slice(0, 7) === monthKey).reduce((sum, e) => sum + e.originalAmount, 0);
  const cprPct = monthExpectations > 0 ? Math.round((monthCollections / monthExpectations) * 100) : null;
  return {
    generatedAt: new Date().toISOString(),
    totalStudents: rows.length,
    totalCollected,
    totalExpected: totalExpectedAll,
    totalOutstanding,
    collectionRatePct,
    cprPct,
    monthCollections,
    monthExpectations,
    categoryCounts,
    busCount: rows.filter((r) => r.usesBus).length,
    hostelCount: rows.filter((r) => r.isHostelite).length,
    rows: rows.sort((a, b) => b.balance - a.balance)
  };
}

/**
 * Per-secretary breakdown of what they've actually processed — daily,
 * monthly, yearly, all-time — for an admin to see individual performance
 * and spot anything that looks off. Two things worth being deliberate
 * about:
 *
 * - This reads .processedBy directly off each payment record, which is
 *   whichever station/username actually captured it — not a login-
 *   session guess, so it stays accurate even across shift changes.
 * - Includes a real reconciliation check, not just a display of numbers:
 *   the sum of every individual secretary's total is compared against
 *   the school-wide total for the same period. Since every payment
 *   should always have exactly one processedBy, these two sums should
 *   always match exactly, by construction. If they don't, that's not a
 *   rounding quirk — it means a payment exists with a processedBy that
 *   doesn't match any real user account, which is worth investigating
 *   directly rather than silently absorbed into a total.
 */
/**
 * How many students fall into each category — bus, hostel, scholarship
 * — per school, with the money tied to each. This is the "how many
 * students and what's it worth" breakdown that sits alongside the
 * financial totals in the full report.
 */
/**
 * Per fee-template breakdown: how many students are actually tied to
 * each fee (a recurring one like Tuition, or a one-time one like an
 * extracurricular charge), and what that adds up to — this month, and
 * for recurring fees, roughly for the year too.
 *
 * Recurring (frequency 'monthly' on the template itself) fees are
 * counted from real, active fee_assignments — the persistent ties
 * created when a fee is tied to students — using each assignment's own
 * amount, which already reflects grade-tiered pricing correctly. The
 * yearly figure is a straightforward times-12 of the current monthly
 * figure, clearly labeled as an estimate — it assumes the same students
 * stay tied at the same amount all year, which is a reasonable
 * approximation, not a guarantee.
 *
 * One-time (and termly/yearly) fees don't have a persistent tie the
 * same way — they're billed directly. "Tied to this fee" here means
 * "actually billed this fee, this month" — matched first by templateId
 * (for charges billed with the new template-linked path), falling back
 * to matching category+description against the template for older
 * charges billed before that link existed, so historical data isn't
 * silently excluded.
 *
 * The combined "expected this month" figure — the actual point of this
 * function — is the recurring total plus the one-time total for the
 * current month, shown together AND broken out separately, since both
 * views matter for different questions.
 */
/**
 * The full monthly management report — everything scoped to one
 * specific month, structured to match a formal monthly financial
 * management report: executive summary, daily/weekly trend, fee
 * category/grade/class/transport/hostel breakdowns, payment methods,
 * secretary performance, debtor lists, students paid ahead, a ledger
 * summary, trend comparison against recent months, and automatically
 * generated alerts — all computed from real records, nothing narrated
 * or estimated beyond what's explicitly labeled as such.
 *
 * A few honest limits, stated here rather than silently worked around:
 * - This system doesn't track cash "refunds" — it's cashless by design,
 *   and payments are never deleted, only corrected via a new linked
 *   record (see payment_corrections). "Refunds" in the classic sense
 *   don't apply; a downward correction is the closest equivalent and is
 *   reported as that, not relabeled as a refund.
 * - There's no separate "bus route" field — buses are tracked by type
 *   (Kinder / Pre-Grade / Grade 1-12), which is what the transport
 *   section groups by.
 * - "Cancelled receipts" doesn't apply either — every payment record is
 *   permanent by design, so there's nothing to report as cancelled.
 */
async function getMonthlyManagementReport(school, monthKey) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const targetMonth = monthKey || new Date().toISOString().slice(0, 7);
  const [y, m] = targetMonth.split('-').map(Number);
  const monthStart = new Date(y, m - 1, 1);
  const monthEnd = new Date(y, m, 0);
  const daysInMonth = monthEnd.getDate();
  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const studentSelector = scoped ? { school, enrollmentStatus: 'Active' } : { enrollmentStatus: 'Active' };
  const paymentSelector = scoped ? { school } : {};
  const expectationSelector = scoped ? { school } : {};

  const [studentsRaw, paymentsRaw, expectationsRaw, allocationsRaw, adjustmentsRaw, adjAllocRaw, classesRaw, usersRaw] = await Promise.all([
    db.students.find({ selector: studentSelector }).exec(),
    db.payments.find({ selector: paymentSelector }).exec(),
    db.fee_expectations.find({ selector: expectationSelector }).exec(),
    db.allocations.find().exec(),
    db.admin_adjustments.find({ selector: scoped ? { school } : {} }).exec(),
    db.adjustment_allocations.find().exec(),
    db.classes.find({ selector: scoped ? { school } : {} }).exec(),
    db.users.find({ selector: { role: 'Secretary' } }).exec()
  ]);

  const students = studentsRaw.map((s) => s.toJSON());
  const rawPayments = paymentsRaw.map((p) => p.toJSON());
  const payments = await withCorrectedAmounts(db, rawPayments);
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustments = adjustmentsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());
  const classes = classesRaw.map((c) => c.toJSON());
  const classById = Object.fromEntries(classes.map((c) => [c.classId, c]));
  const studentById = Object.fromEntries(students.map((s) => [s.studentId, s]));
  const secretaryUsers = usersRaw.map((u) => u.toJSON()).filter((u) => !scoped || u.section === school || u.section === 'Both');

  const round2 = (n) => ledgerEngine.round2(n);
  const inMonth = (dateStr) => (dateStr || '').slice(0, 7) === targetMonth;
  const paymentsThisMonth = payments.filter((p) => inMonth(p.paymentDate));

  // ---- Per-student month position: expected, paid, status, for
  // whatever was actually charged to them THIS month specifically ----
  const monthExpectationsByStudent = {};
  expectations.forEach((e) => {
    const belongsToMonth = e.billingPeriod ? e.billingPeriod === targetMonth : inMonth(e.dueDate) || inMonth(e.createdAt);
    if (!belongsToMonth) return;
    (monthExpectationsByStudent[e.studentId] = monthExpectationsByStudent[e.studentId] || []).push(e);
  });

  function remainingFor(exp) {
    return computeExpectationRemainingHelper(exp, allocations, adjustmentAllocations, round2);
  }

  const studentMonthStatus = {}; // studentId -> { expected, remaining, status }
  Object.entries(monthExpectationsByStudent).forEach(([studentId, exps]) => {
    const expected = round2(exps.reduce((s, e) => s + e.originalAmount, 0));
    const remaining = round2(exps.reduce((s, e) => s + remainingFor(e), 0));
    const status = remaining <= 0 ? 'Paid' : remaining < expected ? 'Partial' : 'Unpaid';
    studentMonthStatus[studentId] = { expected, remaining, collected: round2(expected - remaining), status };
  });

  const studentsExpectedToPay = Object.keys(studentMonthStatus).length;
  const studentsPaidFull = Object.values(studentMonthStatus).filter((s) => s.status === 'Paid').length;
  const studentsPartial = Object.values(studentMonthStatus).filter((s) => s.status === 'Partial').length;
  const studentsUnpaid = Object.values(studentMonthStatus).filter((s) => s.status === 'Unpaid').length;
  const totalExpectedThisMonth = round2(Object.values(studentMonthStatus).reduce((s, v) => s + v.expected, 0));
  const totalOutstandingThisMonth = round2(Object.values(studentMonthStatus).reduce((s, v) => s + Math.max(0, v.remaining), 0));
  // Deliberately the complement of Expected/Outstanding above (Expected
  // − Outstanding), not a raw sum of payment amounts dated this month —
  // those aren't the same thing once prepayments exist. A parent paying
  // ahead for next month, or settling an old balance from a prior month,
  // both show up as real payment activity "this month" by date, but
  // neither is money collected against *this month's* specific bills.
  // Keeping this figure scoped the same way as the other two is what
  // makes Expected − Collected = Outstanding actually hold true, the
  // way a financial report needs it to.
  const totalCollectedThisMonth = round2(totalExpectedThisMonth - totalOutstandingThisMonth);

  // ---- Whole-ledger status per student (for overall balance/overpaid/debtor classification, not month-scoped) ----
  const healthByStudent = {};
  students.forEach((s) => {
    const exps = expectations.filter((e) => e.studentId === s.studentId);
    // rawPayments here deliberately, not the corrected `payments` above
    // (which exists only for the month-scoped sums) — computeFinancialHealth
    // needs the uncorrected amounts paired with the real adjustment
    // records, or a correction would be counted twice.
    const pays = rawPayments.filter((p) => p.studentId === s.studentId);
    const studentAdjustments = adjustments.filter((a) => a.studentId === s.studentId);
    // Filtered to this student's own expectations — without this,
    // another student's allocated adjustment (e.g. their own payment
    // correction that did get applied against real debt) leaks into
    // this student's balance, since adjustment_allocations isn't
    // scoped by student directly, only by expectationId.
    const expIds = new Set(exps.map((e) => e.expectationId));
    const studentAdjustmentAllocations = adjustmentAllocations.filter((a) => expIds.has(a.expectationId));
    healthByStudent[s.studentId] = ledgerEngine.computeFinancialHealth({ expectations: exps, payments: pays, allocations, adjustmentAllocations: studentAdjustmentAllocations, adjustments: studentAdjustments });
  });

  // ---- Discounts/waivers granted this month (real, tracked data) ----
  const discountAdjustments = adjustments.filter((a) => inMonth(a.approvalTimestamp) && (a.type === 'DISCOUNT' || a.type === 'WAIVER'));
  const discountsGranted = round2(discountAdjustments.reduce((s, a) => s + a.amount, 0));

  // A separate figure from totalCollectedThisMonth above — raw money
  // received this month by payment date, regardless of which month's
  // bill it settled. Used below for payment-method and ledger-cashflow
  // views, where "how much actually came in" is the right question,
  // as distinct from "how much of this month's bills got paid."
  const cashReceivedThisMonth = round2(paymentsThisMonth.reduce((s, p) => s + p.amount, 0));

  // ---- Students paying ahead (Overpaid — a negative balance, i.e. a credit) ----
  const studentsAhead = students
    .filter((s) => healthByStudent[s.studentId].status === 'Overpaid')
    .map((s) => ({ studentId: s.studentId, name: `${s.firstName} ${s.lastName}`.trim(), studentNumber: s.studentNumber, creditBalance: round2(-healthByStudent[s.studentId].balance) }))
    .sort((a, b) => b.creditBalance - a.creditBalance);

  // ---- Daily trend across the month ----
  const dailyTrend = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${targetMonth}-${String(d).padStart(2, '0')}`;
    const dayPayments = paymentsThisMonth.filter((p) => p.paymentDate === dateStr);
    dailyTrend.push({ date: dateStr, total: round2(dayPayments.reduce((s, p) => s + p.amount, 0)), count: dayPayments.length });
  }

  // ---- Weekly summary (calendar weeks within the month) ----
  const weeklySummary = [];
  for (let weekStart = 1; weekStart <= daysInMonth; weekStart += 7) {
    const weekEnd = Math.min(weekStart + 6, daysInMonth);
    const weekDates = dailyTrend.slice(weekStart - 1, weekEnd);
    const collected = round2(weekDates.reduce((s, d) => s + d.total, 0));
    weeklySummary.push({ week: `Week ${weeklySummary.length + 1} (${weekStart}\u2013${weekEnd})`, collected });
  }

  // ---- Fee category performance ----
  const categoriesSeen = [...new Set(expectations.map((e) => e.category))];
  const feeCategoryPerformance = categoriesSeen.map((category) => {
    const exps = expectations.filter((e) => e.category === category);
    const studentIds = new Set(exps.map((e) => e.studentId));
    const expected = round2(exps.reduce((s, e) => s + e.originalAmount, 0));
    const remaining = round2(exps.reduce((s, e) => s + remainingFor(e), 0));
    return { category, students: studentIds.size, expected, collected: round2(expected - remaining), outstanding: Math.max(0, remaining), collectionPct: expected > 0 ? Math.min(100, Math.round(((expected - remaining) / expected) * 100)) : 0 };
  }).sort((a, b) => b.expected - a.expected);

  // ---- Grade & class performance (this month's position specifically) ----
  const gradeMap = {}; const classMap = {};
  Object.entries(studentMonthStatus).forEach(([studentId, status]) => {
    const student = studentById[studentId];
    if (!student) return;
    const cls = classById[student.classId];
    const gradeKey = cls ? `Grade ${cls.gradeLevel}` : 'Unassigned';
    const classKey = cls ? cls.className : 'Unassigned';
    if (!gradeMap[gradeKey]) gradeMap[gradeKey] = { grade: gradeKey, students: 0, paid: 0, partial: 0, unpaid: 0, collected: 0, outstanding: 0 };
    if (!classMap[classKey]) classMap[classKey] = { className: classKey, students: 0, paid: 0, partial: 0, unpaid: 0, outstanding: 0 };
    gradeMap[gradeKey].students += 1; classMap[classKey].students += 1;
    if (status.status === 'Paid') { gradeMap[gradeKey].paid += 1; classMap[classKey].paid += 1; }
    else if (status.status === 'Partial') { gradeMap[gradeKey].partial += 1; classMap[classKey].partial += 1; }
    else { gradeMap[gradeKey].unpaid += 1; classMap[classKey].unpaid += 1; }
    gradeMap[gradeKey].collected = round2(gradeMap[gradeKey].collected + status.collected);
    gradeMap[gradeKey].outstanding = round2(gradeMap[gradeKey].outstanding + Math.max(0, status.remaining));
    classMap[classKey].outstanding = round2(classMap[classKey].outstanding + Math.max(0, status.remaining));
  });
  const gradePerformance = Object.values(gradeMap).sort((a, b) => a.grade.localeCompare(b.grade, undefined, { numeric: true }));
  const classPerformance = Object.values(classMap).sort((a, b) => b.outstanding - a.outstanding);

  // ---- Transport & hostel (grouped by type, since there's no separate route field) ----
  const transportMap = {};
  students.filter((s) => s.usesBus).forEach((s) => {
    const key = s.busType || 'Unspecified';
    if (!transportMap[key]) transportMap[key] = { busType: key, students: 0, outstanding: 0 };
    transportMap[key].students += 1;
    transportMap[key].outstanding = round2(transportMap[key].outstanding + Math.max(0, healthByStudent[s.studentId]?.balance || 0));
  });
  const transportReport = Object.values(transportMap);

  const hostelMap = {};
  students.filter((s) => s.isHostelite).forEach((s) => {
    const key = s.hostelType || 'Unspecified';
    if (!hostelMap[key]) hostelMap[key] = { hostelType: key, students: 0, outstanding: 0 };
    hostelMap[key].students += 1;
    hostelMap[key].outstanding = round2(hostelMap[key].outstanding + Math.max(0, healthByStudent[s.studentId]?.balance || 0));
  });
  const hostelReport = Object.values(hostelMap);

  // ---- Payment methods ----
  const eftPayments = paymentsThisMonth.filter((p) => p.paymentMethod === 'EFT');
  const posPayments = paymentsThisMonth.filter((p) => p.paymentMethod === 'POS');
  const paymentMethods = [
    { method: 'EFT', transactions: eftPayments.length, amount: round2(eftPayments.reduce((s, p) => s + p.amount, 0)) },
    { method: 'POS (Card)', transactions: posPayments.length, amount: round2(posPayments.reduce((s, p) => s + p.amount, 0)) }
  ].map((m) => ({ ...m, pct: cashReceivedThisMonth > 0 ? Math.round((m.amount / cashReceivedThisMonth) * 100) : 0 }));

  // ---- Secretary performance + activity timeline, this month ----
  const secretaryPerformance = secretaryUsers.map((u) => {
    const pays = paymentsThisMonth.filter((p) => p.processedBy === u.username);
    return {
      username: u.username, name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username,
      transactions: pays.length, amountCollected: round2(pays.reduce((s, p) => s + p.amount, 0)),
      averageTransaction: pays.length ? round2(pays.reduce((s, p) => s + p.amount, 0) / pays.length) : 0
    };
  }).sort((a, b) => b.amountCollected - a.amountCollected);

  const timelineMap = {};
  paymentsThisMonth.forEach((p) => {
    const key = `${p.paymentDate}|${p.processedBy}`;
    if (!timelineMap[key]) {
      const u = secretaryUsers.find((su) => su.username === p.processedBy);
      timelineMap[key] = { date: p.paymentDate, secretary: u ? `${u.firstName} ${u.lastName}`.trim() : p.processedBy, count: 0, amount: 0 };
    }
    timelineMap[key].count += 1;
    timelineMap[key].amount = round2(timelineMap[key].amount + p.amount);
  });
  const secretaryActivityTimeline = Object.values(timelineMap).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);

  // ---- Outstanding / debtors / paid-in-full (this month's position) ----
  function studentRow(studentId) {
    const s = studentById[studentId];
    const cls = s ? classById[s.classId] : null;
    return {
      studentId, studentNumber: s?.studentNumber || '', name: s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown',
      grade: cls ? cls.gradeLevel : null, className: cls ? cls.className : ''
    };
  }
  const outstandingStudents = Object.entries(studentMonthStatus)
    .filter(([, v]) => v.remaining > 0)
    .map(([studentId, v]) => ({ ...studentRow(studentId), owed: v.remaining, daysOverdue: healthByStudent[studentId]?.maxAgeDays || 0 }))
    .sort((a, b) => b.owed - a.owed);
  const highestDebtors = outstandingStudents.slice(0, 20);
  const studentsPaidInFull = Object.entries(studentMonthStatus)
    .filter(([, v]) => v.status === 'Paid')
    .map(([studentId, v]) => ({ ...studentRow(studentId), paid: v.collected }));

  // ---- Monthly ledger summary ----
  const openingBalance = round2(students.reduce((sum, s) => {
    const exps = expectations.filter((e) => e.studentId === s.studentId && (e.billingPeriod ? e.billingPeriod < targetMonth : (e.dueDate || '').slice(0, 7) < targetMonth));
    const pays = rawPayments.filter((p) => p.studentId === s.studentId && (p.paymentDate || '').slice(0, 7) < targetMonth);
    const studentAdjustments = adjustments.filter((a) => a.studentId === s.studentId && (a.approvalTimestamp || '').slice(0, 7) < targetMonth);
    const expIds = new Set(exps.map((e) => e.expectationId));
    const studentAdjustmentAllocations = adjustmentAllocations.filter((a) => expIds.has(a.expectationId));
    const health = ledgerEngine.computeFinancialHealth({ expectations: exps, payments: pays, allocations, adjustmentAllocations: studentAdjustmentAllocations, adjustments: studentAdjustments });
    return sum + health.balance;
  }, 0));
  const monthlyLedgerSummary = {
    openingBalance,
    charges: totalExpectedThisMonth,
    payments: cashReceivedThisMonth,
    discounts: discountsGranted,
    closingBalance: round2(openingBalance + totalExpectedThisMonth - cashReceivedThisMonth - discountsGranted)
  };

  // ---- Trend vs recent months (last 4 including this one) ----
  const trendAnalysis = [];
  for (let i = 3; i >= 0; i--) {
    const d = new Date(y, m - 1 - i, 1);
    const key = d.toISOString().slice(0, 7);
    const monthExps = expectations.filter((e) => (e.billingPeriod ? e.billingPeriod === key : (e.dueDate || '').slice(0, 7) === key));
    const expected = round2(monthExps.reduce((s, e) => s + e.originalAmount, 0));
    const remaining = round2(monthExps.reduce((s, e) => s + remainingFor(e), 0));
    trendAnalysis.push({
      month: d.toLocaleDateString('en-US', { month: 'long' }), expected, collected: round2(expected - remaining),
      outstanding: Math.max(0, remaining), collectionPct: expected > 0 ? Math.min(100, Math.round(((expected - remaining) / expected) * 100)) : 0
    });
  }

  // ---- Alerts (real thresholds against real data, not narrated) ----
  const alerts = [];
  const bigDebtors = students.filter((s) => (healthByStudent[s.studentId]?.balance || 0) > 10000);
  if (bigDebtors.length > 0) alerts.push({ type: 'High Balance', message: `${bigDebtors.length} student(s) owe more than N$10,000.` });
  const overdueStudents = students.filter((s) => (healthByStudent[s.studentId]?.maxAgeDays || 0) > 30 && (healthByStudent[s.studentId]?.balance || 0) > 0);
  if (overdueStudents.length > 0) alerts.push({ type: 'Overdue', message: `${overdueStudents.length} student(s) have payments overdue by more than 30 days.` });
  const avgSecretaryAmount = secretaryPerformance.length ? secretaryPerformance.reduce((s, r) => s + r.amountCollected, 0) / secretaryPerformance.length : 0;
  const belowAverage = secretaryPerformance.filter((r) => r.transactions > 0 && r.amountCollected < avgSecretaryAmount * 0.5);
  if (belowAverage.length > 0) alerts.push({ type: 'Secretary Activity', message: `${belowAverage.length} secretary account(s) collected under half the team average this month.` });
  const allKnownUsernames = new Set((await db.users.find().exec()).map((u) => u.toJSON().username));
  const orphaned = paymentsThisMonth.filter((p) => !allKnownUsernames.has(p.processedBy));
  if (orphaned.length > 0) alerts.push({ type: 'Unrecognized Account', message: `${orphaned.length} payment(s) this month are recorded under an account that doesn't match any known user.` });
  // Uses actual cash received, not the bill-settlement "Collected"
  // figure above — that one is the complement of Outstanding, so it's
  // mathematically capped at 100% of Expected by definition and could
  // never trigger the over-100% case. Cash received is real money in
  // the door regardless of which bill it settles, which genuinely can
  // exceed what was billed this month (a lot of prepayments landing at
  // once) or fall well short of it.
  if (totalExpectedThisMonth > 0) {
    const cashReceivedPct = Math.round((cashReceivedThisMonth / totalExpectedThisMonth) * 100);
    if (cashReceivedPct > 100) {
      alerts.push({ type: 'Collection Above Expected', message: `Money received this month (${dbMoney(cashReceivedThisMonth)}) exceeds 100% of what was expected (${dbMoney(totalExpectedThisMonth)}) — likely prepayments landing this month, worth a quick check.` });
    } else if (cashReceivedPct < 50) {
      alerts.push({ type: 'Collection Below Expected', message: `Money received this month (${dbMoney(cashReceivedThisMonth)}) is under 50% of what was expected (${dbMoney(totalExpectedThisMonth)}) — collection is running well behind this month.` });
    }
  }

  return {
    meta: { school, monthKey: targetMonth, monthLabel, generatedAt: new Date().toISOString(), daysInMonth },
    executiveSummary: {
      registeredStudents: students.length, studentsExpectedToPay, studentsPaidFull, studentsPartial, studentsUnpaid,
      totalExpected: totalExpectedThisMonth, totalCollected: totalCollectedThisMonth, totalOutstanding: totalOutstandingThisMonth,
      collectionRatePct: totalExpectedThisMonth > 0 ? Math.round((totalCollectedThisMonth / totalExpectedThisMonth) * 100) : 0,
      receiptsIssued: paymentsThisMonth.length, discountsGranted,
      studentsAheadCount: studentsAhead.length, studentsAheadAmount: round2(studentsAhead.reduce((s, r) => s + r.creditBalance, 0))
    },
    dailyTrend, weeklySummary, feeCategoryPerformance, gradePerformance, classPerformance,
    transportReport, hostelReport, paymentMethods, secretaryPerformance, secretaryActivityTimeline,
    outstandingStudents, highestDebtors, studentsPaidInFull, studentsAhead,
    monthlyLedgerSummary, trendAnalysis, alerts
  };
}

/**
 * Alerts for the current month, across both schools — what the CEO/Admin
 * notification page and login popup actually display. Reuses the same
 * alert logic already computed (and tested) inside the monthly report,
 * rather than a second, separate alert system that could drift out of
 * sync with what the report itself shows.
 */
async function getActiveAlerts() {
  const monthKey = new Date().toISOString().slice(0, 7);
  const [wendyReport, keilaReport] = await Promise.all([
    getMonthlyManagementReport('WENDY', monthKey).catch(() => ({ alerts: [] })),
    getMonthlyManagementReport('KEILA', monthKey).catch(() => ({ alerts: [] }))
  ]);
  const withSchool = (alerts, school) => alerts.map((a) => ({ ...a, school, id: `${school}-${a.type}-${a.message.slice(0, 20)}` }));
  return [...withSchool(wendyReport.alerts, 'WENDY'), ...withSchool(keilaReport.alerts, 'KEILA')];
}

function computeExpectationRemainingHelper(expectation, allocations, adjustmentAllocations, round2) {
  const allocated = allocations.filter((a) => a.expectationId === expectation.expectationId).reduce((s, a) => s + a.amountAllocated, 0);
  const adjusted = adjustmentAllocations.filter((a) => a.expectationId === expectation.expectationId).reduce((s, a) => s + a.amountAllocated, 0);
  return Math.max(0, round2(expectation.originalAmount - allocated - adjusted));
}

async function getFeeTemplateBreakdown(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const templateSelector = scoped ? { school, isActive: true } : { isActive: true };
  const templatesRaw = await db.fee_catalog_templates.find({ selector: templateSelector }).exec();
  const templates = templatesRaw.map((t) => t.toJSON()).filter((t) => scoped ? true : (t.school === school || t.school === 'SHARED'));

  const now = new Date();
  const monthKey = now.toISOString().slice(0, 7);

  const assignmentSelector = scoped ? {} : {}; // fee_assignments aren't school-tagged directly — filtered via studentId's school below where needed, but templateId scoping already narrows this correctly per school since templates are school-specific
  const [assignmentsRaw, expectationsRaw] = await Promise.all([
    db.fee_assignments.find({ selector: { isActive: true } }).exec(),
    db.fee_expectations.find().exec()
  ]);
  const assignments = assignmentsRaw.map((a) => a.toJSON());
  const expectations = expectationsRaw.map((e) => e.toJSON());

  const rows = templates.map((template) => {
    const isRecurring = template.frequency === 'monthly';
    if (isRecurring) {
      const tied = assignments.filter((a) => a.feeTemplateId === template.templateId);
      const expectedThisMonth = ledgerEngine.round2(tied.reduce((s, a) => s + a.amount, 0));
      return {
        templateId: template.templateId, itemName: template.itemName, category: template.category,
        frequency: template.frequency, standardCharge: template.standardCharge,
        studentsTied: tied.length,
        expectedThisMonth,
        expectedThisYear: ledgerEngine.round2(expectedThisMonth * 12),
        isRecurring: true
      };
    }
    const matched = expectations.filter((e) => {
      if (e.templateId) return e.templateId === template.templateId;
      // Fallback for charges billed before template-linking existed —
      // matched by name, the best available signal for older records.
      return e.category === template.category && e.description === template.itemName;
    });
    const thisMonth = matched.filter((e) => (e.createdAt || '').slice(0, 7) === monthKey);
    const uniqueStudentsThisMonth = new Set(thisMonth.map((e) => e.studentId));
    return {
      templateId: template.templateId, itemName: template.itemName, category: template.category,
      frequency: template.frequency, standardCharge: template.standardCharge,
      studentsTied: uniqueStudentsThisMonth.size,
      expectedThisMonth: ledgerEngine.round2(thisMonth.reduce((s, e) => s + e.originalAmount, 0)),
      expectedThisYear: null, // not a recurring fee — a yearly projection doesn't mean the same thing here
      isRecurring: false
    };
  }).sort((a, b) => b.expectedThisMonth - a.expectedThisMonth);

  const monthlyRecurringExpectedThisMonth = ledgerEngine.round2(rows.filter((r) => r.isRecurring).reduce((s, r) => s + r.expectedThisMonth, 0));
  const monthlyRecurringExpectedThisYear = ledgerEngine.round2(monthlyRecurringExpectedThisMonth * 12);
  const oneTimeExpectedThisMonth = ledgerEngine.round2(rows.filter((r) => !r.isRecurring).reduce((s, r) => s + r.expectedThisMonth, 0));
  const combinedExpectedThisMonth = ledgerEngine.round2(monthlyRecurringExpectedThisMonth + oneTimeExpectedThisMonth);

  return {
    rows,
    summary: {
      monthlyRecurringExpectedThisMonth,
      monthlyRecurringExpectedThisYear,
      oneTimeExpectedThisMonth,
      combinedExpectedThisMonth
    }
  };
}

async function getSchoolCategoryBreakdown(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const selector = scoped ? { school, enrollmentStatus: 'Active' } : { enrollmentStatus: 'Active' };
  const studentsRaw = await db.students.find({ selector }).exec();
  const students = studentsRaw.map((s) => s.toJSON());

  const bySchool = {};
  students.forEach((s) => {
    if (!bySchool[s.school]) {
      bySchool[s.school] = { school: s.school, totalStudents: 0, busUsers: 0, hostelites: 0, onScholarship: 0, byGrade: {} };
    }
    const b = bySchool[s.school];
    b.totalStudents += 1;
    if (s.usesBus) b.busUsers += 1;
    if (s.isHostelite) b.hostelites += 1;
    if (s.isOnScholarship) b.onScholarship += 1;
  });

  // Grade breakdown needs each student's class, since gradeLevel lives
  // on the class record, not the student directly.
  const classIds = [...new Set(students.map((s) => s.classId).filter(Boolean))];
  const classesRaw = classIds.length ? await db.classes.find({ selector: { classId: { $in: classIds } } }).exec() : [];
  const classById = Object.fromEntries(classesRaw.map((c) => [c.classId, c.toJSON()]));
  students.forEach((s) => {
    const cls = classById[s.classId];
    if (!cls) return;
    const b = bySchool[s.school];
    const key = `Grade ${cls.gradeLevel}`;
    b.byGrade[key] = (b.byGrade[key] || 0) + 1;
  });

  return Object.values(bySchool);
}

/**
 * A deliberately simple, honestly-labeled projection — not a
 * statistical model, just "at the rate money has come in so far this
 * month/year, here's roughly where it's headed by the end." Explained
 * in the report itself the same plain way, since a run-rate estimate
 * ("if the rest of the month goes like the days so far") is something
 * anyone can follow, where something like a regression line isn't.
 */
async function getFinancialForecast(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const selector = scoped ? { school } : {};
  const paymentsRaw = await db.payments.find({ selector }).exec();
  const payments = await withCorrectedAmounts(db, paymentsRaw.map((p) => p.toJSON()));

  const now = new Date();
  const monthStr = now.toISOString().slice(0, 7);
  const yearStr = now.toISOString().slice(0, 4);
  const dayOfMonth = now.getDate();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfYear = Math.ceil((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
  const daysInYear = (now.getFullYear() % 4 === 0 && (now.getFullYear() % 100 !== 0 || now.getFullYear() % 400 === 0)) ? 366 : 365;

  const round2 = (n) => ledgerEngine.round2(n);
  const sum = (arr) => round2(arr.reduce((s, p) => s + p.amount, 0));

  const collectedThisMonth = sum(payments.filter((p) => (p.paymentDate || '').slice(0, 7) === monthStr));
  const collectedThisYear = sum(payments.filter((p) => (p.paymentDate || '').slice(0, 4) === yearStr));

  const projectedMonthTotal = dayOfMonth > 0 ? round2((collectedThisMonth / dayOfMonth) * daysInMonth) : 0;
  const projectedYearTotal = dayOfYear > 0 ? round2((collectedThisYear / dayOfYear) * daysInYear) : 0;

  // Trailing 6 real, completed months — actual history, not a projection,
  // shown alongside so the projection above has visible context rather
  // than appearing out of nowhere.
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = localMonthKey(d);
    const total = sum(payments.filter((p) => (p.paymentDate || '').slice(0, 7) === key));
    monthlyTrend.push({ month: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), total });
  }
  const completedMonths = monthlyTrend.slice(0, -1); // exclude the current, still-in-progress month from the average
  const averageMonthlyCollection = completedMonths.length
    ? round2(completedMonths.reduce((s, m) => s + m.total, 0) / completedMonths.length)
    : 0;

  return {
    collectedThisMonth, collectedThisYear,
    projectedMonthTotal, projectedYearTotal,
    dayOfMonth, daysInMonth, dayOfYear, daysInYear,
    monthlyTrend, averageMonthlyCollection
  };
}

async function getSecretaryPerformanceData(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const paymentSelector = scoped ? { school } : {};

  const [paymentsRaw, usersRaw, allUsersRaw] = await Promise.all([
    db.payments.find({ selector: paymentSelector }).exec(),
    db.users.find({ selector: { role: 'Secretary' } }).exec(),
    db.users.find().exec()
  ]);
  const rawPayments = paymentsRaw.map((p) => p.toJSON());
  const payments = await withCorrectedAmounts(db, rawPayments);
  const users = usersRaw
    .map((u) => u.toJSON())
    .filter((u) => !scoped || u.section === school || u.section === 'Both');
  // Every real account, Secretary or not — used only for reconciliation
  // below, so a payment an Admin genuinely processed is never mistaken
  // for orphaned/bad data just because Admins aren't shown as cards on
  // this page. This page displays Secretary activity specifically; the
  // reconciliation check still needs to recognize every real account.
  const allKnownUsernames = new Set(allUsersRaw.map((u) => u.toJSON().username));

  const now = new Date();
  const todayStr = localDateStr(now);
  const monthStr = now.toISOString().slice(0, 7);
  const yearStr = now.toISOString().slice(0, 4);
  const sumAmount = (arr) => ledgerEngine.round2(arr.reduce((s, p) => s + p.amount, 0));

  const byUser = {};
  payments.forEach((p) => {
    (byUser[p.processedBy] = byUser[p.processedBy] || []).push(p);
  });

  const secretaries = users.map((u) => {
    const pays = byUser[u.username] || [];
    const todayPays = pays.filter((p) => (p.paymentDate || '').slice(0, 10) === todayStr);
    const monthPays = pays.filter((p) => (p.paymentDate || '').slice(0, 7) === monthStr);
    const yearPays = pays.filter((p) => (p.paymentDate || '').slice(0, 4) === yearStr);
    return {
      username: u.username,
      name: `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username,
      role: u.role,
      section: u.section,
      todayTotal: sumAmount(todayPays), todayCount: todayPays.length,
      monthTotal: sumAmount(monthPays), monthCount: monthPays.length,
      yearTotal: sumAmount(yearPays), yearCount: yearPays.length,
      allTimeTotal: sumAmount(pays), allTimeCount: pays.length,
      eftTotal: sumAmount(pays.filter((p) => p.paymentMethod === 'EFT')),
      posTotal: sumAmount(pays.filter((p) => p.paymentMethod === 'POS')),
      lastPaymentAt: pays.length ? pays.reduce((max, p) => (p.createdAt > max ? p.createdAt : max), pays[0].createdAt) : null
    };
  }).sort((a, b) => b.monthTotal - a.monthTotal);

  // Reconciliation — the real question this answers is "does every
  // recorded payment belong to a real, known account," not "does the
  // sum of Secretary cards equal the grand total." Those are different
  // questions: an Admin can legitimately process a payment too, and
  // since this page only displays Secretary-role cards, that amount
  // correctly won't appear in any card here — that's not a discrepancy,
  // it's an expected gap, shown honestly as its own line rather than
  // treated as a red flag. A TRUE problem is a payment whose processedBy
  // doesn't match any real account at all.
  const orphanedPayments = payments.filter((p) => !allKnownUsernames.has(p.processedBy));
  const secretaryUsernames = new Set(users.map((u) => u.username));
  const otherKnownStaffPayments = payments.filter((p) => allKnownUsernames.has(p.processedBy) && !secretaryUsernames.has(p.processedBy));
  const sumOfIndividualTotals = ledgerEngine.round2(secretaries.reduce((s, r) => s + r.allTimeTotal, 0));
  const otherKnownStaffTotal = sumAmount(otherKnownStaffPayments);
  const trueOverallTotal = sumAmount(payments);
  const reconciled = orphanedPayments.length === 0;

  return {
    secretaries,
    reconciliation: {
      reconciled,
      sumOfIndividualTotals,
      otherKnownStaffTotal,
      otherKnownStaffCount: otherKnownStaffPayments.length,
      trueOverallTotal,
      difference: ledgerEngine.round2(trueOverallTotal - sumOfIndividualTotals - otherKnownStaffTotal),
      orphanedPaymentCount: orphanedPayments.length,
      orphanedPayments: orphanedPayments.slice(0, 20).map((p) => ({
        paymentId: p.paymentId, processedBy: p.processedBy, amount: p.amount,
        transactionReference: p.transactionReference, paymentDate: p.paymentDate
      }))
    }
  };
}

async function getReportsCenterExtras(school) {
  const db = await initDatabase();
  const scoped = school && school !== 'Both';
  const selector = scoped ? { school } : {};
  const [studentsRaw, expectationsRaw, paymentsRaw, allocationsRaw, adjustmentsRaw, adjAllocRaw] = await Promise.all([
    db.students.find({ selector }).exec(),
    db.fee_expectations.find({ selector }).exec(),
    db.payments.find({ selector }).exec(),
    db.allocations.find().exec(),
    db.admin_adjustments.find({ selector }).exec(),
    db.adjustment_allocations.find().exec()
  ]);
  const students = studentsRaw.map((s) => s.toJSON());
  const expectations = expectationsRaw.map((e) => e.toJSON());
  const payments = paymentsRaw.map((p) => p.toJSON());
  // As elsewhere: `payments` (raw) feeds computeFinancialHealth below,
  // which already correctly accounts for corrections. `correctedPayments`
  // is only for the pure collection totals (today/month/year/EFT/POS/
  // daily/monthly breakdowns, and the "collected" figure in behaviour
  // buckets) — display sums that don't separately re-add adjustments.
  const correctedPayments = await withCorrectedAmounts(db, payments);
  const correctedByStudentId = {};
  correctedPayments.forEach((p) => { (correctedByStudentId[p.studentId] = correctedByStudentId[p.studentId] || []).push(p); });
  const allocations = allocationsRaw.map((a) => a.toJSON());
  const adjustments = adjustmentsRaw.map((a) => a.toJSON());
  const adjustmentAllocations = adjAllocRaw.map((a) => a.toJSON());
  const studentById = Object.fromEntries(students.map((s) => [s.studentId, s]));
  const now = new Date();
  const todayStr = localDateStr(now);
  const monthKey = now.toISOString().slice(0, 7);
  const yearKey = now.toISOString().slice(0, 4);
  const sumWhere = (pred) => correctedPayments.filter(pred).reduce((s, p) => s + p.amount, 0);
  const todayTotal = sumWhere((p) => (p.paymentDate || '').slice(0, 10) === todayStr);
  const monthTotal = sumWhere((p) => (p.paymentDate || '').slice(0, 7) === monthKey);
  const yearTotal = sumWhere((p) => (p.paymentDate || '').slice(0, 4) === yearKey);
  const eftPayments = correctedPayments.filter((p) => p.paymentMethod === 'EFT');
  const posPayments = correctedPayments.filter((p) => p.paymentMethod === 'POS');
  const eftTotal = eftPayments.reduce((s, p) => s + p.amount, 0);
  const posTotal = posPayments.reduce((s, p) => s + p.amount, 0);
  const dailyBreakdown = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i);
    const key = localDateStr(d);
    dailyBreakdown.push({ date: key, total: sumWhere((p) => (p.paymentDate || '').slice(0, 10) === key) });
  }
  const monthlyBreakdown = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = localMonthKey(d);
    monthlyBreakdown.push({ month: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }), total: sumWhere((p) => (p.paymentDate || '').slice(0, 7) === key) });
  }
  // The full calendar year, January through December, every month
  // present — not just the months reached so far. A month that hasn't
  // happened yet gets marked as such explicitly (isFuture: true, no
  // total computed) rather than silently showing a zero that would
  // read as "nothing was collected in December," when the real answer
  // is "December hasn't happened yet." Months already reached always
  // show their real total, including zero if that's genuinely what
  // happened.
  const yearlyMonthlyBreakdown = [];
  for (let month = 0; month <= 11; month++) {
    const d = new Date(now.getFullYear(), month, 1);
    const key = localMonthKey(d);
    const isFuture = month > now.getMonth();
    yearlyMonthlyBreakdown.push({
      month: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      total: isFuture ? null : sumWhere((p) => (p.paymentDate || '').slice(0, 7) === key),
      isFuture
    });
  }
  const agingBuckets = { '0-30': { count: 0, amount: 0 }, '31-60': { count: 0, amount: 0 }, '61-90': { count: 0, amount: 0 }, '90+': { count: 0, amount: 0 } };
  const debtorTotalsByStudent = {};
  expectations.forEach((e) => {
    const remaining = ledgerEngine.computeExpectationRemaining(e, allocations, adjustmentAllocations);
    if (remaining <= 0) return;
    const ageDays = ledgerEngine.daysBetween(new Date(e.dueDate), now);
    const bucket = ageDays <= 30 ? '0-30' : ageDays <= 60 ? '31-60' : ageDays <= 90 ? '61-90' : '90+';
    agingBuckets[bucket].count += 1;
    agingBuckets[bucket].amount = ledgerEngine.round2(agingBuckets[bucket].amount + remaining);
    if (!debtorTotalsByStudent[e.studentId]) debtorTotalsByStudent[e.studentId] = { studentId: e.studentId, owed: 0, oldestAgeDays: 0 };
    debtorTotalsByStudent[e.studentId].owed = ledgerEngine.round2(debtorTotalsByStudent[e.studentId].owed + remaining);
    debtorTotalsByStudent[e.studentId].oldestAgeDays = Math.max(debtorTotalsByStudent[e.studentId].oldestAgeDays, ageDays);
  });
  const topDebtors = Object.values(debtorTotalsByStudent)
    .map((d) => {
      const s = studentById[d.studentId];
      return { ...d, name: s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown', studentNumber: s?.studentNumber || '' };
    })
    .sort((a, b) => b.owed - a.owed)
    .slice(0, 20);
  const behaviourCategories = {
    'Chronic Debtors': { count: 0, collected: 0, outstanding: 0 },
    Debtors: { count: 0, collected: 0, outstanding: 0 },
    OK: { count: 0, collected: 0, outstanding: 0 },
    Good: { count: 0, collected: 0, outstanding: 0 },
    Overpaid: { count: 0, collected: 0, outstanding: 0 }
  };
  students.forEach((s) => {
    const exps = expectations.filter((e) => e.studentId === s.studentId);
    const pays = payments.filter((p) => p.studentId === s.studentId);
    const expIds = new Set(exps.map((e) => e.expectationId));
    const adjAllocs = adjustmentAllocations.filter((a) => expIds.has(a.expectationId));
    const studentAdjustments = adjustments.filter((a) => a.studentId === s.studentId);
    const health = ledgerEngine.computeFinancialHealth({ expectations: exps, payments: pays, allocations, adjustmentAllocations: adjAllocs, adjustments: studentAdjustments });
    const bucket = behaviourCategories[health.status];
    if (!bucket) return;
    bucket.count += 1;
    bucket.collected = ledgerEngine.round2(bucket.collected + (correctedByStudentId[s.studentId] || []).reduce((sum, p) => sum + p.amount, 0));
    bucket.outstanding = ledgerEngine.round2(bucket.outstanding + Math.max(0, health.balance));
  });
  // Payment corrections are shown in their own dedicated section below
  // (with the actual correction amount and direction, which is clearer
  // than a generic adjustment line) — excluding them here so the same
  // real-world event doesn't appear twice across two different report
  // sections.
  const adjustmentRecords = adjustments
    .filter((a) => a.type !== 'CORRECTION')
    .map((a) => {
      const s = studentById[a.studentId];
      return {
        adjustmentId: a.adjustmentId,
        date: a.approvalTimestamp,
        studentName: s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown',
        type: a.type,
        amount: a.amount,
        reasonCode: a.reasonCode,
        explanation: a.explanation,
        approvedBy: a.approvedByUserId
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));
  // Same exclusion as above, applied consistently — the summary totals
  // and byType breakdown should describe exactly what the records table
  // shows, not silently include corrections back in behind the scenes.
  const nonCorrectionAdjustments = adjustments.filter((a) => a.type !== 'CORRECTION');
  const adjustmentsByType = {};
  nonCorrectionAdjustments.forEach((a) => {
    if (!adjustmentsByType[a.type]) adjustmentsByType[a.type] = { count: 0, amount: 0 };
    adjustmentsByType[a.type].count += 1;
    adjustmentsByType[a.type].amount = ledgerEngine.round2(adjustmentsByType[a.type].amount + a.amount);
  });
  const studentIdsForCorrections = studentsRaw.map((s) => s.toJSON().studentId);
  const correctionsRaw = studentIdsForCorrections.length
    ? await db.payment_corrections.find({ selector: { studentId: { $in: studentIdsForCorrections } } }).exec()
    : [];
  const correctionRecords = correctionsRaw
    .map((c) => c.toJSON())
    .map((c) => {
      const s = studentById[c.studentId];
      return {
        correctionId: c.correctionId,
        date: c.createdAt,
        studentName: s ? `${s.firstName} ${s.lastName}`.trim() : 'Unknown',
        originalPaymentId: c.originalPaymentId,
        correctionAmount: c.correctionAmount,
        reason: c.reason,
        correctedBy: c.correctedByUserId
      };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  return {
    collections: { todayTotal, monthTotal, yearTotal, eftTotal, posTotal, eftCount: eftPayments.length, posCount: posPayments.length, dailyBreakdown, monthlyBreakdown, yearlyMonthlyBreakdown },
    aging: { buckets: agingBuckets, topDebtors },
    behaviour: { categories: behaviourCategories },
    adjustments: { total: nonCorrectionAdjustments.length, totalAmount: nonCorrectionAdjustments.reduce((s, a) => s + a.amount, 0), byType: adjustmentsByType, records: adjustmentRecords },
    corrections: { total: correctionRecords.length, records: correctionRecords }
  };
}

// ---------- NEW: Keila (Elite) specific functions ----------
async function createCourse(data) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = { courseId: crypto.randomUUID(), isActive: true, updatedAt: now, updatedBy: getStationId(), ...data };
  await db.courses.insert(doc);
  return doc;
}

async function listCourses(school) {
  const db = await initDatabase();
  const selector = school ? { school } : {};
  return (await db.courses.find({ selector }).exec()).map(d => d.toJSON());
}

async function createSubject(data) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = { subjectId: crypto.randomUUID(), isActive: true, updatedAt: now, updatedBy: getStationId(), ...data };
  await db.subjects.insert(doc);
  return doc;
}

async function listSubjects(courseId) {
  const db = await initDatabase();
  const selector = courseId ? { courseId } : {};
  return (await db.subjects.find({ selector }).exec()).map(d => d.toJSON());
}

async function enrollStudentInCourse({ studentId, courseId, subjects, academicYear, intake }) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = {
    enrollmentId: crypto.randomUUID(),
    studentId,
    courseId,
    subjects: subjects || [],
    enrollmentDate: now,
    status: 'Enrolled',
    academicYear,
    intake,
    updatedAt: now,
    updatedBy: getStationId()
  };
  await db.student_courses.insert(doc);
  const student = await db.students.findOne({ selector: { studentId } }).exec();
  if (student) {
    await student.incrementalPatch({ courseId, updatedAt: now, updatedBy: getStationId() });
  }
  return doc;
}

async function createSponsor(data) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = { sponsorId: crypto.randomUUID(), isActive: true, updatedAt: now, updatedBy: getStationId(), ...data };
  await db.sponsors.insert(doc);
  return doc;
}

async function listSponsors(school) {
  const db = await initDatabase();
  const selector = school ? { school } : {};
  return (await db.sponsors.find({ selector }).exec()).map(d => d.toJSON());
}

async function createInstallmentPlanKeila({ studentId, name, totalAmount, installments }) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = {
    planId: crypto.randomUUID(),
    studentId,
    name,
    totalAmount,
    installments: installments.map(i => ({ ...i, paid: false })),
    status: 'Active',
    createdAt: now,
    createdBy: getStationId(),
    updatedAt: now,
    updatedBy: getStationId()
  };
  await db.installment_plans.insert(doc);
  return doc;
}

/**
 * Turns ongoing fee ties (fee_assignments — "John is tied to Tuition")
 * into this month's actual billed charges, for every actively-assigned
 * student at once. This is what makes the tie useful: the secretary sets
 * it up once via bulkAssignFee, and every month after that this is the
 * only thing that needs running — no re-selecting students, no re-typing
 * amounts.
 *
 * Safe to run more than once for the same month: each generated
 * expectation is stamped with sourceAssignmentId + billingPeriod, and any
 * assignment that already has one for this period is skipped rather than
 * billed again.
 *
 * Batches its queries (one fetch for all assignments, one for all
 * existing expectations, one bulk insert) rather than querying per
 * student — built for the 500-1000 student scale, not tested only at a
 * handful.
 */
async function listTerms(school, yearId) {
  const db = await initDatabase();
  const selector = { school };
  if (yearId) selector.yearId = yearId;
  const raw = await db.terms.find({ selector }).exec();
  return raw.map((t) => t.toJSON()).sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
}

async function createTerm({ school, yearId, label, startDate, endDate }) {
  const db = await initDatabase();
  if (!startDate || !endDate) throw new Error('A term needs both a start and end date.');
  const now = new Date().toISOString();
  const doc = { termId: crypto.randomUUID(), school, yearId, label, startDate, endDate, createdAt: now };
  await db.terms.insert(doc);
  return doc;
}

/**
 * The termly equivalent of generateMonthlyInvoices — bills every
 * student with an active termly fee assignment, once per real Term
 * (not a calendar month), skipping anyone already billed for that
 * specific term so re-running this is always safe. Uses the term's own
 * ID as the billing period, which can never collide with a monthly
 * "YYYY-MM" period, so termly and monthly billing stay cleanly separate
 * even though they share the same fee_expectations collection.
 */
async function generateTermlyInvoices({ school, termId, dueDate }) {
  const db = await initDatabase();
  const termDoc = await db.terms.findOne({ selector: { termId } }).exec();
  if (!termDoc) throw new Error('Term not found.');
  const term = termDoc.toJSON();
  const due = dueDate || term.startDate;

  const [assignmentsRaw, templatesRaw, studentsRaw, existingRaw] = await Promise.all([
    db.fee_assignments.find({ selector: { isActive: true, frequency: 'termly' } }).exec(),
    db.fee_catalog_templates.find().exec(),
    db.students.find(school && school !== 'Both' ? { selector: { school } } : {}).exec(),
    db.fee_expectations.find({ selector: { billingPeriod: termId } }).exec()
  ]);

  const templateById = Object.fromEntries(templatesRaw.map((t) => [t.templateId, t.toJSON()]));
  const studentById = Object.fromEntries(studentsRaw.map((s) => [s.studentId, s.toJSON()]));
  const alreadyInvoicedAssignmentIds = new Set(existingRaw.map((e) => e.toJSON().sourceAssignmentId).filter(Boolean));

  const now = new Date().toISOString();
  const toCreate = [];

  for (const doc of assignmentsRaw) {
    const assignment = doc.toJSON();
    if (alreadyInvoicedAssignmentIds.has(assignment.assignmentId)) continue;
    const student = studentById[assignment.studentId];
    if (!student) continue;
    const template = templateById[assignment.feeTemplateId];

    toCreate.push({
      expectationId: crypto.randomUUID(),
      studentId: assignment.studentId,
      templateId: assignment.feeTemplateId,
      school: student.school,
      category: template?.category || 'Tuition',
      description: `${template?.itemName || 'Fee'} \u2014 ${term.label}`,
      originalAmount: assignment.amount,
      dueDate: due,
      priorityTier: template?.priorityTier || 1,
      frequency: 'termly',
      createdAt: now,
      createdBy: getStationId(),
      sourceAssignmentId: assignment.assignmentId,
      billingPeriod: termId
    });
  }

  if (toCreate.length > 0) {
    await db.fee_expectations.bulkInsert(toCreate);
    for (const expectation of toCreate) {
      await sweepSurplusOntoNewExpectation(db, expectation.studentId, expectation);
    }
  }
  return { created: toCreate.length, skipped: assignmentsRaw.length - toCreate.length };
}

async function generateMonthlyInvoices({ school, billingPeriod, dueDate }) {
  const db = await initDatabase();
  const period = billingPeriod || new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const due = dueDate || `${period}-01`;

  const [assignmentsRaw, templatesRaw, studentsRaw, existingRaw] = await Promise.all([
    db.fee_assignments.find({ selector: { isActive: true, frequency: 'monthly' } }).exec(),
    db.fee_catalog_templates.find().exec(),
    db.students.find(school && school !== 'Both' ? { selector: { school } } : {}).exec(),
    db.fee_expectations.find({ selector: { billingPeriod: period } }).exec()
  ]);

  const templateById = Object.fromEntries(templatesRaw.map((t) => [t.templateId, t.toJSON()]));
  const studentById = Object.fromEntries(studentsRaw.map((s) => [s.studentId, s.toJSON()]));
  const alreadyInvoicedAssignmentIds = new Set(existingRaw.map((e) => e.toJSON().sourceAssignmentId).filter(Boolean));

  const now = new Date().toISOString();
  const toCreate = [];

  for (const doc of assignmentsRaw) {
    const assignment = doc.toJSON();
    if (alreadyInvoicedAssignmentIds.has(assignment.assignmentId)) continue; // already billed this period
    const student = studentById[assignment.studentId];
    if (!student) continue; // student not in the requested school (or was removed) — not an error, just not applicable here
    const template = templateById[assignment.feeTemplateId];

    toCreate.push({
      expectationId: crypto.randomUUID(),
      studentId: assignment.studentId,
      templateId: assignment.feeTemplateId,
      school: student.school,
      category: template?.category || 'Tuition',
      description: template?.itemName || 'Tuition',
      originalAmount: assignment.amount,
      dueDate: due,
      priorityTier: template?.priorityTier || 1,
      frequency: 'monthly',
      createdAt: now,
      createdBy: getStationId(),
      sourceAssignmentId: assignment.assignmentId,
      billingPeriod: period
    });
  }

  if (toCreate.length > 0) {
    await db.fee_expectations.bulkInsert(toCreate);
    // Apply any existing prepayment surplus to each newly created
    // invoice — a parent who paid ahead shouldn't see a fresh "unpaid"
    // balance for money the school is already holding on their behalf.
    for (const expectation of toCreate) {
      await sweepSurplusOntoNewExpectation(db, expectation.studentId, expectation);
    }
  }

  return {
    billingPeriod: period,
    created: toCreate.length,
    skippedAlreadyInvoiced: alreadyInvoicedAssignmentIds.size,
    totalActiveAssignments: assignmentsRaw.length,
    students: toCreate.map((e) => {
      const s = studentById[e.studentId];
      return { studentId: e.studentId, name: s ? `${s.firstName} ${s.lastName}` : 'Unknown', amount: e.originalAmount, description: e.description };
    })
  };
}

/** Given a fee template and a student's grade level, returns the amount
 * that actually applies — checks gradePricing ranges first (if any are
 * defined), falls back to standardCharge for any grade not covered by a
 * range, and falls back to standardCharge entirely when the template has
 * no grade-specific pricing at all. gradeLevel can be null/undefined
 * (e.g. a student with no class assigned yet) — that also just falls
 * back to standardCharge rather than failing. */
function resolveFeeAmount(template, gradeLevel) {
  if (gradeLevel === null || gradeLevel === undefined || !Array.isArray(template.gradePricing) || template.gradePricing.length === 0) {
    return template.standardCharge;
  }
  const tier = template.gradePricing.find((t) => gradeLevel >= t.minGrade && gradeLevel <= t.maxGrade);
  return tier ? tier.amount : template.standardCharge;
}

async function bulkAssignFee({ studentIds, feeTemplateId, frequency, startDate }) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const stationId = getStationId();

  const templateDoc = await db.fee_catalog_templates.findOne({ selector: { templateId: feeTemplateId } }).exec();
  if (!templateDoc) throw new Error('Fee template not found.');
  const template = templateDoc.toJSON();

  const studentsRaw = await db.students.find({ selector: { studentId: { $in: studentIds } } }).exec();
  const studentById = Object.fromEntries(studentsRaw.map((s) => [s.studentId, s.toJSON()]));
  const classIds = [...new Set(studentsRaw.map((s) => s.toJSON().classId).filter(Boolean))];
  const classesRaw = classIds.length ? await db.classes.find({ selector: { classId: { $in: classIds } } }).exec() : [];
  const classById = Object.fromEntries(classesRaw.map((c) => [c.classId, c.toJSON()]));

  const assignments = studentIds.map((studentId) => {
    const student = studentById[studentId];
    const gradeLevel = student ? classById[student.classId]?.gradeLevel : undefined;
    return {
      assignmentId: crypto.randomUUID(),
      studentId,
      feeTemplateId,
      amount: resolveFeeAmount(template, gradeLevel),
      frequency,
      startDate,
      isActive: true,
      updatedAt: now,
      updatedBy: stationId
    };
  });
  await db.fee_assignments.bulkInsert(assignments);
  return assignments;
}

async function bulkRemoveFee({ assignmentIds }) {
  const db = await initDatabase();
  for (const id of assignmentIds) {
    const doc = await db.fee_assignments.findOne({ selector: { assignmentId: id } }).exec();
    if (doc) await doc.remove();
  }
  return { removed: assignmentIds.length };
}

async function listFeeAssignments(studentId) {
  const db = await initDatabase();
  const selector = studentId ? { studentId } : {};
  return (await db.fee_assignments.find({ selector }).exec()).map(d => d.toJSON());
}

async function createFeeCategory(data) {
  const db = await initDatabase();
  const now = new Date().toISOString();
  const doc = { categoryId: crypto.randomUUID(), isActive: true, updatedAt: now, updatedBy: getStationId(), ...data };
  await db.fee_categories.insert(doc);
  return doc;
}

async function listFeeCategories(school) {
  const db = await initDatabase();
  const selector = school ? { school } : {};
  return (await db.fee_categories.find({ selector }).exec()).map(d => d.toJSON());
}

// ---------- Module exports ----------
module.exports = {
  DB_NAME,
  wipeLocalDatabaseFiles,
  initDatabase,
  closeDatabase,
  verifyLogin,
  hashPassword,
  getStationId,
  getDatabaseStats,
  upsertMutableRecord,
  // Ledger
  createGuardian,
  updateStudent,
  bulkUpdateStudents,
  requestStudentDeletion,
  listPendingDeletionRequests,
  decideStudentDeletion,
  getSecretaryAuditReport,
  getSecretaryTransactionSummary,
  saveStudentDocumentsPdf,
  savePaymentReceipt,
  updatePaymentReceiptPath,
  getStudentStatementData,
  getStudentStatementDataForLetter,
  getAllPaymentsDetailed,
  getStudentsByFilters,
  getClassOrGradeStatement,
  getFeeCategoryReport,
  createClass,
  listClasses,
  promoteStudents,
  createStudent,
  createFeeExpectation,
  listAcademicYears,
  createAcademicYear,
  setCurrentAcademicYear,
  getCurrentAcademicYear,
  createChargeFromTemplate,
  createInstallmentPlan,
  bulkCreateInstallmentPlans,
  checkDuplicateCharges,
  bulkCreateFeeExpectations,
  listFeeCatalogTemplates,
  listAllFeeCatalogTemplates,
  createFeeTemplate,
  updateFeeCatalogTemplate,
  getStudentLedger,
  getStudentBillingSummary,
  capturePayment,
  applyAdminAdjustment,
  correctPaymentAmount,
  getCorrectionsForPayment,
  ledgerEngine,
  // User management
  listUsers,
  createUser,
  updateUser,
  resetUserPassword,
  getSecretaryDashboardData,
  listStudents,
  listGuardians,
  getTopListsData,
  getFeeCategoryLeaderboards,
  getArrearsLetterData,
  getFinancialReportData,
  getReportsCenterExtras,
  getSecretaryPerformanceData,
  getSchoolCategoryBreakdown,
  getFeeTemplateBreakdown,
  getMonthlyManagementReport,
  getActiveAlerts,
  getFinancialForecast,
  getOwnProfile,
  updateOwnProfile,
  changeOwnPassword,
  // Keila (Elite) specific
  createCourse,
  listCourses,
  createSubject,
  listSubjects,
  enrollStudentInCourse,
  createSponsor,
  listSponsors,
  createInstallmentPlanKeila,
  bulkAssignFee,
  resolveFeeAmount,
  generateMonthlyInvoices,
  listTerms,
  createTerm,
  generateTermlyInvoices,
  bulkRemoveFee,
  listFeeAssignments,
  createFeeCategory,
  listFeeCategories
};