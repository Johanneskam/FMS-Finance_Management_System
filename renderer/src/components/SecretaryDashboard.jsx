import React, { useEffect, useState } from 'react';
import {
  Menu, Search, Zap, ListChecks, Send, UserPlus,
  BarChart2, Home, User, HelpCircle, LogOut, AlertTriangle, Banknote,
  Wallet, Receipt, AlertCircle, Award, Calendar, History, Trophy,
  GraduationCap,   // <-- NEW import
  RefreshCw
} from 'lucide-react';
import Sidebar from './Sidebar.jsx';
import FinancialCommunication from './FinancialCommunication.jsx';
import Reports from './Reports.jsx';
import AllPayments from './AllPayments.jsx';
import Profile from './Profile.jsx';
import ProcessPayment from './ProcessPayment.jsx';
import StudentHub from './StudentHub.jsx';   // <-- NEW import
import HelpPage from './HelpPage.jsx';
import DonutRing from './ui/DonutRing.jsx';
import Footer from './ui/Footer.jsx';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: Home, section: 'MENU' },
  { key: 'students', label: 'Students Hub', icon: GraduationCap },   // <-- NEW
  { key: 'process_payment', label: 'Process Payment', icon: Banknote },
  { key: 'financial_communication', label: 'Financial Communication', icon: Send },
  { key: 'reports', label: 'Reports & Analytics', icon: BarChart2 },
  { key: 'all_payments', label: 'All Payments', icon: ListChecks },
  { key: 'profile', label: 'Profile', icon: User, section: 'GENERAL' },
  { key: 'help', label: 'Help', icon: HelpCircle },
  { key: 'logout', label: 'Logout', icon: LogOut }
];

const SCHOOL_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy', Both: 'Both Schools' };
const SCHOOL_CODE = { WENDY: 'WENDY', KEILA: 'KEILA', Both: 'WPS' };

