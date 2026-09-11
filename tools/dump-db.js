'use strict';

// tools/dump-db.js
//
// Standalone debug tool — run with plain `node tools/dump-db.js` from the
// project root (does NOT need Electron running; reads the database files
// directly the same way db.js does, using the same LokiFsStructuredAdapter).
//
// IMPORTANT: close the app first. LokiJS/Electron may hold a lock on the
// files while the app is running, which can cause this to read a stale or
// partial snapshot.
//
// Usage:
//   node tools/dump-db.js            -> prints a summary + full dump to console
//   node tools/dump-db.js --out      -> also writes db-dump.json in this folder

const path = require('path');
const fs = require('fs');
const loki = require('lokijs');
const LokiFsStructuredAdapter = require('lokijs/src/loki-fs-structured-adapter');

// Same folder Electron uses for userData — named after package.json's
// productName ("Fee Management System"), not the `name` field.
const DB_PATH = path.join(process.env.APPDATA, 'Fee Management System', 'fms-data.db');

function main() {
  if (!fs.existsSync(DB_PATH)) {
    console.error('Database file not found at:', DB_PATH);
    console.error('Check the app has been run at least once, and that this path matches your machine.');
    process.exit(1);
  }

  const adapter = new LokiFsStructuredAdapter();
  const db = new loki(DB_PATH, {
    adapter,
    autoload: true,
    autoloadCallback: () => {
      const summary = {};
      const fullDump = {};

      db.collections.forEach((col) => {
        // Collection names are stored as "<name>-0" internally (RxDB's
        // internal revision suffix) — strip it for readability.
        const cleanName = col.name.replace(/-0$/, '');
        if (cleanName === '_rxdb_internal') return; // RxDB's own bookkeeping, not app data

        summary[cleanName] = col.data.length;
        fullDump[cleanName] = col.data;
      });

      console.log('\n=== RECORD COUNTS ===');
      console.table(summary);

      console.log('\n=== FULL DUMP ===');
      console.log(JSON.stringify(fullDump, null, 2));

      if (process.argv.includes('--out')) {
        const outPath = path.join(__dirname, 'db-dump.json');
        fs.writeFileSync(outPath, JSON.stringify(fullDump, null, 2), 'utf8');
        console.log('\nAlso wrote:', outPath);
      }

      process.exit(0);
    }
  });
}

main();
