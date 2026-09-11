'use strict';

// db/backup.js — runs in the Electron MAIN process only.
//
// LokiJS (this app's local storage) doesn't save as one single file — it
// writes fms-data.db plus a handful of numbered sibling files
// (fms-data.db.0, fms-data.db.1, ...) directly into the app's userData
// folder. A backup has to copy the whole set together, or a restore could
// mix files from different points in time and produce a database that's
// internally inconsistent. Everything here works with that whole set as
// one unit — never a single file in isolation.
//
// Backups are automatic (once at every app startup, before any new writes
// that session can happen — and once daily while the app stays open) and
// available on demand from System Diagnostics. Restoring always requires
// an app restart to take effect safely, rather than swapping files out
// from underneath a live database connection.

const fs = require('fs');
const path = require('path');

const RETAIN_COUNT = 14; // keep the last 14 backups — roughly two weeks of daily snapshots, prunes anything older automatically so this can't grow unbounded

function getDbDir(dbName) {
  return path.dirname(dbName);
}
function getDbFileBaseName(dbName) {
  return path.basename(dbName); // e.g. 'fms-data'
}
function getBackupsRoot(dbName) {
  return path.join(getDbDir(dbName), 'backups');
}

/** Every file LokiJS actually wrote for this database — fms-data.db and
 * all its numbered siblings, nothing else in the folder gets touched. */
function findDatabaseFiles(dbName) {
  const dir = getDbDir(dbName);
  const base = getDbFileBaseName(dbName);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f === `${base}.db` || f.startsWith(`${base}.db.`));
}

function timestampForFolder() {
  // Filesystem-safe, sortable, human-readable at a glance: 2026-07-31_14-05-00
  return new Date().toISOString().replace('T', '_').replace(/:/g, '-').slice(0, 19);
}

/** Copies the current database files into backups/<timestamp>/ — or, if
 * destRoot is given, into <destRoot>/<timestamp>/ instead (used for USB
 * backups, so the same tested copy/prune logic serves both cases rather
 * than duplicating it). Returns the backup folder name, or null if there
 * was nothing to back up yet. */
async function backupDatabase(dbName, reason = 'scheduled', destRoot = null, retainCount = RETAIN_COUNT) {
  const files = findDatabaseFiles(dbName);
  if (files.length === 0) return null;

  const folderName = timestampForFolder();
  const dir = getDbDir(dbName);
  const root = destRoot || getBackupsRoot(dbName);
  const backupDir = path.join(root, folderName);
  fs.mkdirSync(backupDir, { recursive: true });

  for (const file of files) {
    fs.copyFileSync(path.join(dir, file), path.join(backupDir, file));
  }
  fs.writeFileSync(path.join(backupDir, 'backup-info.json'), JSON.stringify({
    createdAt: new Date().toISOString(), reason, fileCount: files.length
  }, null, 2));

  await pruneBackupsAt(root, retainCount);
  return folderName;
}

/** Every backup currently on disk at the given root, newest first, with
 * size and reason. */
function listBackupsAt(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter((name) => fs.statSync(path.join(root, name)).isDirectory())
    .map((name) => {
      const infoPath = path.join(root, name, 'backup-info.json');
      let info = {};
      try { info = JSON.parse(fs.readFileSync(infoPath, 'utf8')); } catch { /* older/manual backup without the info file — still usable */ }
      const dirPath = path.join(root, name);
      const sizeBytes = fs.readdirSync(dirPath)
        .filter((f) => f !== 'backup-info.json')
        .reduce((sum, f) => sum + fs.statSync(path.join(dirPath, f)).size, 0);
      return { name, createdAt: info.createdAt || name, reason: info.reason || 'unknown', sizeBytes };
    })
    .sort((a, b) => b.name.localeCompare(a.name));
}

/** Same thing, scoped to this database's own local backups folder —
 * what the Backups panel in System Diagnostics shows. */
function listBackups(dbName) {
  return listBackupsAt(getBackupsRoot(dbName));
}

/** Deletes backups beyond retainCount at the given root, oldest first —
 * keeps disk (or USB drive) usage bounded without needing anyone to
 * remember to clean up manually. */
async function pruneBackupsAt(root, retainCount) {
  const backups = listBackupsAt(root);
  const toDelete = backups.slice(retainCount);
  for (const b of toDelete) {
    fs.rmSync(path.join(root, b.name), { recursive: true, force: true });
  }
  return { deleted: toDelete.length };
}

async function pruneOldBackups(dbName) {
  return pruneBackupsAt(getBackupsRoot(dbName), RETAIN_COUNT);
}

/**
 * Stages a restore: copies the chosen backup's files back over the live
 * database files. Deliberately does NOT attempt to do this against a
 * database that's currently open in the same process — RxDB/LokiJS keep
 * an in-memory copy that a file-level restore underneath it can't safely
 * override. The caller (main.js) is expected to quit the app immediately
 * after this succeeds, so the next launch opens the restored files fresh.
 * A safety backup of the CURRENT (pre-restore) state is taken first, so
 * restoring is itself undoable if the wrong backup gets picked by mistake.
 */
async function restoreFromBackup(dbName, backupName) {
  const backupDir = path.join(getBackupsRoot(dbName), backupName);
  if (!fs.existsSync(backupDir)) {
    throw new Error(`Backup "${backupName}" not found.`);
  }

  // Safety net: back up whatever's live right now, tagged distinctly,
  // before overwriting anything.
  await backupDatabase(dbName, 'pre-restore-safety-backup');

  const dir = getDbDir(dbName);
  const backupFiles = fs.readdirSync(backupDir).filter((f) => f !== 'backup-info.json');
  if (backupFiles.length === 0) {
    throw new Error('That backup is empty — nothing to restore.');
  }

  // Remove the current live files first, so a restore from a backup with
  // FEWER files (e.g. a collection that didn't exist yet back then)
  // doesn't leave newer, mismatched files behind alongside the restored
  // ones.
  const currentFiles = findDatabaseFiles(dbName);
  for (const f of currentFiles) {
    fs.unlinkSync(path.join(dir, f));
  }
  for (const f of backupFiles) {
    fs.copyFileSync(path.join(backupDir, f), path.join(dir, f));
  }

  return { restoredFiles: backupFiles.length, backedUpFirst: true };
}

module.exports = { backupDatabase, listBackups, listBackupsAt, pruneOldBackups, pruneBackupsAt, restoreFromBackup, findDatabaseFiles };