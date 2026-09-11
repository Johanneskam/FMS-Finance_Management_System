# Backup & Disaster Recovery Plan
Fee Management System — Wendy Private School / Keila Academy

This document explains, in plain terms, how this app protects your data and exactly what to do if something goes wrong. Keep a printed copy somewhere accessible — if the app won't start, you need to be able to read this *without* the app.

---

## 1. How backups work (already running, nothing to set up)

Every time the app starts, and once a day after that while it stays open, it automatically makes a full copy of the database and stores it in a `backups` folder right next to your data. The last 14 backups are kept; older ones are removed automatically so this never fills up your disk.

You can also make one on demand at any time:

**Superadmin → System Diagnostics → Backups → "Backup Now"**

### Where backups actually live

```
C:\Users\<YourWindowsUsername>\AppData\Roaming\Fee Management System\fms-data\backups\
```

Each backup is its own folder, named with the date and time it was taken, e.g. `2026-07-31_09-00-00`.

**This whole `Fee Management System` folder is the single most important folder on this computer.** If you back this computer up in any other way (an external drive, a company backup tool, etc.), make sure that folder specifically is included.

---

## 2. Restoring from a backup (inside the app — the normal way)

Use this if the app **opens fine**, but the data in it is wrong — someone accidentally deleted something important, entered a payment that didn't happen, or you want to undo a batch of mistaken changes.

1. **Superadmin → System Diagnostics → Backups**
2. Find the backup from *before* the problem happened (check the date/time)
3. Click **Restore**
4. Read the warning carefully — restoring replaces *everything* currently in the database with that backup's state. Anything entered after that backup was taken will be gone.
5. Type `RESTORE` exactly, then click **Restore and Restart**
6. The app closes itself automatically
7. **Start the app again normally** — it will open showing the restored data

A safety copy of whatever was in the database *right before* the restore is taken automatically, tagged `pre-restore-safety-backup` — so if you pick the wrong backup by mistake, that too can be undone the same way.

---

## 3. If the app won't open at all (the real emergency case)

This is rare, but here's exactly what to do, in order. Don't skip steps.

### Step 1 — Don't panic, and don't delete anything yet
Your data is very likely still sitting safely on disk even if the app itself is broken. The backups folder from Section 1 is separate from whatever is causing the app to fail.

### Step 2 — Try restarting the computer
Sounds obvious, but a surprising number of "the app won't open" problems are actually the computer needing a restart, not a real data problem.

### Step 3 — Check if the database files themselves look intact
Open **File Explorer** and go to:
```
C:\Users\<YourWindowsUsername>\AppData\Roaming\Fee Management System\fms-data\
```
You should see a file called `fms-data.db` and several files named `fms-data.db.0`, `fms-data.db.1`, and so on, sitting directly in that folder (not inside `backups`). If these exist and have reasonable file sizes (not 0 KB), your data is very likely fine — the problem is with the app itself, not your data.

### Step 4 — Manually restore the most recent backup
If Step 3's files look wrong, missing, or corrupted:

1. Close the app completely if it's open at all (check Task Manager for `electron.exe` or `Fee Management System` and end it if needed)
2. Go to the `backups` folder and find the **most recent** backup folder
3. Copy every file from inside that backup folder **except** `backup-info.json`
4. Go back up one level to the `fms-data` folder itself
5. **Delete** the existing `fms-data.db` and `fms-data.db.*` files there (the broken ones)
6. **Paste** the files you copied from the backup into that same `fms-data` folder
7. Start the app normally

This is exactly what the in-app Restore button does automatically — you're just doing it by hand because the app itself isn't available to click the button for you.

### Step 5 — If you're not comfortable doing Step 4 yourself
Don't guess. Copy the entire `Fee Management System` folder (via right-click → Copy, then paste it somewhere safe like a USB drive or another folder on the desktop) *before* you let anyone else touch the computer, so nothing gets overwritten by accident — then get technical help. Having that copy means nothing is lost no matter what happens next.

---

## 4. What backups do *not* protect against

Being honest about the limits of this plan matters as much as the plan itself:

- **This computer being physically lost, stolen, or destroyed** (fire, theft, hardware failure) — the backups folder lives on the *same* hard drive as your live data. If the drive itself fails, both are gone together. This is why the sync-to-cloud feature (when configured and working) matters as a *second, separate* copy of your data, not just a convenience.
- **A mistake that gets backed up before anyone notices it.** If a wrong entry sits in the system for more than 14 days before it's caught, it may have aged out of every kept backup. Review your records regularly, not just when something looks obviously wrong.
- **Someone deliberately misusing legitimate access.** Backups protect against accidents and technical failure, not against someone with a real login account intentionally causing harm. That's what the Audit Logs (Admin/Superadmin) are for — a separate concern from backups.

---

## 5. A simple rule of thumb

**If in doubt, take a manual backup before doing anything risky** — a big bulk operation, a schema update, anything unfamiliar. It takes a few seconds and costs nothing. The button is always right there:

**Superadmin → System Diagnostics → Backups → "Backup Now"**
