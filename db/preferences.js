'use strict';

// db/preferences.js — runs in the Electron MAIN process only.
//
// Small local device preferences, stored the same way sync-config.json is
// (a plain JSON file in userData) — deliberately separate from the RxDB
// ledger database, since this is machine-local UI convenience, not
// synced/shared data.
//
// IMPORTANT: only the USERNAME is ever remembered here, never the password.
// This is a financial app that a few different roles may occasionally log
// into on the same physical station (e.g. Superadmin roaming between
// machines) — skipping the password entirely would be a real security
// regression. Remembering just the username saves re-typing it without
// weakening the actual authentication step at all.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const PREFS_PATH = path.join(app.getPath('userData'), 'local-prefs.json');

function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(PREFS_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writePrefs(prefs) {
  fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2), 'utf8');
}

function getRememberedUsername() {
  return readPrefs().rememberedUsername || null;
}

function setRememberedUsername(username) {
  const prefs = readPrefs();
  if (username) {
    prefs.rememberedUsername = username;
  } else {
    delete prefs.rememberedUsername;
  }
  writePrefs(prefs);
}

module.exports = { getRememberedUsername, setRememberedUsername };