function money(n) {
  return 'N$ ' + (n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initials(firstName, lastName, username) {
  const a = (firstName || '')[0] || '';
  const b = (lastName || '')[0] || '';
  return (a + b).toUpperCase() || (username || '?')[0].toUpperCase();
}

function daysInMonth(year, monthIndex0) {
  return new Date(year, monthIndex0 + 1, 0).getDate();
}

export default function SecretaryDashboard({ user, onLogout, onProfileUpdated }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [lastSyncNote, setLastSyncNote] = useState('');

  function loadDashboardData() {
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    window.electronAPI.getSecretaryDashboardData(user.section)
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setData(result.data);
        } else {
          setLoadError(result.message || 'Could not load dashboard data.');
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err?.message || 'Could not reach the local application service.');
        setLoading(false);
      });
    return () => { cancelled = true; };
  }

  useEffect(() => {
    return loadDashboardData();
  }, [user.section]);

  // Background sync (every 5 minutes, or whenever another station pushes
  // changes) used to only show up here after a full app restart, since
  // the data above was only ever fetched once on mount. Now: whenever a
  // sync cycle actually pulls something new, silently refresh what's on
  // screen — no restart, no manual reload needed.
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
      // onSyncCompleted above handles the actual data refresh if
      // anything new came in; this just resets the button's own state.
    } finally {
      setSyncing(false);
    }
  }

  function handleNavigate(key) {
    if (key === 'logout') { onLogout(); return; }
    setActiveView(key);
    setSidebarOpen(false);
  }

  const activeLabel = NAV_ITEMS.find((i) => i.key === activeView)?.label || 'Dashboard';
  const schoolLabel = SCHOOL_LABEL[user.section] || user.section;
  const schoolCode = SCHOOL_CODE[user.section] || user.section;
  const now = new Date();

  const totalDays = daysInMonth(now.getFullYear(), now.getMonth());
  const monthProgressPct = Math.round((now.getDate() / totalDays) * 100);
  const todaysSharePct = data && data.monthlyTotal > 0 ? Math.round((data.todayTotal / data.monthlyTotal) * 100) : 0;

  let momChangePct = null;
  if (data?.trend?.length >= 2) {
    const thisM = data.trend[data.trend.length - 1].total;
    const lastM = data.trend[data.trend.length - 2].total;
    if (lastM > 0) momChangePct = Math.round(((thisM - lastM) / lastM) * 100);
  }
  const pacePct = momChangePct === null ? 100 : 100 + momChangePct;

  let bestMonth = null;
  if (data?.trend?.length) {
    bestMonth = data.trend.reduce((best, m) => (m.total > (best?.total ?? -1) ? m : best), null);
  }
  const thisMonthTrend = data?.trend?.length ? data.trend[data.trend.length - 1] : null;
  const lastMonthTrend = data?.trend?.length >= 2 ? data.trend[data.trend.length - 2] : null;

  return (
    <div className="ent-shell">
      <div className="ent-bg-shapes">
        <div className="ent-shape ent-shape-1" />
        <div className="ent-shape ent-shape-2" />
        <div className="ent-shape ent-shape-3" />
      </div>

      <Sidebar
        title="WPS"
        subtitle="Secretary Portal"
        items={NAV_ITEMS}
        activeKey={activeView}
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="ent-app-content">
        <header className="mp-header">
          <div className="mp-header-left">
            <button className="ent-menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
            <div className="mp-logo">
              <div className="mp-logo-text">Secretary Portal</div>
            </div>
          </div>
          <div className="mp-header-right">
            <div className="mp-search-box">
              <Search size={14} />
              <input type="text" className="mp-search-input" placeholder="Search users, logs, reports..." />
            </div>
            <button
              className="ent-btn ent-btn--secondary ent-btn--sm"
              onClick={handleSyncNowClick}
              disabled={syncing}
              title="Pull in any changes made on other stations right now"
              style={{ flexShrink: 0 }}
            >
              <RefreshCw size={14} className={syncing ? 'ent-spin' : ''} /> {syncing ? 'Syncing...' : 'Sync Now'}
            </button>
            <div className="mp-user-profile">
              {user.avatarDataUrl ? (
                <img src={user.avatarDataUrl} alt="" className="mp-avatar" style={{ objectFit: 'cover' }} />
              ) : (
                <div className="mp-avatar">{initials(user.firstName, user.lastName, user.username)}</div>
              )}
              <div className="mp-user-info">
                <h4>{user.username}</h4>
                <p>{schoolLabel} &mdash; {activeLabel}</p>
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
          {activeView === 'students' ? (   // <-- NEW render condition
            <StudentHub user={user} />
          ) : activeView === 'financial_communication' ? (
            <FinancialCommunication user={user} />
          ) : activeView === 'reports' ? (
            <Reports user={user} />
          ) : activeView === 'all_payments' ? (
            <AllPayments user={user} />
          ) : activeView === 'process_payment' ? (
            <ProcessPayment user={user} />
          ) : activeView === 'profile' ? (
            <Profile user={user} onProfileUpdated={onProfileUpdated} />
          ) : activeView === 'help' ? (
            <HelpPage user={user} />
          ) : activeView !== 'dashboard' ? (
            <div className="ent-card ent-empty">
              <h3 style={{ color: '#1e293b', marginBottom: '0.4rem' }}>{activeLabel}</h3>
              <p>This screen isn't built yet — it's a substantial feature on its own (cart billing, student search, etc. per the ledger spec) and arrives in a future step.</p>
            </div>
          ) : loadError ? (
            <div className="ent-card ent-empty" style={{ borderLeft: '3px solid #dc2626' }}>
              <h3 style={{ color: '#dc2626', marginBottom: '0.4rem' }}>Couldn't Load Dashboard Data</h3>
              <p>{loadError}</p>
              <p style={{ fontSize: '0.78rem', marginTop: '0.6rem' }}>
                If this keeps happening, the local database may need to be reset — close the app, delete the
                <code style={{ margin: '0 4px' }}>Fee Management System</code> folder under your AppData\Roaming
                directory, then reopen the app.
              </p>
            </div>
          ) : loading || !data ? (
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.85rem', marginBottom: '1.5rem', textShadow: '0 1px 4px rgba(0,0,0,0.05)' }}>Loading&hellip;</p>
          ) : (
            <>
              <div className="mp-stat-row">
                <div className="mp-stat-card mp-stat-card--dark">
                  <div className="mp-stat-icon"><Wallet size={20} /></div>
                  <div>
                    <div className="mp-stat-label">Monthly Collection</div>
                    <div className="mp-stat-value">{money(data.monthlyTotal)}</div>
                  </div>
                </div>
                <div className="mp-stat-card">
                  <div className="mp-stat-icon"><Receipt size={20} /></div>
                  <div>
                    <div className="mp-stat-label">Today's Collection</div>
                    <div className="mp-stat-value">{money(data.todayTotal)}</div>
                  </div>
                </div>
                <div className="mp-stat-card">
                  <div className="mp-stat-icon"><ListChecks size={20} /></div>
                  <div>
                    <div className="mp-stat-label">Today's Payments</div>
                    <div className="mp-stat-value">{data.todayCount}</div>
                  </div>
                </div>
                <div className="mp-stat-card">
                  <div className="mp-stat-icon"><AlertCircle size={20} /></div>
                  <div>
                    <div className="mp-stat-label">Pending Balances</div>
                    <div className="mp-stat-value">{data.pendingBalancesCount}</div>
                  </div>
                </div>
                <div className="mp-stat-card">
                  <div className="mp-stat-icon"><Award size={20} /></div>
                  <div>
                    <div className="mp-stat-label">Year-to-Date</div>
                    <div className="mp-stat-value">{money(data.yearlyTotal)}</div>
                  </div>
                </div>
              </div>

              <div className="mp-row2">
                <div className="mp-panel">
                  <div className="mp-panel-title">Collection Account</div>
                  <div className="mp-card-visual">
                    <div className="mp-card-top">
                      <div>
                        <div className="mp-card-brand">Fee Management</div>
                        <div className="mp-card-kind">COLLECTION ACCOUNT</div>
                      </div>
                      <span className="mp-card-icon"><Banknote size={22} /></span>
                    </div>
                    <div className="mp-card-number">
                      {schoolCode} &nbsp;&bull;&nbsp; {now.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
                    </div>
                    <div className="mp-card-foot">
                      <div>
                        <div className="mp-card-foot-label">Processed by</div>
                        <div className="mp-card-foot-value">{user.username}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div className="mp-card-foot-label">Today</div>
                        <div className="mp-card-foot-value">{money(data.todayTotal)}</div>
                      </div>
                    </div>
                  </div>
                  <div className="mp-progress-row">
                    <div className="mp-progress-label">
                      <span>Month progress</span>
                      <span className="mp-progress-sub">Day {now.getDate()} / {totalDays}</span>
                    </div>
                    <div className="mp-progress-track">
                      <div className="mp-progress-fill" style={{ width: `${monthProgressPct}%` }} />
                    </div>
                  </div>
                </div>

                <div className="ent-card">
                  <div className="ent-card-head">
                    <h3 className="ent-card-title"><ListChecks size={16} /> Transaction History</h3>
                    <button className="ent-btn ent-btn--ghost ent-btn--pill ent-btn--sm" onClick={() => handleNavigate('all_payments')}>View All</button>
                  </div>
                  <div className="mp-table-wrap">
                    <table className="mp-table">
                      <thead><tr><th>Receiver</th><th>Method</th><th>Date</th><th>Amount</th></tr></thead>
                      <tbody>
                        {data.recentPayments.length === 0 ? (
                          <tr><td colSpan={4} className="mp-table-empty">No recent payments — activity will appear here.</td></tr>
                        ) : data.recentPayments.map((p) => (
                          <tr key={p.paymentId}>
                            <td className="mp-table-name">{p.studentName}</td>
                            <td className="mp-table-muted">{p.paymentMethod}</td>
                            <td className="mp-table-muted">{p.paymentDate}</td>
                            <td className="mp-table-amount">{money(p.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.2rem', marginBottom: '1.2rem' }}>
                <div className="mp-combined-card">
                  <div className="mp-combined-section">
                    <h3 className="ent-card-title">Collection Trend</h3>
                    <div className="mp-tiles">
                      <div className="mp-tile">
                        <span className="mp-tile-icon"><Calendar size={18} /></span>
                        <div className="mp-tile-amount">{thisMonthTrend ? money(thisMonthTrend.total) : '—'}</div>
                        <div className="mp-tile-date">{thisMonthTrend?.month || ''}</div>
                        <div className="mp-tile-label">This Month</div>
                      </div>
                      <div className="mp-tile">
                        <span className="mp-tile-icon"><History size={18} /></span>
                        <div className="mp-tile-amount">{lastMonthTrend ? money(lastMonthTrend.total) : '—'}</div>
                        <div className="mp-tile-date">{lastMonthTrend?.month || ''}</div>
                        <div className="mp-tile-label">Last Month</div>
                      </div>
                      <div className="mp-tile">
                        <span className="mp-tile-icon"><Trophy size={18} /></span>
                        <div className="mp-tile-amount">{bestMonth ? money(bestMonth.total) : '—'}</div>
                        <div className="mp-tile-date">{bestMonth?.month || ''}</div>
                        <div className="mp-tile-label">Best Month</div>
                      </div>
                    </div>
                  </div>
                  <div className="mp-separator" />
                  <div className="mp-combined-section">
                    <h3 className="ent-card-title">Outcome Statistics</h3>
                    <div className="mp-donut-row">
                      <DonutRing percent={monthProgressPct} label="Month Progress" color="#20A4B6" size={104} stroke={7} />
                      <DonutRing percent={todaysSharePct} label="Today's Share" color="#61BECB" size={104} stroke={7} />
                      <DonutRing percent={pacePct === null ? 100 : Math.min(100, pacePct)} label="Pace vs Last Month" color={pacePct === null || pacePct >= 100 ? '#2f9e6f' : '#089AAE'} size={104} stroke={7} />
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.3fr', gap: '1.2rem' }}>
                <div className="ent-card">
                  <h3 className="ent-card-title"><Zap size={16} /> Quick Actions</h3>
                  <div className="ent-quick-actions">
                    <button className="ent-action-item" onClick={() => handleNavigate('process_payment')}>
                      <div className="ent-action-icon"><Banknote size={16} /></div>
                      <div className="ent-action-label">Process Payment</div>
                    </button>
                    <button className="ent-action-item" onClick={() => handleNavigate('financial_communication')}>
                      <div className="ent-action-icon"><Send size={16} /></div>
                      <div className="ent-action-label">Financial Comms</div>
                    </button>
                    <button className="ent-action-item" onClick={() => handleNavigate('reports')}>
                      <div className="ent-action-icon"><BarChart2 size={16} /></div>
                      <div className="ent-action-label">Reports</div>
                    </button>
                    <button className="ent-action-item" onClick={() => handleNavigate('students')}>
                      <div className="ent-action-icon"><UserPlus size={16} /></div>
                      <div className="ent-action-label">Register Student</div>
                    </button>
                  </div>
                </div>

                <div className="ent-card">
                  <div className="ent-card-head">
                    <h3 className="ent-card-title"><AlertTriangle size={16} /> High Alert Students (Top Debtors)</h3>
                  </div>
                  <div className="ent-table-wrap">
                    <table className="ent-table">
                      <thead><tr><th>Student</th><th>Days</th><th>Owed</th><th></th></tr></thead>
                      <tbody>
                        {data.highAlert.length === 0 ? (
                          <tr><td colSpan={4} className="ent-table-empty">No students with outstanding balances.</td></tr>
                        ) : data.highAlert.map((s) => (
                          <tr key={s.studentId}>
                            <td>
                              <div style={{ fontWeight: 600 }}>{s.name}</div>
                              <div className="ent-td-mono">{s.studentNumber}</div>
                            </td>
                            <td style={{ color: s.maxAgeDays > 90 ? '#dc2626' : '#64748b', fontWeight: 700 }}>{s.maxAgeDays}d</td>
                            <td className="ent-td-num" style={{ color: '#dc2626' }}>{money(s.balance)}</td>
                            <td>
                              <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={() => handleNavigate('process_payment')}>Quick Pay</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}
        </main>

        <Footer />
      </div>
    </div>
  );
}