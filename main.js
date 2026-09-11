// main.js
// Electron main process. Orchestrates: splash window -> real DB init -> main window.

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  initDatabase, closeDatabase, verifyLogin, listUsers, createUser, updateUser, resetUserPassword,
  getSecretaryDashboardData, listStudents, listGuardians, createStudent, createGuardian,
  getTopListsData, getArrearsLetterData, getFinancialReportData, getReportsCenterExtras,
  getStudentBillingSummary, capturePayment, createInstallmentPlan, createFeeExpectation,
  listFeeCatalogTemplates, DB_NAME, wipeLocalDatabaseFiles,
  getOwnProfile, updateOwnProfile, changeOwnPassword
} = require('./db/db');
// The Keila (Elite) IPC handlers below call db.listCourses(), db.createCourse(),
// etc. — but only individual functions were destructured above, never a
// whole-module reference. Every one of those handlers was throwing
// "db is not defined" before this line existed.
const db = require('./db/db');

// ---------------------------------------------------------------------------
// Mitigation for a known, RxDB-acknowledged bug: the LokiJS storage adapter
// this app uses has documented "wrong query results" issues under
// concurrent queries — severe enough that RxDB removed LokiJS storage
// entirely in v16, since the bugs live in LokiJS itself (unmaintained
// upstream) and can't be fixed at the RxDB layer. This is NOT a real fix —
// it retries the whole operation on the specific "SNH" error this bug
// produces, which empirically works because the bad cache state doesn't
// persist across a fresh attempt. If this keeps recurring often, the real
// fix is migrating off LokiJS to a maintained RxStorage (e.g. SQLite).
async function withRxdbRetry(fn, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isSnh = err && (err.code === 'SNH' || /SNH/.test(String(err.message || '')));
      if (!isSnh || attempt === maxAttempts) throw err;
      console.warn(`[db] Hit the known RxDB/LokiJS query-cache bug (SNH) — retrying (attempt ${attempt}/${maxAttempts})...`);
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
  throw lastErr;
}

const sync = require('./db/sync-firebase');
const backup = require('./db/backup');
const usbBackup = require('./db/usb-backup');
const { getRememberedUsername, setRememberedUsername } = require('./db/preferences');

// ---------------------------------------------------------------------------
// Catches crashes attemptInit()'s own try/catch never sees — e.g. a raw
// ENOENT from a LokiJS chunk file, which surfaces as an uncaught exception
// in the main process rather than a rejected addCollections() promise (that
// specific case is what a corrupted/partial local dev database — e.g. from
// an earlier interrupted wipe — looks like). Same recovery as the DB6 path:
// wipe the local dev database and relaunch, rather than showing Electron's
// default crash dialog for something we can actually recover from.
// A real production build with real data would need an actual repair path
// here instead of a wipe — this is dev-mode-only, same as attemptInit()'s.
// ---------------------------------------------------------------------------
process.on('uncaughtException', async (err) => {
  console.error('Uncaught exception in main process:', err);

  if (!app.isReady()) {
    // Can't safely show a dialog or relaunch before Electron itself is
    // ready — this early, just exit cleanly rather than risk a second,
    // more confusing crash from calling dialog/app APIs too soon.
    app.exit(1);
    return;
  }

  const mentionsLocalDb = err && err.message && DB_NAME && err.message.includes(DB_NAME);
  const isFileSystemError = err && ['ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(err.code);

  if (mentionsLocalDb && isFileSystemError && !app.isPackaged) {
    try {
      dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Repairing local database',
        message: 'The local database was left in an inconsistent state (likely from an interrupted previous run) and needs to be reset. The app will restart automatically.'
      });
      await wipeLocalDatabaseFiles();
    } catch (wipeErr) {
      console.error('Could not fully wipe the local database during crash recovery:', wipeErr);
      dialog.showErrorBox(
        'Fee Management System — Could Not Recover',
        `The local database is corrupted and could not be automatically reset:\n\n${wipeErr.message}\n\n` +
        `Please close this app completely (check Task Manager for any other copy still running), then manually delete this folder:\n\n${path.dirname(DB_NAME)}\n\nand reopen the app.`
      );
      app.exit(1);
      return;
    }
    app.relaunch();
    app.exit(0);
    return;
  }

  // Anything else genuinely unexpected: surface it clearly rather than
  // silently swallowing it, but don't pretend a wipe would help.
  dialog.showErrorBox(
    'Fee Management System — Unexpected Error',
    `Something went wrong that the app didn't expect:\n\n${err.message || err}\n\nThe app will now close.`
  );
  app.exit(1);
});

