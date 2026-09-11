import React, { useEffect, useState } from 'react';
import {
  Menu, Search, Mail, Bell, Wallet, AlertCircle, FileEdit, CalendarCheck, GraduationCap,
  UserPlus, UsersRound, BarChart2, Cog, Zap, Activity, ListChecks,
  Home, Users, UserCog, FileText, CreditCard,
  Presentation, Calendar, ClipboardList, User, Settings, HelpCircle, LogOut, X, Bus, HardDrive, RefreshCw, BookOpen
} from 'lucide-react';
import Sidebar from './Sidebar.jsx';
import SyncPanel from './SyncPanel.jsx';
import UserManagement from './UserManagement.jsx';
import Reports, { money } from './Reports.jsx';
import HelpPage from './HelpPage.jsx';
import SecretaryPerformance from './SecretaryPerformance.jsx';
import FullReport from './FullReport.jsx';
import AllPayments from './AllPayments.jsx';
import Profile from './Profile.jsx';
import StudentHub from './StudentHub.jsx';   // <-- NEW IMPORT
import Toggle from './ui/Toggle.jsx';
import DonutRing from './ui/DonutRing.jsx';
import Footer from './ui/Footer.jsx';

// ---------------------------------------------------------------------------
// MOCK DATA — swap for real RxDB/Firestore queries once the ledger data
// exists. Clearly flagged in the UI itself (see the "Mock data" tags).
// ---------------------------------------------------------------------------

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: Home, section: 'MENU' },
  { key: 'students', label: 'Students Hub', icon: GraduationCap },
  { key: 'users', label: 'User Management', icon: Users },
  { key: 'fullReport', label: 'Full Financial Report', icon: BookOpen },
  { key: 'secretaries', label: 'Finance Secretaries', icon: UserCog },
  { key: 'reports', label: 'Reports & Analytics', icon: BarChart2 },
  { key: 'all_payments', label: 'All Payments', icon: ListChecks },
  { key: 'audit', label: 'Audit Logs', icon: ClipboardList },
  { key: 'notifications', label: 'Notifications', icon: Bell, badge: 3 },
  { key: 'diagnostics', label: 'System Diagnostics', icon: Cog },
  { key: 'profile', label: 'Profile', icon: User, section: 'GENERAL' },
  { key: 'help', label: 'Help', icon: HelpCircle },
  { key: 'logout', label: 'Logout', icon: LogOut }
];

function initials(firstName, lastName, username) {
  const a = (firstName || '')[0] || '';
  const b = (lastName || '')[0] || '';
  return (a + b).toUpperCase() || (username || '?')[0].toUpperCase();
}

