'use strict';

// db/usb-backup.js — runs in the Electron MAIN process only.
//
// Periodically checks for a removable (USB) drive being plugged in, and
// if one is found, copies a backup onto it automatically — no button to
// press, no folder to remember. This is a SEPARATE safety net from the
// local backups/ folder (db/backup.js): a local backup and the live
// database both live on the same physical disk, so if that disk fails
// entirely, both are gone together. A USB copy is a genuinely separate
// piece of hardware.
//
// IMPORTANT — HONEST LIMITATION: this detects removable drives via
// Windows' `wmic` command, since that's the standard way to do this on
// Windows without a native Node module (native modules reintroduce the
// same compilation problems flagged elsewhere in this app for other
// features). This has NOT been tested against real USB hardware — there
// is no Windows machine or physical USB drive available in the
// environment this was built in. The drive-detection logic and the
// file-copy logic are each tested/provable on their own (copying files
// is exactly what db/backup.js already does, proven directly), but the
// combination — "does `wmic` actually report the right drive letter on
// a real machine" — needs confirming on a real Windows PC before this is
// trusted unsupervised. Treat the first few real-world backups as a
// verification step: check the drive after plugging it in and confirm
// a fresh FMS-Backups folder with real files actually appears.

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const backup = require('./backup');

const USB_RETAIN_COUNT = 5; // USB drives are typically smaller and more precious than the local disk — keep fewer than the local 14
const USB_FOLDER_NAME = 'FMS-Backups';

/** Lists currently-connected removable drive letters (e.g. ['E:', 'F:'])
 * on Windows. Resolves to an empty array on any non-Windows platform, or
 * if the detection command itself fails for any reason — this should
 * degrade to "no USB backup happened this cycle," never throw and
 * interrupt anything else the app is doing. */
function listRemovableDrives() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') { resolve([]); return; }
    exec('wmic logicaldisk where drivetype=2 get caption', { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout) { resolve([]); return; }
      const drives = stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^[A-Za-z]:$/.test(line));
      resolve(drives);
    });
  });
}

// Tracks which drives already received a backup THIS session, so a USB
// stick left plugged in for hours doesn't get re-backed-up every single
// scan cycle — only once per time it's inserted. Cleared for a drive
// once it's no longer detected, so unplugging and replugging (even the
// same drive) triggers a fresh backup, which is the sensible default.
const backedUpThisSession = new Set();

/** One scan cycle: lists removable drives, backs up to any that haven't
 * been backed up to yet this session. onStatus(message) is called for
 * anything worth surfacing to the person using the app — a completed
 * backup, or a failure on one specific drive (never throws past this
 * function; a failed backup to one USB drive shouldn't take down
 * anything else). */
async function scanAndBackup(dbName, onStatus, listDrivesFn = listRemovableDrives) {
  let drives;
  try {
    drives = await listDrivesFn();
  } catch {
    return; // detection itself failed — nothing to do this cycle, try again next time
  }

  const driveSet = new Set(drives.map((d) => d.toUpperCase()));
  for (const tracked of [...backedUpThisSession]) {
    if (!driveSet.has(tracked)) backedUpThisSession.delete(tracked); // drive removed — forget it, so replugging backs up again
  }

  for (const drive of drives) {
    const key = drive.toUpperCase();
    if (backedUpThisSession.has(key)) continue;
    try {
      const usbRoot = path.join(`${drive}\\`, USB_FOLDER_NAME);
      const folderName = await backup.backupDatabase(dbName, 'usb-auto', usbRoot, USB_RETAIN_COUNT);
      backedUpThisSession.add(key);
      if (folderName && onStatus) onStatus(`Automatic backup saved to USB drive ${drive}\\`);
    } catch (err) {
      console.error(`[usb-backup] Failed to back up to ${drive}:`, err.message);
      if (onStatus) onStatus(`Could not back up to ${drive}\\ — ${err.message}`);
      // Deliberately does NOT add to backedUpThisSession on failure, so
      // the next scan cycle retries the same drive rather than giving up
      // on it for the rest of the session.
    }
  }
}

/** Starts periodic scanning. Returns a function that stops it. */
function startUsbBackupWatcher(dbName, onStatus, intervalMs = 20 * 1000) {
  const timer = setInterval(() => {
    scanAndBackup(dbName, onStatus).catch((err) => console.error('[usb-backup] Scan cycle failed:', err.message));
  }, intervalMs);
  return () => clearInterval(timer);
}

module.exports = { listRemovableDrives, scanAndBackup, startUsbBackupWatcher };