// How long the splash screen stays up AT MINIMUM, regardless of how fast the
// database actually finishes initializing. Real DB init usually takes well
// under a second, so this is purely a deliberate minimum-display floor.
const MIN_SPLASH_DURATION_MS = 3 * 1000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let splashWindow = null;
let mainWindow = null;

function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 820,
    height: 580,
    frame: false,
    resizable: false,
    movable: true,
    center: true,
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    // The current splash design fills the whole window with its own
    // gradient and only rounds the inner card, not the window edge itself
    // — so, unlike the earlier version, this doesn't need window-level
    // transparency to look right. Turned off since it also removes a
    // flagged compatibility risk on older Windows builds without DWM
    // composition enabled (transparent windows can render as a plain
    // square with visible artifacts there).
    backgroundColor: '#06b6d4', // matches the splash gradient's start color — avoids a black flash before the HTML paints
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'splash', 'splash-preload.js')
    }
  });

  splashWindow.loadFile(path.join(__dirname, 'splash', 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow.show());
}

function sendSplashStatus(text) {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.webContents.send('splash:status', text);
  }
}

/**
 * Runs one sync round and surfaces it appropriately:
 * - Always logs + forwards the status text to the Sync panel (quiet).
 * - Only pops a native dialog + beep when a conflict was actually
 *   auto-resolved — something a human should know happened. Routine
 *   failures (almost always just "no internet right now") stay silent;
 *   popping a dialog every 5 minutes for that would make the app
 *   unusable offline, which defeats the point of it.
 */
// ---------- foreground/sync coordination ----------
//
// Background sync and a secretary's active work (capturing a payment,
// running bulk operations) both touch many of the same LokiJS collections
// in quick succession — exactly the pattern that's triggered the RxDB/
// LokiJS "SNH" bug in real usage. Rather than only reacting to that after
// it happens (the retry wrapper below still does, as a second layer),
// this prevents the two from running at the same time in the first place:
// sync checks this counter and simply skips its turn — quietly, safely —
// if real work is in progress, and tries again on the next interval a few
// minutes later. Nothing is lost by skipping a cycle; sync is background
// maintenance, not the secretary's actual job, so it's sync that waits,
// never the other way around.
let activeForegroundOps = 0;
function beginForegroundOp() { activeForegroundOps++; }
function endForegroundOp() { activeForegroundOps = Math.max(0, activeForegroundOps - 1); }
async function withForegroundLock(fn) {
  beginForegroundOp();
  try {
    return await fn();
  } finally {
    endForegroundOp();
  }
}