export default function SuperadminDashboard({ user, onLogout, onProfileUpdated }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [syncConfigured, setSyncConfigured] = useState(null);

  const [pendingCount, setPendingCount] = useState(0);
  const [showNotice, setShowNotice] = useState(false);
  const [usbBackupMessage, setUsbBackupMessage] = useState('');
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  useEffect(() => {
    window.electronAPI.isSyncConfigured().then(setSyncConfigured);
    window.electronAPI.onUsbBackupStatus((text) => {
      setUsbBackupMessage(text);
      setTimeout(() => setUsbBackupMessage(''), 6000);
    });
  }, []);

  const [syncing, setSyncing] = useState(false);
  const [lastSyncNote, setLastSyncNote] = useState('');

  function loadDashboardData() {
    setDashboardLoading(true);
    Promise.all([
      window.electronAPI.getFinancialReportData(user.section),
      window.electronAPI.getReportsCenterExtras(user.section),
      window.electronAPI.getAllPaymentsDetailed({ school: user.section }),
      window.electronAPI.getFeeCategoryReport({ school: user.section, category: 'Tuition' }),
      window.electronAPI.getFeeCategoryReport({ school: user.section, category: 'Bus' }),
      window.electronAPI.getFeeCategoryReport({ school: user.section, category: 'Boarding' })
    ]).then(([reportRes, extrasRes, paymentsRes, tuitionRes, busRes, hostelRes]) => {
      setDashboardData({
        report: reportRes.success ? reportRes.data : null,
        extras: extrasRes.success ? extrasRes.data : null,
        recentPayments: paymentsRes.success ? paymentsRes.data.rows.slice(0, 5) : [],
        categories: {
          tuition: tuitionRes.success ? tuitionRes.data.totalCollected : 0,
          bus: busRes.success ? busRes.data.totalCollected : 0,
          hostel: hostelRes.success ? hostelRes.data.totalCollected : 0
        }
      });
      setDashboardLoading(false);
    });
  }

  useEffect(() => {
    loadDashboardData();
  }, [user.section]);

  // Background sync used to only reflect here after a full app restart —
  // this data was only ever fetched once on mount. Now: whenever a sync
  // cycle actually pulls something new (from another station, or a
  // manual Sync Now click below), silently refresh what's on screen.
  useEffect(() => {
    window.electronAPI.onSyncCompleted(({ pulled }) => {
      if (pulled > 0) {
        setLastSyncNote(`Updated just now — ${pulled} new record${pulled !== 1 ? 's' : ''} synced in.`);
        loadDashboardData();
        setTimeout(() => setLastSyncNote(''), 8000);
      }
    });
  }, [user.section]);

  async function handleSyncNowClick() {
    setSyncing(true);
    try {
      await window.electronAPI.syncNow();
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => {
    // A heads-up, not a task — shown once right after login, dismissible,
    // never demands a decision on the spot. Approving/rejecting still
    // happens wherever the admin actually chooses to deal with it.
    window.electronAPI.listPendingDeletionRequests(user.section).then((res) => {
      if (res.success && res.requests.length > 0) {
        setPendingCount(res.requests.length);
        setShowNotice(true);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleNavigate(key) {
    if (key === 'logout') {
      onLogout();
      return;
    }
    setActiveView(key);
    setSidebarOpen(false);
  }

  const activeLabel = NAV_ITEMS.find((i) => i.key === activeView)?.label || 'Dashboard';
  const isSuperadmin = user.role === 'Superadmin';
  const SUPERADMIN_ONLY_KEYS = ['users', 'diagnostics'];
  const navItems = NAV_ITEMS
    .filter((item) => isSuperadmin || !SUPERADMIN_ONLY_KEYS.includes(item.key))
    .map((item) => (item.key === 'notifications' ? { ...item, badge: pendingCount || undefined } : item));

  return (
    <div className="ent-shell">
      <div className="ent-bg-shapes">
        <div className="ent-shape ent-shape-1" />
        <div className="ent-shape ent-shape-2" />
        <div className="ent-shape ent-shape-3" />
      </div>

      <Sidebar
        title="WPS"
        subtitle="Admin Portal"
        items={navItems}
        activeKey={activeView}
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="ent-app-content">
        <header className="ent-header">
          <div className="ent-header-left">
            <button className="ent-menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
              <Menu size={19} />
            </button>
            <div>
              <div className="ent-logo-text">Fee <b>Management</b></div>
              <div className="ent-page-subtitle">Track fee collections across both schools here.</div>
            </div>
          </div>
          <div className="ent-header-right">
            <div className="ent-search">
              <Search size={15} />
              <input type="text" placeholder="Search users, logs, reports..." />
            </div>
            <button className="ent-header-icon-btn"><Mail size={19} /></button>
            <button
              className="ent-btn ent-btn--secondary ent-btn--sm"
              onClick={handleSyncNowClick}
              disabled={syncing}
              title="Pull in any changes made on other stations right now"
            >
              <RefreshCw size={14} className={syncing ? 'ent-spin' : ''} /> {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <button className="ent-header-icon-btn" onClick={() => handleNavigate('notifications')}>
              <Bell size={19} />
              {pendingCount > 0 && <span className="ent-dot" />}
            </button>
            <div className="ent-user">
              {user.avatarDataUrl ? (
                <img src={user.avatarDataUrl} alt="" className="ent-avatar ent-avatar--md" style={{ objectFit: 'cover' }} />
              ) : (
                <div className="ent-avatar ent-avatar--md">{initials(user.firstName, user.lastName, user.username)}</div>
              )}
              <div className="ent-user-info">
                <h4>{user.username}</h4>
                <p>{user.role}</p>
              </div>
            </div>
          </div>
        </header>

        <main className="ent-main">
          {lastSyncNote && (
            <div className="ent-success-box" style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <RefreshCw size={14} /> {lastSyncNote}
            </div>
          )}
          {activeView !== 'dashboard' ? (
            activeView === 'users' ? (
              <UserManagement user={user} />
            ) : activeView === 'reports' ? (
              <Reports user={user} />
            ) : activeView === 'notifications' ? (
              <NotificationsPanel user={user} onCountChange={setPendingCount} />
            ) : activeView === 'audit' ? (
              <AuditLogPanel user={user} />
            ) : activeView === 'fullReport' ? (
              <FullReport user={user} />
            ) : activeView === 'secretaries' ? (
              <SecretaryPerformance user={user} />
            ) : activeView === 'diagnostics' ? (
              <DiagnosticsPanel />
            ) : activeView === 'all_payments' ? (
              <AllPayments user={user} />
            ) : activeView === 'profile' ? (
              <Profile user={user} onProfileUpdated={onProfileUpdated} />
            ) : activeView === 'help' ? (
              <HelpPage user={user} />
            ) : activeView === 'students' ? (          // <-- NEW RENDER CONDITION
              <StudentHub user={user} />
            ) : (
              <div className="ent-card">
                <h3 className="ent-card-title">{activeLabel}</h3>
                {activeView === 'settings' ? (
                  <SyncPanel />
                ) : (
                  <p style={{ color: 'var(--c-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                    This section isn't built yet — it'll arrive alongside the rest of the ledger module.
                  </p>
                )}
              </div>
            )
          ) : (
            <>
              <div className="ent-kpi-grid">
                {(dashboardLoading || !dashboardData ? [] : [
                  { label: 'Total Collected', value: money(dashboardData.report?.totalCollected), icon: Wallet, highlight: true },
                  { label: 'Total Outstanding', value: money(dashboardData.report?.totalOutstanding), icon: AlertCircle },
                  { label: 'Adjustments (Total)', value: money(dashboardData.extras?.adjustments?.totalAmount), icon: FileEdit },
                  { label: 'Collected Today', value: money(dashboardData.extras?.collections?.todayTotal), icon: CalendarCheck },
                  { label: 'Active Students', value: String(dashboardData.report?.totalStudents ?? 0), icon: GraduationCap }
                ]).map((k) => {
                  const Icon = k.icon;
                  return (
                    <div key={k.label} className={`ent-kpi-card ${k.highlight ? 'ent-kpi-card--highlight' : ''}`}>
                      <div className="ent-kpi-icon"><Icon size={26} /></div>
                      <div className="ent-kpi-label">{k.label}</div>
                      <div className="ent-kpi-value">{dashboardLoading ? '...' : k.value}</div>
                    </div>
                  );
                })}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '1.2rem', marginBottom: '1.2rem', alignItems: 'start' }}>
                <div className="ent-card">
                  <h3 className="ent-card-title">Collection Overview</h3>
                  <div className="ent-widget-card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div className="ent-widget-label">Fee Management System</div>
                        <div className="ent-widget-sublabel">Primary Collection Account</div>
                      </div>
                      <div className="ent-widget-chip" />
                    </div>
                    <div className="ent-widget-number">WPS · 2026 · ●●●●</div>
                    <div className="ent-widget-footer">
                      <span>Managed by<br /><b>{user.username}</b></span>
                      <span>Period<br /><b>2026</b></span>
                    </div>
                  </div>
                  <div style={{ marginTop: '1.1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--c-muted)', marginBottom: '0.4rem' }}>
                      <span>Collection Rate</span><span>{dashboardData?.report?.collectionRatePct ?? 0}%</span>
                    </div>
                    <div style={{ height: '8px', borderRadius: '999px', background: 'var(--c-border-soft)', overflow: 'hidden' }}>
                      <div style={{ width: `${dashboardData?.report?.collectionRatePct ?? 0}%`, height: '100%', background: 'var(--gradient-action)' }} />
                    </div>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1rem' }}>
                    <span style={{ fontSize: '0.8rem', color: 'var(--c-ink-soft)' }}>Cloud sync</span>
                    <Toggle checked={!!syncConfigured} onChange={() => {}} disabled id="sync-status" />
                  </div>
                </div>

                <div className="ent-card">
                  <div className="ent-card-head">
                    <h3 className="ent-card-title"><ListChecks size={16} /> Recent Payments</h3>
                  </div>
                  <div className="ent-table-wrap">
                    <table className="ent-table">
                      <thead><tr><th>Receiver</th><th>Type</th><th>Date</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
                      <tbody>
                        {dashboardLoading ? <tr><td colSpan={4} className="ent-table-empty">Loading...</td></tr> :
                          !dashboardData?.recentPayments?.length ? <tr><td colSpan={4} className="ent-table-empty">No payments recorded yet.</td></tr> :
                          dashboardData.recentPayments.map((p) => (
                            <tr key={p.paymentId}>
                              <td style={{ fontWeight: 600 }}>{p.studentName}</td>
                              <td style={{ color: 'var(--c-muted)' }}>{p.paidFor || p.paymentMethod}</td>
                              <td style={{ color: 'var(--c-muted)' }}>{p.paymentDate}</td>
                              <td className="ent-td-num">{money(p.amount)}</td>
                            </tr>
                          ))
                        }
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.2fr', gap: '1.2rem' }}>
                <div>
                  <div className="ent-card-head" style={{ marginBottom: '0.9rem' }}>
                    <h3 className="ent-card-title" style={{ margin: 0 }}>Fee Categories</h3>
                    <button className="ent-icon-btn ent-icon-btn--blue" onClick={() => handleNavigate('reports')}><Zap size={14} /></button>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.8rem' }}>
                    {[
                      { Icon: GraduationCap, amount: dashboardData?.categories?.tuition, label: 'Tuition' },
                      { Icon: Bus, amount: dashboardData?.categories?.bus, label: 'Bus Fees' },
                      { Icon: Home, amount: dashboardData?.categories?.hostel, label: 'Hostel' }
                    ].map((c) => (
                      <div className="ent-category-tile" key={c.label}>
                        <div className="ent-category-icon"><c.Icon size={22} /></div>
                        <div className="ent-category-amount">{dashboardLoading ? '...' : money(c.amount)}</div>
                        <div className="ent-category-date">Collected to date</div>
                        <div className="ent-category-label">{c.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ent-card">
                  <div className="ent-card-head">
                    <h3 className="ent-card-title"><Activity size={16} /> Financial Health</h3>
                  </div>
                  <div className="ent-donut-row">
                    <DonutRing percent={dashboardData?.report?.collectionRatePct ?? 0} label="Collection Rate" color="#06b6d4" />
                    <DonutRing
                      percent={dashboardData?.report?.totalStudents ? Math.round((((dashboardData.report.categoryCounts?.Good ?? 0) + (dashboardData.report.categoryCounts?.Overpaid ?? 0)) / dashboardData.report.totalStudents) * 100) : 0}
                      label="Good Standing" color="#0e7490"
                    />
                    <DonutRing
                      percent={dashboardData?.report?.totalStudents ? Math.round((((dashboardData.report.categoryCounts?.Debtors ?? 0) + (dashboardData.report.categoryCounts?.['Chronic Debtors'] ?? 0)) / dashboardData.report.totalStudents) * 100) : 0}
                      label="Debtor Rate" color="#dc2626"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
        </main>

        <Footer />
      </div>

      {showNotice && (
        <div style={{
          position: 'fixed', top: '20px', right: '20px', zIndex: 2000,
          background: '#1e293b', color: '#fff', borderRadius: 'var(--r-lg)',
          padding: '0.9rem 1.1rem', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', gap: '0.8rem', maxWidth: '360px'
        }}>
          <Bell size={18} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>
            {pendingCount} student deactivation request{pendingCount !== 1 ? 's' : ''} awaiting your review.
          </div>
          <button
            style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', flexShrink: 0, opacity: 0.7 }}
            onClick={() => setShowNotice(false)}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {usbBackupMessage && (
        <div style={{
          position: 'fixed', bottom: '20px', right: '20px', zIndex: 2000,
          background: '#1e293b', color: '#fff', borderRadius: 'var(--r-lg)',
          padding: '0.9rem 1.1rem', boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          display: 'flex', alignItems: 'center', gap: '0.8rem', maxWidth: '360px'
        }}>
          <HardDrive size={18} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '0.85rem', lineHeight: 1.4 }}>{usbBackupMessage}</div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System Diagnostics — Superadmin-only. Sync health and live database
// stats, in-app instead of needing a terminal.
// ---------------------------------------------------------------------------
function DiagnosticsPanel() {
  const [syncStatus, setSyncStatus] = useState(null);
  const [dbStats, setDbStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState('');

  const [backups, setBackups] = useState([]);
  const [backingUp, setBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState('');
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([
      window.electronAPI.getSyncStatus(),
      window.electronAPI.getDatabaseStats(),
      window.electronAPI.listBackups()
    ]).then(([syncRes, statsRes, backupsRes]) => {
      if (syncRes.success) setSyncStatus(syncRes.status);
      if (statsRes.success) setDbStats(statsRes.stats);
      if (backupsRes.success) setBackups(backupsRes.backups);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []);

  async function handleSyncNow() {
    setSyncing(true);
    setSyncResult('');
    try {
      const result = await window.electronAPI.syncNow();
      setSyncResult(result.error ? `Failed: ${result.error}` : (result.skipped ? 'Sync skipped — not configured or offline.' : `Pushed ${result.pushed ?? 0}, pulled ${result.pulled ?? 0}.`));
      load();
    } finally {
      setSyncing(false);
    }
  }

  async function handleBackupNow() {
    setBackingUp(true);
    setBackupMessage('');
    try {
      const res = await window.electronAPI.backupNow();
      setBackupMessage(res.success ? 'Backup created.' : `Failed: ${res.message}`);
      if (res.success) load();
    } finally {
      setBackingUp(false);
    }
  }

  async function handleRestore() {
    if (restoreConfirmText !== 'RESTORE') return;
    setRestoring(true);
    try {
      const res = await window.electronAPI.restoreFromBackup(restoreTarget.name);
      if (!res.success) {
        setBackupMessage(`Restore failed: ${res.message}`);
        setRestoring(false);
        return;
      }
      // The app is about to quit itself (main process does this right
      // after a successful restore) — nothing further to do here except
      // tell the person what's happening.
      setBackupMessage('Restored. The app is closing now — start it again to see the restored data.');
    } catch (err) {
      setBackupMessage(`Restore failed: ${err.message}`);
      setRestoring(false);
    }
  }

  function fmtTime(iso) {
    return iso ? new Date(iso).toLocaleString() : 'Never';
  }
  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <div>
      <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
        <div className="ent-card-head">
          <h3 className="ent-card-title"><Cog size={16} /> Sync Status</h3>
          <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={load} disabled={loading}>Refresh</button>
        </div>
        {loading ? <p className="ent-hint">Loading...</p> : syncStatus && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.8rem', fontSize: '0.85rem', marginBottom: '1rem' }}>
              <div><strong>Configured:</strong> <span className={`ent-badge ${syncStatus.configured ? 'ent-badge--success' : 'ent-badge--muted'}`}>{syncStatus.configured ? 'Yes' : 'No'}</span></div>
              <div><strong>Firestore Project:</strong> {syncStatus.projectId || '\u2014'}</div>
              <div><strong>Last Push:</strong> {fmtTime(syncStatus.lastPushAt)}</div>
              <div><strong>Last Pull:</strong> {fmtTime(syncStatus.lastPullAt)}</div>
              <div><strong>Last Full Sync:</strong> {fmtTime(syncStatus.lastSyncAt)}</div>
            </div>
            <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleSyncNow} disabled={syncing || !syncStatus.configured}>
              {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            {syncResult && <p className="ent-hint" style={{ marginTop: '0.6rem' }}>{syncResult}</p>}
          </>
        )}
      </div>

      <div className="ent-card">
        <h3 className="ent-card-title"><ClipboardList size={16} /> Database Stats</h3>
        {loading ? <p className="ent-hint">Loading...</p> : dbStats && (
          <>
            <div style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
              <div><strong>Station ID:</strong> {dbStats.stationId}</div>
              <div style={{ wordBreak: 'break-all' }}><strong>Database Path:</strong> {dbStats.dbPath}</div>
            </div>
            <div className="ent-table-wrap">
              <table className="ent-table">
                <thead><tr><th>Collection</th><th style={{ textAlign: 'right' }}>Records</th></tr></thead>
                <tbody>
                  {Object.entries(dbStats.counts).map(([name, count]) => (
                    <tr key={name}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.82rem' }}>{name}</td>
                      <td className="ent-td-num">{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="ent-card" style={{ marginTop: '1.2rem' }}>
        <div className="ent-card-head">
          <h3 className="ent-card-title"><ClipboardList size={16} /> Backups</h3>
          <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleBackupNow} disabled={backingUp}>
            {backingUp ? 'Backing up...' : 'Backup Now'}
          </button>
        </div>
        <p className="ent-hint" style={{ marginBottom: '0.8rem' }}>
          Happens automatically every time the app starts, and once a day while it stays open. The last 14 are kept; older ones are removed automatically.
        </p>
        {backupMessage && <div className={backupMessage.startsWith('Failed') || backupMessage.startsWith('Restore failed') ? 'ent-error-box' : 'ent-success-box'}>{backupMessage}</div>}
        {loading ? <p className="ent-hint">Loading...</p> : backups.length === 0 ? (
          <p className="ent-hint">No backups yet — one will be created automatically the next time the app starts.</p>
        ) : (
          <div className="ent-table-wrap">
            <table className="ent-table">
              <thead><tr><th>When</th><th>Reason</th><th>Size</th><th></th></tr></thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.name}>
                    <td style={{ fontSize: '0.82rem' }}>{fmtTime(b.createdAt)}</td>
                    <td><span className="ent-badge ent-badge--muted">{b.reason}</span></td>
                    <td>{fmtSize(b.sizeBytes)}</td>
                    <td>
                      <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => { setRestoreTarget(b); setRestoreConfirmText(''); setBackupMessage(''); }}>
                        Restore
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {restoreTarget && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => !restoring && setRestoreTarget(null)}>
          <div className="ent-modal" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>Restore This Backup?</h3></div>
            <div className="ent-modal-body">
              <div className="ent-error-box">
                This replaces <strong>everything</strong> currently in the database with the state from {fmtTime(restoreTarget.createdAt)}. Anything entered since then — payments, registrations, edits — will be gone. The app will close immediately after; start it again to see the restored data.
              </div>
              <p style={{ fontSize: '0.85rem', marginBottom: '0.6rem' }}>
                A safety copy of the current data is taken automatically first, so this itself can be undone if you pick the wrong one — but treat this as a real, serious action.
              </p>
              <div className="ent-field">
                <label>Type RESTORE to confirm</label>
                <input value={restoreConfirmText} onChange={(e) => setRestoreConfirmText(e.target.value)} autoFocus />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setRestoreTarget(null)} disabled={restoring}>Cancel</button>
                <button className="ent-btn ent-btn--danger ent-btn--sm" onClick={handleRestore} disabled={restoreConfirmText !== 'RESTORE' || restoring}>
                  {restoring ? 'Restoring...' : 'Restore and Restart'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notifications — where the admin actually reviews and decides on pending
// requests, reachable when they choose to, not forced at login.
// ---------------------------------------------------------------------------
function NotificationsPanel({ user, onCountChange }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState(null);
  const [error, setError] = useState('');

  function load() {
    setLoading(true);
    window.electronAPI.listPendingDeletionRequests(user.section).then((res) => {
      if (res.success) {
        setRequests(res.requests);
        onCountChange(res.requests.length);
      }
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleDecision(studentId, decision) {
    setError('');
    setDecidingId(studentId);
    try {
      const res = await window.electronAPI.decideStudentDeletion({ studentId, decision, decidedBy: user.username });
      if (!res.success) { setError(res.message); return; }
      const next = requests.filter((r) => r.studentId !== studentId);
      setRequests(next);
      onCountChange(next.length);
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><Bell size={16} /> Notifications</h3>
      {error && <div className="ent-error-box">{error}</div>}
      {loading ? (
        <p className="ent-hint">Loading...</p>
      ) : requests.length === 0 ? (
        <p className="ent-hint">Nothing pending right now.</p>
      ) : (
        requests.map((r) => (
          <div key={r.studentId} style={{ border: '1px solid #eef2f6', borderRadius: 'var(--r-md)', padding: '0.9rem', marginBottom: '0.7rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
              <div>
                <strong>{r.firstName} {r.lastName}</strong>
                <div style={{ fontSize: '0.78rem', color: 'var(--c-muted)' }}>{r.studentNumber} \u2022 {r.school}</div>
              </div>
              <span className="ent-badge ent-badge--muted">Deactivation Request</span>
            </div>
            <p style={{ fontSize: '0.85rem', margin: '0.4rem 0' }}><strong>Reason:</strong> {r.deletionReason || '\u2014'}</p>
            <p style={{ fontSize: '0.78rem', color: 'var(--c-muted)', marginBottom: '0.6rem' }}>
              Requested by {r.deletionRequestedBy} on {r.deletionRequestedAt?.slice(0, 10)}
            </p>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="ent-btn ent-btn--danger ent-btn--sm" disabled={decidingId === r.studentId} onClick={() => handleDecision(r.studentId, 'Approved')}>Approve</button>
              <button className="ent-btn ent-btn--secondary ent-btn--sm" disabled={decidingId === r.studentId} onClick={() => handleDecision(r.studentId, 'Rejected')}>Reject</button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit Logs — every secretary action, chronologically, filterable by
// secretary and date range.
// ---------------------------------------------------------------------------
function AuditLogPanel({ user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [secretaryFilter, setSecretaryFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  function load() {
    setLoading(true);
    window.electronAPI.getSecretaryAuditReport({
      school: user.section, secretary: secretaryFilter || undefined,
      startDate: startDate || undefined, endDate: endDate || undefined
    }).then((res) => {
      if (res.success) setEntries(res.entries);
      setLoading(false);
    });
  }

  useEffect(() => { load(); }, [secretaryFilter, startDate, endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="ent-card">
      <h3 className="ent-card-title"><ClipboardList size={16} /> Audit Logs</h3>
      <div style={{ display: 'flex', gap: '0.7rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
        <div className="ent-field" style={{ flex: 1, minWidth: '160px' }}>
          <label>Secretary (username)</label>
          <input value={secretaryFilter} onChange={(e) => setSecretaryFilter(e.target.value)} placeholder="Any" />
        </div>
        <div className="ent-field" style={{ maxWidth: '160px' }}><label>From</label><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
        <div className="ent-field" style={{ maxWidth: '160px' }}><label>To</label><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
      </div>
      <div className="ent-table-wrap">
        <table className="ent-table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={4} className="ent-table-empty">Loading...</td></tr> :
              entries.length === 0 ? <tr><td colSpan={4} className="ent-table-empty">No actions match these filters.</td></tr> :
              entries.map((e, i) => (
                <tr key={i}>
                  <td style={{ fontSize: '0.8rem' }}>{e.timestamp?.slice(0, 19).replace('T', ' ')}</td>
                  <td>{e.actor}</td>
                  <td><span className="ent-badge ent-badge--info">{e.action}</span></td>
                  <td style={{ fontSize: '0.85rem' }}>{e.detail}</td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}