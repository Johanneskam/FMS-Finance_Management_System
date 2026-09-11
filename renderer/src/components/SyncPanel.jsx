import React, { useEffect, useState } from 'react';

export default function SyncPanel() {
  const [configured, setConfigured] = useState(null);
  const [status, setStatus] = useState('Waiting for first sync...');
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    window.electronAPI.isSyncConfigured().then(setConfigured);
    window.electronAPI.onSyncStatus((text) => setStatus(text));
  }, []);

  async function handleSyncNow() {
    setSyncing(true);
    await window.electronAPI.syncNow();
    setSyncing(false);
  }

  return (
    <div>
      {configured === false && (
        <div className="ent-error-box">
          Firebase isn't configured yet — fill in <code>db/firebase-config.js</code> with your project's values.
        </div>
      )}
      {configured === true && (
        <div className="ent-success-box">Connected via Firebase. Syncs whenever this machine has internet.</div>
      )}

      <p style={{ margin: '0 0 0.9rem', fontSize: '0.78rem', color: 'var(--c-faint)' }}>{status}</p>

      <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleSyncNow} disabled={!configured || syncing}>
        {syncing ? 'Syncing...' : 'Sync now'}
      </button>
      <p className="ent-hint" style={{ marginTop: '0.7rem' }}>
        Also syncs automatically every 5 minutes in the background. Login always works offline regardless of sync status.
      </p>
    </div>
  );
}