async function runSync() {
  if (activeForegroundOps > 0) {
    console.log(`[sync] Skipped this cycle — ${activeForegroundOps} foreground operation(s) in progress (payment, invoicing, or a bulk action). Will retry next interval.`);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:status', 'Sync deferred — busy with an active operation, will retry shortly.');
    }
    return { skipped: true, reason: 'foreground-busy' };
  }

  const result = await sync.syncNow((status) => {
    console.log('[sync]', status);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:status', status);
    }
  });

  // Separate from the granular status text above — fires exactly once
  // per sync cycle with the actual counts, so the renderer can decide
  // whether to refresh what's on screen rather than trying to parse
  // status strings to figure that out.
  if (mainWindow && !mainWindow.isDestroyed() && result && !result.skipped && !result.error) {
    mainWindow.webContents.send('sync:completed', { pushed: result.pushed || 0, pulled: result.pulled || 0 });
  }

  if (result && result.conflicts > 0 && mainWindow && !mainWindow.isDestroyed()) {
    shell.beep();
    dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: 'Sync conflict resolved',
      message: `${result.conflicts} record(s) were edited on two stations before syncing.`,
      detail: 'The most recent edit was kept automatically. Nothing was lost — the older version was saved to the conflict log for review.',
      buttons: ['OK']
    });
  }

  return result;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'Fee Management System',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    backgroundColor: '#ffffff',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.maximize(); // opens filling the screen ("full page"), not the previous fixed 1200x800
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// A second copy of this app writing to the same LokiJS files at the same
// time — someone double-clicking the shortcut twice, or opening it from
// two places without realizing one's already running — is a genuine
// corruption risk: file-based storage like this isn't built for two
// processes touching the same files concurrently. This claims an
// exclusive lock; if another instance already holds it, this one quits
// immediately instead of racing the first for the same files.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// If another instance is later opened while this one already holds the
// lock, bring this window to the front instead of doing nothing —
// otherwise a second double-click just silently fails with no feedback.
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  // Dev-only: `npm run seed:test-data` launches with this flag to add
  // realistic test data through the real business logic (capturePayment,
  // the ledger engine, etc.), then exits — never runs during a normal
  // launch, so this can't accidentally seed fake data into a real
  // deployment.
  console.log('[main] process.argv:', process.argv); // always logged — if the seed flag isn't detected, this shows exactly why
  if (process.argv.includes('--seed-test-data')) {
    console.log('[seed] Flag detected — seeding now...');
    try {
      await initDatabase(() => {});
      const { seedTestData } = require('./tools/seed-test-data');
      const results = await seedTestData(require('./db/db'));
      console.log('\n[seed] Added:');
      results.forEach((r) => console.log('  -', r));
      // LokiJS autosaves on an interval, not synchronously per write — the
      // records above are real in memory the instant seedTestData()
      // resolves, but calling app.exit() immediately after can kill the
      // process before that autosave actually flushes to the physical
      // .db file. Without this delay, the console prints success and the
      // writes are completely real in memory, but nothing lands on disk —
      // confirmed this is exactly what was happening.
      console.log('[seed] Waiting for the database to finish saving to disk...');
      await new Promise((resolve) => setTimeout(resolve, 3000));
      console.log('\n[seed] Done — start the app normally to see it.');
    } catch (err) {
      console.error('[seed] Failed:', err.message, err.stack);
    }
    app.exit(0);
    return;
  }

  // QR login needs camera access for live scanning. Electron denies media
  // permission requests by default unless explicitly handled — this app has
  // no other use for the camera or microphone, so only 'media' is granted.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createSplashWindow();

  try {
    // These status strings are what actually drives the splash spinner text —
    // it reflects real startup progress, not a fake delay. We also hold the
    // splash open for at least MIN_SPLASH_DURATION_MS, so if the DB finishes
    // early we keep showing status rather than closing abruptly.
    await Promise.all([
      initDatabase((status) => {
        sendSplashStatus(status);
      }),
      delay(MIN_SPLASH_DURATION_MS)
    ]);
    sendSplashStatus('Ready');
  } catch (err) {
    console.error('Database initialization failed:', err);

    if (err && err.restartRequired) {
      // The local dev database was just wiped after a schema change — the
      // in-memory RxDB state for THIS process is now unrecoverable no
      // matter what we do next (confirmed by testing: even a successful
      // wipe still fails every subsequent attempt in the same process).
      // A fresh process reading the now-clean files works correctly, so
      // relaunch instead of pretending the app is still usable.
      sendSplashStatus('Restarting to finish applying the update...');
      await delay(1200);
      app.relaunch();
      app.exit(0);
      return;
    }

    // Any other failure: don't silently show a login screen against a
    // database that never actually initialized — that just moves the
    // failure somewhere more confusing (the first login attempt) instead
    // of fixing it here.
    //
    // Before giving up: if real backups exist, this is exactly the
    // situation they exist for — offer to restore the most recent one
    // right here, rather than making someone dig through System
    // Diagnostics on an app that won't even open. Restoring still quits
    // the app afterward either way (touching the live files while
    // nothing has them open is the only safe order), same as a manual
    // restore from Diagnostics.
    sendSplashStatus('Startup failed.');
    await delay(1000);

    let availableBackups = [];
    try {
      availableBackups = backup.listBackups(db.DB_NAME);
    } catch (backupErr) {
      console.error('[startup-recovery] Could not even list backups:', backupErr.message);
    }

    if (availableBackups.length > 0) {
      const mostRecent = availableBackups[0];
      const whenText = mostRecent.createdAt ? new Date(mostRecent.createdAt).toLocaleString() : mostRecent.name;
      const choice = dialog.showMessageBoxSync({
        type: 'warning',
        title: 'Fee Management System — Startup Failed',
        message: 'The local database could not be opened. It may be damaged.',
        detail:
          `Technical detail: ${err.message || err}\n\n` +
          `A backup from ${whenText} is available. Restoring it will replace the current (damaged) files with that backup, ` +
          `then restart the app. Anything entered after that backup was taken will be lost — but the app will work again.\n\n` +
          `If you'd rather investigate first, choose "Close Without Restoring" and get technical help.`,
        buttons: ['Restore This Backup and Restart', 'Close Without Restoring'],
        defaultId: 0,
        cancelId: 1
      });

      if (choice === 0) {
        try {
          await backup.restoreFromBackup(db.DB_NAME, mostRecent.name);
          dialog.showMessageBoxSync({
            type: 'info',
            title: 'Restored',
            message: 'The backup was restored. The app will now restart.'
          });
          app.relaunch();
          app.exit(0);
          return;
        } catch (restoreErr) {
          dialog.showErrorBox(
            'Restore Failed',
            `Could not restore the backup automatically:\n\n${restoreErr.message}\n\n` +
            `The DISASTER-RECOVERY-PLAN document covers doing this by hand as a next step. The app will now close.`
          );
          app.exit(1);
          return;
        }
      }
      // "Close Without Restoring" chosen — fall through to the plain error exit below.
    }

    dialog.showErrorBox(
      'Fee Management System — Startup Failed',
      `The local database could not be opened:\n\n${err.message || err}\n\nThe app will now close.`
    );
    app.exit(1);
    return;
  }

  createMainWindow();

  // Backup: once right now (captures whatever state existed BEFORE this
  // session's writes start — the most important single backup, since
  // it's the freshest safety net against anything this session does
  // wrong), then once every 24 hours for as long as the app stays open.
  // Never blocks startup — runs after the window is already up.
  backup.backupDatabase(db.DB_NAME, 'startup').catch((err) => console.error('[backup] Startup backup failed:', err.message));
  setInterval(() => {
    backup.backupDatabase(db.DB_NAME, 'daily').catch((err) => console.error('[backup] Daily backup failed:', err.message));
  }, 24 * 60 * 60 * 1000);

  // USB auto-backup: checks for a removable drive every 20 seconds, and
  // if one is plugged in that hasn't been backed up to yet this session,
  // copies a backup onto it automatically. A genuinely separate piece of
  // hardware from the local disk, unlike the local backups/ folder above.
  usbBackup.startUsbBackupWatcher(db.DB_NAME, (status) => {
    console.log('[usb-backup]', status);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('usb-backup:status', status);
    }
  });

  // Auto-sync: pushes/pulls via Firebase every 5 minutes in the background.
  // Uses runSync (not sync.startAutoSync directly) so conflict dialogs work
  // for automatic runs too, not just the manual "Sync now" button.
  setTimeout(runSync, 15 * 1000);
  setInterval(runSync, 5 * 60 * 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// ---------- IPC: authentication ----------
ipcMain.handle('auth:login', async (_event, { username, password }) => {
  try {
    return await verifyLogin(username, password);
  } catch (err) {
    console.error('Login error:', err);
    if (err && err.restartRequired) {
      dialog.showMessageBoxSync({
        type: 'info',
        title: 'Restarting',
        message: 'Local database was updated and needs to finish loading. The app will restart automatically.'
      });
      app.relaunch();
      app.exit(0);
      return { success: false, message: 'Restarting...' };
    }
    return { success: false, message: err.message || 'Login failed due to a system error.' };
  }
});

// "Remember Me" — username only, never the password. See db/preferences.js
// for why (shared stations, roaming Superadmin — skipping the password
// step entirely would be a real security regression for a financial app).
ipcMain.handle('auth:getRememberedUsername', async () => {
  return getRememberedUsername();
});

ipcMain.handle('auth:setRememberedUsername', async (_event, username) => {
  setRememberedUsername(username);
});

// ---------- IPC: user management ----------
// Permission checks live in db.js (main process), not here — the renderer
// passes its own claimed role, which is the same trust boundary as the
// rest of this app (contextIsolation + no nodeIntegration), not a hardened
// server-side session. Adequate for a 3-station internal school app.
ipcMain.handle('users:list', async (_event, { requestingRole }) => {
  try {
    return { success: true, users: await listUsers(requestingRole) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('users:create', async (_event, payload) => {
  try {
    const result = await createUser(payload);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('users:update', async (_event, payload) => {
  try {
    await updateUser(payload);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('users:resetPassword', async (_event, payload) => {
  try {
    const result = await resetUserPassword(payload);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('secretary:dashboardData', async (_event, { school }) => {
  try {
    const data = await withRxdbRetry(() => getSecretaryDashboardData(school));
    return { success: true, data };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('students:list', async (_event, { school }) => {
  try {
    return { success: true, students: await withRxdbRetry(() => listStudents(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('students:create', async (_event, payload) => {
  try {
    return { success: true, student: await withRxdbRetry(() => createStudent(payload)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('guardians:list', async () => {
  try {
    return { success: true, guardians: await listGuardians() };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('guardians:create', async (_event, payload) => {
  try {
    return { success: true, guardian: await withRxdbRetry(() => createGuardian(payload)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('financialComm:topLists', async (_event, { school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => getTopListsData(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('financialComm:feeCategoryLeaderboards', async (_event, { school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => db.getFeeCategoryLeaderboards(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('financialComm:arrearsLetter', async (_event, { studentId }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => getArrearsLetterData(studentId)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('reports:financialReport', async (_event, { school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => getFinancialReportData(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('reports:centerExtras', async (_event, { school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => getReportsCenterExtras(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('reports:secretaryPerformance', async (_event, { school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => db.getSecretaryPerformanceData(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('reports:schoolCategoryBreakdown', async (_event, { school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => db.getSchoolCategoryBreakdown(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('reports:feeTemplateBreakdown', async (_event, { school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => db.getFeeTemplateBreakdown(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('reports:monthlyManagementReport', async (_event, { school, monthKey }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => db.getMonthlyManagementReport(school, monthKey)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('reports:financialForecast', async (_event, { school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => db.getFinancialForecast(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});



// ---------- IPC: Keila (Elite) ----------

// These 5 were called by StudentHub.jsx and claimed to exist, but had no
// handler registered anywhere — listClasses specifically is called by the
// default first-shown tab (Student Registration), so this was the direct
// cause of the blank page: an uncaught "not a function" error on mount,
// with no error boundary to catch it.
ipcMain.handle('classes:list', async (_event, { school }) => {
  try {
    const classes = await withRxdbRetry(() => db.listClasses(school));
    return { success: true, classes };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('classes:create', async (_event, payload) => {
  try {
    const cls = await withRxdbRetry(() => db.createClass(payload));
    return { success: true, class: cls };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('academicYears:list', async (_event, { school }) => {
  try {
    return { success: true, years: await withRxdbRetry(() => db.listAcademicYears(school)) };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('academicYears:create', async (_event, payload) => {
  try {
    return { success: true, year: await withRxdbRetry(() => db.createAcademicYear(payload)) };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('academicYears:setCurrent', async (_event, { school, yearId }) => {
  try {
    await withRxdbRetry(() => db.setCurrentAcademicYear(school, yearId));
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('academicYears:getCurrent', async (_event, { school }) => {
  try {
    return { success: true, year: await withRxdbRetry(() => db.getCurrentAcademicYear(school)) };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('students:promote', async (_event, payload) => {
  try {
    const results = await withForegroundLock(() => withRxdbRetry(() => db.promoteStudents(payload)));
    return { success: true, results };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('terms:list', async (_event, { school, yearId }) => {
  try {
    return { success: true, terms: await withRxdbRetry(() => db.listTerms(school, yearId)) };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('terms:create', async (_event, payload) => {
  try {
    return { success: true, term: await withRxdbRetry(() => db.createTerm(payload)) };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('students:update', async (_event, { studentId, patch }) => {
  try {
    const student = await withRxdbRetry(() => db.updateStudent(studentId, patch));
    return { success: true, student };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('students:bulkUpdate', async (_event, { studentIds, patch }) => {
  try {
    const result = await withForegroundLock(() => withRxdbRetry(() => db.bulkUpdateStudents(studentIds, patch)));
    return { success: true, ...result };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('students:requestDeletion', async (_event, payload) => {
  try {
    const student = await withRxdbRetry(() => db.requestStudentDeletion(payload));
    return { success: true, student };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('students:listPendingDeletions', async (_event, { school }) => {
  try {
    const requests = await withRxdbRetry(() => db.listPendingDeletionRequests(school));
    return { success: true, requests };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('students:decideDeletion', async (_event, payload) => {
  try {
    const student = await withRxdbRetry(() => db.decideStudentDeletion(payload));
    return { success: true, student };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('reports:secretaryAudit', async (_event, payload) => {
  try {
    const entries = await withRxdbRetry(() => db.getSecretaryAuditReport(payload));
    return { success: true, entries };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('reports:secretaryTransactionSummary', async (_event, payload) => {
  try {
    const data = await withRxdbRetry(() => db.getSecretaryTransactionSummary(payload));
    return { success: true, data };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('reports:studentStatement', async (_event, { studentId }) => {
  try {
    const data = await withRxdbRetry(() => db.getStudentStatementData(studentId));
    return { success: true, data };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('reports:studentStatementForLetter', async (_event, { studentId }) => {
  try {
    const data = await withRxdbRetry(() => db.getStudentStatementDataForLetter(studentId));
    return { success: true, data };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('payments:allDetailed', async (_event, filters) => {
  try {
    const data = await withRxdbRetry(() => db.getAllPaymentsDetailed(filters));
    return { success: true, data };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('reports:studentsByFilters', async (_event, filters) => {
  try {
    const students = await withRxdbRetry(() => db.getStudentsByFilters(filters));
    return { success: true, students };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('reports:classOrGradeStatement', async (_event, payload) => {
  try {
    const data = await withRxdbRetry(() => db.getClassOrGradeStatement(payload));
    return { success: true, data };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('reports:feeCategoryReport', async (_event, payload) => {
  try {
    const data = await withRxdbRetry(() => db.getFeeCategoryReport(payload));
    return { success: true, data };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('students:saveDocumentsPdf', async (_event, { studentId, pdfBase64, kind }) => {
  try {
    const filePath = await db.saveStudentDocumentsPdf(studentId, pdfBase64, kind);
    return { success: true, filePath };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('payments:saveReceipt', async (_event, { paymentId, fileBase64, extension }) => {
  try {
    const filePath = await db.savePaymentReceipt(paymentId, fileBase64, extension);
    return { success: true, filePath };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('payments:updateReceiptPath', async (_event, { paymentId, filePath }) => {
  try {
    const payment = await db.updatePaymentReceiptPath(paymentId, filePath);
    return { success: true, payment };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('payments:openReceipt', async (_event, { filePath }) => {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return { success: false, message: 'No receipt file was saved for this payment.' };
    }
    const errorMsg = await shell.openPath(filePath);
    if (errorMsg) return { success: false, message: errorMsg };
    return { success: true };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('feeTemplate:create', async (_event, payload) => {
  try {
    const template = await db.createFeeTemplate(payload);
    return { success: true, template };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('feeTemplate:listAll', async (_event, { school }) => {
  try {
    const templates = await withRxdbRetry(() => db.listAllFeeCatalogTemplates(school));
    return { success: true, templates };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('feeTemplate:update', async (_event, { templateId, patch }) => {
  try {
    const template = await db.updateFeeCatalogTemplate(templateId, patch);
    return { success: true, template };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('feeCategory:create', async (_event, payload) => {
  try {
    const category = await withRxdbRetry(() => db.createFeeCategory(payload));
    return { success: true, category };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('feeCategory:list', async (_event, { school }) => {
  try {
    const categories = await db.listFeeCategories(school);
    return { success: true, categories };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('students:ledger', async (_event, { studentId }) => {
  try {
    const data = await withRxdbRetry(() => db.getStudentLedger(studentId));
    return { success: true, data };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('courses:list', async (_event, { school }) => {
  try {
    const courses = await db.listCourses(school);
    return { success: true, courses };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('courses:create', async (_event, payload) => {
  try {
    const course = await withRxdbRetry(() => db.createCourse(payload));
    return { success: true, course };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('subjects:list', async (_event, { courseId }) => {
  try {
    const subjects = await db.listSubjects(courseId);
    return { success: true, subjects };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('subjects:create', async (_event, payload) => {
  try {
    const subject = await withRxdbRetry(() => db.createSubject(payload));
    return { success: true, subject };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('enrollment:enroll', async (_event, payload) => {
  try {
    const enrollment = await withRxdbRetry(() => db.enrollStudentInCourse(payload));
    return { success: true, enrollment };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('sponsors:list', async (_event, { school }) => {
  try {
    const sponsors = await db.listSponsors(school);
    return { success: true, sponsors };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('sponsors:create', async (_event, payload) => {
  try {
    const sponsor = await withRxdbRetry(() => db.createSponsor(payload));
    return { success: true, sponsor };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('installments:create', async (_event, payload) => {
  try {
    const plan = await withRxdbRetry(() => db.createInstallmentPlanKeila(payload));
    return { success: true, plan };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('billing:generateMonthlyInvoices', async (_event, payload) => {
  try {
    const result = await withForegroundLock(() => withRxdbRetry(() => db.generateMonthlyInvoices(payload)));
    return { success: true, result };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('billing:generateTermlyInvoices', async (_event, payload) => {
  try {
    const result = await withForegroundLock(() => withRxdbRetry(() => db.generateTermlyInvoices(payload)));
    return { success: true, result };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('bulk:assignFee', async (_event, payload) => {
  try {
    const result = await withForegroundLock(() => withRxdbRetry(() => db.bulkAssignFee(payload)));
    return { success: true, assignments: result };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('bulk:removeFee', async (_event, payload) => {
  try {
    const result = await withForegroundLock(() => withRxdbRetry(() => db.bulkRemoveFee(payload)));
    return { success: true, ...result };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('feeAssignments:list', async (_event, { studentId }) => {
  try {
    const assignments = await withRxdbRetry(() => db.listFeeAssignments(studentId));
    return { success: true, assignments };
  } catch (err) { return { success: false, message: err.message }; }
});

// ---------- IPC: process payment ----------
ipcMain.handle('payment:billingSummary', async (_event, { studentId, school }) => {
  try {
    return { success: true, data: await withRxdbRetry(() => getStudentBillingSummary(studentId, school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('payment:listCatalog', async (_event, { school }) => {
  try {
    return { success: true, templates: await withRxdbRetry(() => listFeeCatalogTemplates(school)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('payment:createCharge', async (_event, payload) => {
  try {
    return { success: true, expectation: await withRxdbRetry(() => db.createChargeFromTemplate({ ...payload, createdBy: payload.createdBy })) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('payment:createInstallmentPlan', async (_event, payload) => {
  try {
    return { success: true, ...(await createInstallmentPlan(payload)) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('payment:bulkCreateInstallmentPlans', async (_event, payload) => {
  try {
    return { success: true, ...(await withForegroundLock(() => db.bulkCreateInstallmentPlans(payload))) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('payment:checkDuplicateCharges', async (_event, payload) => {
  try {
    const result = await withRxdbRetry(() => db.checkDuplicateCharges(payload));
    return { success: true, ...result };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('payment:bulkCreateFeeExpectations', async (_event, payload) => {
  try {
    return { success: true, ...(await withForegroundLock(() => db.bulkCreateFeeExpectations(payload))) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('payment:correct', async (_event, payload) => {
  try {
    const result = await withForegroundLock(() => withRxdbRetry(() => db.correctPaymentAmount(payload)));
    return { success: true, ...result };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('payment:getCorrections', async (_event, { paymentId }) => {
  try {
    const corrections = await withRxdbRetry(() => db.getCorrectionsForPayment(paymentId));
    return { success: true, corrections };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('payment:capture', async (_event, payload) => {
  try {
    const result = await withForegroundLock(() => withRxdbRetry(() => capturePayment(payload)));
    return { success: true, ...result };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ---------- IPC: self-service profile ----------
ipcMain.handle('profile:getOwn', async (_event, { username }) => {
  try {
    return { success: true, user: await getOwnProfile(username) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('profile:update', async (_event, payload) => {
  try {
    return { success: true, user: await updateOwnProfile(payload) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('profile:changePassword', async (_event, payload) => {
  try {
    await changeOwnPassword(payload);
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ---------- IPC: sync ----------
ipcMain.handle('sync:isConfigured', async () => {
  return sync.isConfigured();
});

ipcMain.handle('sync:now', async () => {
  try {
    return await runSync();
  } catch (err) {
    console.error('Manual sync error:', err);
    return { error: err.message };
  }
});

ipcMain.handle('diagnostics:syncStatus', async () => {
  try {
    const status = await sync.getSyncStatus();
    return { success: true, status };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('diagnostics:databaseStats', async () => {
  try {
    const stats = await withRxdbRetry(() => db.getDatabaseStats());
    return { success: true, stats };
  } catch (err) { return { success: false, message: err.message }; }
});

// ---------- IPC: notifications (sound/dialog) ----------
// Generic utility used by the renderer wherever it needs the user's
// attention — currently login failures; will extend to payment save
// confirmations once the ledger module exists.
ipcMain.handle('assets:getLogoBase64', async () => {
  try {
    // Read via fs in the main process rather than letting the renderer
    // load it as an <img src="file://..."> and draw it to canvas — that
    // combination taints the canvas in Electron's renderer (confirmed:
    // "Tainted canvases may not be exported"), and fetch() outright
    // refuses file:// URLs too. Neither browser-side path works here;
    // Node's fs has no such restriction.
    const logoPath = path.join(__dirname, 'assets', 'icon.png');
    const buffer = fs.readFileSync(logoPath);
    return { success: true, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ---------- printing (reports, thermal receipts) ----------
//
// Approach: write the PDF (already generated client-side via jsPDF) to a
// temp file, load it into a hidden BrowserWindow (Chromium's built-in PDF
// viewer renders it), then call webContents.print() on that window. This
// shows the real OS print dialog -- the same one any application uses --
// so any printer already set up in Windows works here automatically,
// thermal or otherwise, without needing printer-specific code. A printer
// only needs to appear in this list at all if Windows has a driver for
// it; raw Bluetooth ESC/POS printers without a Windows driver are a
// separate, harder problem this does not attempt to solve.

ipcMain.handle('print:listPrinters', async (_event) => {
  try {
    const printers = await mainWindow.webContents.getPrintersAsync();
    return { success: true, printers: printers.map((p) => ({ name: p.name, displayName: p.displayName, isDefault: p.isDefault })) };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

ipcMain.handle('print:pdf', async (_event, { base64, silent, deviceName, widthMicrons, heightMicrons }) => {
  const tempPath = path.join(os.tmpdir(), `fms-print-${Date.now()}.pdf`);
  let printWindow;
  try {
    fs.writeFileSync(tempPath, Buffer.from(base64, 'base64'));
    printWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await printWindow.loadURL(`file://${tempPath}`);
    const options = { silent: !!silent, printBackground: true };
    if (deviceName) options.deviceName = deviceName;
    // Thermal paper is a fixed narrow width, not a standard page size --
    // when given, this overrides the default (A4/Letter) page size to
    // match the roll width instead of shrinking a full-page layout down.
    if (widthMicrons && heightMicrons) {
      options.pageSize = { width: widthMicrons, height: heightMicrons };
    }
    await new Promise((resolve, reject) => {
      printWindow.webContents.print(options, (success, errorType) => {
        if (success) resolve();
        else reject(new Error(errorType || 'Print failed or was cancelled.'));
      });
    });
    return { success: true };
  } catch (err) {
    return { success: false, message: err.message };
  } finally {
    if (printWindow && !printWindow.isDestroyed()) printWindow.close();
    fs.unlink(tempPath, () => {}); // best-effort cleanup, don't block the response on it
  }
});

// ---------- backup / disaster recovery ----------

ipcMain.handle('backup:list', async () => {
  try {
    return { success: true, backups: backup.listBackups(db.DB_NAME) };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('backup:now', async () => {
  try {
    const folderName = await backup.backupDatabase(db.DB_NAME, 'manual');
    return { success: true, folderName };
  } catch (err) { return { success: false, message: err.message }; }
});

ipcMain.handle('backup:restore', async (_event, { backupName }) => {
  try {
    const result = await backup.restoreFromBackup(db.DB_NAME, backupName);
    // Restoring underneath a live database connection isn't safe — the
    // app quits immediately so the NEXT launch opens the restored files
    // fresh, rather than pretending this session can keep running
    // against files that just changed out from under it.
    setTimeout(() => app.exit(0), 800);
    return { success: true, ...result, willRestart: true };
  } catch (err) { return { success: false, message: err.message }; }
});


ipcMain.handle('notify:beep', async () => {
  shell.beep();
});

ipcMain.handle('notify:dialog', async (_event, { type = 'info', title, message, detail, buttons = ['OK'] }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const result = await dialog.showMessageBox(mainWindow, { type, title, message, detail, buttons });
  return result;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Runs on every path to quitting — the window's X button, Alt+F4, the OS
// shutting down, all of it — not just the explicit app.exit() calls
// elsewhere in this file. Without this, a normal "close the app" click
// right after a write (a payment just captured, a student just
// registered) races LokiJS's own interval-based autosave: close fast
// enough and the write can be lost, or in the worst case land as a
// partially-written file if something was mid-flush when the process
// actually died. preventDefault + finishing the close manually after
// closeDatabase() resolves guarantees the flush completes first, every
// time, regardless of which door someone used to quit.
let quitReadyToProceed = false;
app.on('before-quit', (event) => {
  if (quitReadyToProceed) return;
  event.preventDefault();
  closeDatabase()
    .catch((err) => console.error('[db] closeDatabase failed during quit:', err.message))
    .finally(() => {
      quitReadyToProceed = true;
      app.quit();
    });
});