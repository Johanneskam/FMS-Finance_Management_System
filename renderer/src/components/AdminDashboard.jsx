import React, { useState, useEffect } from 'react';
import {
  Menu, Search, Zap, Activity, ListChecks, RefreshCw,
  UserPlus, UserCog, BarChart2, Cog,
  Home, Users, UserCog, GraduationCap, FileText, CreditCard,
  Presentation, Calendar, ClipboardList, Bell, User, Settings, HelpCircle, LogOut,
  DollarSign, TrendingUp, Clock
} from 'lucide-react';
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip
} from 'recharts';
import Sidebar from './Sidebar.jsx';
import SyncPanel from './SyncPanel.jsx';
import Footer from './ui/Footer.jsx';

// ---------------------------------------------------------------------------
// MOCK DATA – replace with real RxDB queries later
// ---------------------------------------------------------------------------
const STATS = {
  financeSecretaries: 4,
  activeStudents: 612,
  monthlyCollection: 811100,   // $811,100
  pendingApprovals: 2,
};

const SYSTEM_STATUS = [
  { label: 'Database', value: 'Connected', ok: true },
  { label: 'Server Uptime', value: '99.8%', ok: true },
  { label: 'Backup Status', value: 'Last: 2 hours ago', ok: true },
  { label: 'Storage Used', value: '78%', ok: true },
  { label: 'Security', value: 'Protected', ok: true },
];

const RECENT_ACTIVITY = [
  { icon: UserPlus, title: 'USER_CREATE', description: "New Finance Secretary account created for L. Iyambo", time: '12 minutes ago' },
  { icon: UserCog, title: 'USER_UPDATE', description: 'Role changed for S. Nakale', time: '1 hour ago' },   // ✅ fixed
  { icon: Cog, title: 'SYSTEM_CONFIG', description: 'Firebase sync folder configured', time: '3 hours ago' },
  { icon: BarChart2, title: 'REPORT_GENERATED', description: 'Monthly collection report generated', time: '1 day ago' },
];

// 7-month collection trend (same as PHP mock data)
const COLLECTION_TREND = [
  { month: 'Jan', total: 85000 }, { month: 'Feb', total: 92000 }, { month: 'Mar', total: 101000 },
  { month: 'Apr', total: 98000 }, { month: 'May', total: 112000 }, { month: 'Jun', total: 124000 },
  { month: 'Jul', total: 118000 }
];

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Dashboard', icon: Home },
  { key: 'secretaries', label: 'Finance Secretaries', icon: UserCog },
  { key: 'users', label: 'User Management', icon: Users },
  { key: 'students', label: 'Students', icon: GraduationCap },
  { key: 'fees', label: 'Fee Structures', icon: FileText },
  { key: 'payments', label: 'Payments', icon: CreditCard },
  { key: 'classes', label: 'Classes & Sections', icon: Presentation },
  { key: 'academic', label: 'Academic Year', icon: Calendar },
  { key: 'reports', label: 'Reports & Analytics', icon: BarChart2 },
  { key: 'audit', label: 'Audit Logs', icon: ClipboardList },
  { key: 'notifications', label: 'Notifications', icon: Bell, badge: 3 },
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'settings', label: 'Settings', icon: Settings },
  { key: 'help', label: 'Help', icon: HelpCircle },
  { key: 'logout', label: 'Logout', icon: LogOut }
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------
function money(n) {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function initials(name) {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] || '').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

// ---------------------------------------------------------------------------
// STYLES (injected via <style>)
// ---------------------------------------------------------------------------
const css = `
.admin-page { min-height: 100vh; background: linear-gradient(135deg, #06b6d4, #f59e0b); position: relative; overflow-x: hidden; font-family: 'Inter', system-ui, sans-serif; }
.admin-page * { box-sizing: border-box; }

/* Background shapes */
.admin-bg-shapes { position: fixed; inset: 0; overflow: hidden; z-index: 0; pointer-events: none; }
.admin-shape { position: absolute; border-radius: 50%; background: rgba(255,255,255,0.15); animation: admin-float 15s infinite linear; }
.admin-shape-1 { width: 300px; height: 300px; top: -150px; right: -150px; }
.admin-shape-2 { width: 240px; height: 240px; bottom: -120px; left: -120px; animation-delay: -5s; }
.admin-shape-3 { width: 170px; height: 170px; top: 45%; right: 12%; animation-delay: -10s; }
@keyframes admin-float { 0%,100% { transform: translateY(0) rotate(0deg); } 33% { transform: translateY(-18px) rotate(120deg); } 66% { transform: translateY(9px) rotate(240deg); } }

/* Header */
.admin-header {
  position: relative; z-index: 10; display: flex; align-items: center; justify-content: space-between;
  padding: 12px 24px; background: rgba(255,255,255,0.92); backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(255,255,255,0.4);
  box-shadow: 0 2px 16px rgba(0,0,0,0.04);
}
.admin-header-left { display: flex; align-items: center; gap: 16px; }
.admin-menu-toggle {
  border: none; background: rgba(6,182,212,0.08); color: #06b6d4; width: 40px; height: 40px;
  border-radius: 12px; display: flex; align-items: center; justify-content: center; cursor: pointer;
  transition: background 0.2s;
}
.admin-menu-toggle:hover { background: rgba(6,182,212,0.15); }
.admin-logo-text { font-weight: 800; color: #1a202c; font-size: 1.05rem; letter-spacing: -0.3px; }
.admin-header-right { display: flex; align-items: center; gap: 18px; }
.admin-search {
  display: flex; align-items: center; gap: 8px; background: #fff; border-radius: 999px;
  padding: 6px 14px 6px 16px; border: 1px solid #e5e7eb; transition: box-shadow 0.2s;
}
.admin-search:focus-within { box-shadow: 0 0 0 3px rgba(6,182,212,0.2); border-color: #06b6d4; }
.admin-search input { border: none; outline: none; font-size: 0.82rem; width: 200px; background: transparent; }
.admin-search svg { color: #9ca3af; flex-shrink: 0; }

.admin-user { display: flex; align-items: center; gap: 10px; cursor: default; position: relative; }
.admin-avatar {
  width: 38px; height: 38px; border-radius: 50%; background: linear-gradient(135deg, #06b6d4, #f59e0b);
  color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.85rem;
  box-shadow: 0 2px 8px rgba(6,182,212,0.25);
}
.admin-user-info h4 { margin: 0; font-size: 0.85rem; color: #1a202c; font-weight: 600; }
.admin-user-info p { margin: 0; font-size: 0.72rem; color: #6b7280; }

.admin-sync-indicator { display: flex; align-items: center; gap: 6px; font-size: 0.7rem; color: #10b981; }
.admin-sync-indicator .dot { width: 7px; height: 7px; border-radius: 50%; background: #10b981; display: inline-block; }
.admin-sync-indicator.offline .dot { background: #f59e0b; }
.admin-sync-indicator.offline { color: #f59e0b; }

/* Main content */
.admin-main { position: relative; z-index: 5; padding: 28px; max-width: 1200px; margin: 0 auto; }

/* Welcome strip */
.admin-welcome {
  background: rgba(255,255,255,0.95); border-radius: 1.25rem; padding: 1.8rem 2rem; margin-bottom: 1.5rem;
  box-shadow: 0 10px 30px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.3);
}
.admin-welcome h1 { margin: 0 0 0.2rem; font-size: 1.6rem; color: #1a202c; font-weight: 700; }
.admin-welcome h1 span { background: linear-gradient(135deg, #06b6d4, #f59e0b); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
.admin-welcome p { margin: 0 0 1.5rem; color: #6b7280; font-size: 0.88rem; }
.admin-quick-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 1.2rem;
}
@media (max-width: 800px) { .admin-quick-stats { grid-template-columns: repeat(2, 1fr); } }
.admin-stat-item {
  background: rgba(255,255,255,0.5); padding: 0.8rem 1rem; border-radius: 0.9rem;
  border: 1px solid rgba(6,182,212,0.08); transition: transform 0.2s;
}
.admin-stat-item:hover { transform: translateY(-3px); }
.admin-stat-number { font-size: 1.6rem; font-weight: 800; color: #06b6d4; line-height: 1.2; }
.admin-stat-label { font-size: 0.72rem; color: #6b7280; margin-top: 0.1rem; font-weight: 500; }

/* Grid cards */
.admin-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.25rem; margin-bottom: 1.25rem; }
@media (max-width: 900px) { .admin-grid { grid-template-columns: 1fr; } }

.admin-card {
  background: rgba(255,255,255,0.95); border-radius: 1.25rem; padding: 1.4rem 1.5rem;
  box-shadow: 0 10px 30px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.3);
  transition: transform 0.25s, box-shadow 0.25s;
}
.admin-card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px rgba(0,0,0,0.08); }
.admin-card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.1rem; }
.admin-card-title { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; font-weight: 700; color: #1a202c; margin: 0; }
.admin-card-title svg { color: #06b6d4; }
.admin-card-action {
  border: none; background: rgba(6,182,212,0.08); color: #06b6d4; font-size: 0.72rem; font-weight: 600;
  padding: 5px 12px; border-radius: 8px; cursor: pointer; display: flex; align-items: center; gap: 5px;
  transition: background 0.2s;
}
.admin-card-action:hover { background: rgba(6,182,212,0.18); }

/* Quick Actions */
.admin-quick-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
.admin-action-item {
  display: flex; flex-direction: column; align-items: center; gap: 0.4rem; padding: 1rem 0.5rem;
  border-radius: 0.9rem; background: #f7fafc; border: 1px solid #eef2f6; cursor: pointer;
  text-align: center; transition: background 0.2s, transform 0.2s;
}
.admin-action-item:hover { background: rgba(6,182,212,0.06); transform: scale(1.02); }
.admin-action-icon {
  width: 40px; height: 40px; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #06b6d4, #0e7490); color: #fff;
}
.admin-action-label { font-size: 0.72rem; font-weight: 600; color: #374151; }

/* System Status */
.admin-status-item {
  display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0;
  border-bottom: 1px solid #f3f4f6; font-size: 0.82rem;
}
.admin-status-item:last-child { border-bottom: none; }
.admin-status-label { display: flex; align-items: center; gap: 8px; color: #4b5563; }
.admin-status-dot {
  width: 8px; height: 8px; border-radius: 50%; display: inline-block;
}
.admin-status-dot.ok { background: #10b981; }
.admin-status-dot.warn { background: #f59e0b; }
.admin-status-value { font-weight: 600; color: #1a202c; }

/* Recent Activity */
.admin-activity-item {
  display: flex; gap: 0.75rem; padding: 0.65rem 0; border-bottom: 1px solid #f3f4f6;
}
.admin-activity-item:last-child { border-bottom: none; }
.admin-activity-icon {
  width: 34px; height: 34px; border-radius: 9px; background: rgba(6,182,212,0.08); color: #06b6d4;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.admin-activity-title { font-size: 0.78rem; font-weight: 700; color: #1a202c; }
.admin-activity-desc { font-size: 0.76rem; color: #6b7280; margin-top: 0.1rem; }
.admin-activity-time { font-size: 0.68rem; color: #a1a1aa; margin-top: 0.2rem; }

/* Chart card */
.admin-chart-card {
  background: rgba(255,255,255,0.95); border-radius: 1.25rem; padding: 1.4rem 1.5rem;
  box-shadow: 0 10px 30px rgba(0,0,0,0.06); border: 1px solid rgba(255,255,255,0.3);
  margin-top: 1.25rem;
}
.admin-chart-header {
  display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;
}
.admin-chart-title { display: flex; align-items: center; gap: 8px; font-size: 0.95rem; font-weight: 700; color: #1a202c; margin: 0; }
.admin-chart-title svg { color: #06b6d4; }
.admin-range-toggle { display: flex; gap: 6px; }
.admin-range-btn {
  border: none; background: #f3f4f6; color: #6b7280; font-size: 0.72rem; font-weight: 600;
  padding: 5px 12px; border-radius: 8px; cursor: pointer; transition: all 0.2s;
}
.admin-range-btn.active { background: linear-gradient(135deg, #06b6d4, #0e7490); color: #fff; }

/* Footer */
.admin-footer {
  background: linear-gradient(135deg, #06b6d4, #f59e0b);
  color: #fff; padding: 40px 30px 20px; margin-top: 30px;
  border-top: 1px solid rgba(255,255,255,0.15);
}
.admin-footer-grid {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 30px; max-width: 1200px; margin: 0 auto;
}
@media (max-width: 800px) { .admin-footer-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 500px) { .admin-footer-grid { grid-template-columns: 1fr; } }
.admin-footer-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
.admin-footer-logo img { height: 45px; border-radius: 8px; }
.admin-footer-logo-text { font-size: 1.2rem; font-weight: 800; }
.admin-footer-links h4 { font-size: 1rem; margin-bottom: 14px; color: #ffd700; font-weight: 700; }
.admin-footer-links ul { list-style: none; padding: 0; margin: 0; }
.admin-footer-links li { margin-bottom: 8px; }
.admin-footer-links a { color: rgba(255,255,255,0.85); text-decoration: none; transition: color 0.2s; font-weight: 500; }
.admin-footer-links a:hover { color: #fff; padding-left: 4px; border-left: 2px solid #ffd700; }
.admin-footer-contact .contact-item { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.admin-footer-contact .contact-item svg { color: #ffd700; width: 18px; }
.admin-footer-bottom {
  text-align: center; padding-top: 25px; margin-top: 25px;
  border-top: 1px solid rgba(255,255,255,0.15); color: rgba(255,255,255,0.85); font-size: 0.8rem;
}

.admin-mock-flag {
  font-size: 0.62rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.05em;
  border: 1px dashed #d1d5db; border-radius: 0.4rem; padding: 0.1rem 0.45rem; margin-left: 0.5rem; vertical-align: middle;
}
`;

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------
export default function AdminDashboard({ user, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeView, setActiveView] = useState('dashboard');
  const [range, setRange] = useState('Monthly');
  const [syncStatus, setSyncStatus] = useState('online');

  // Simulate sync status (replace with real listener)
  useEffect(() => {
    const interval = setInterval(() => {
      setSyncStatus(prev => prev === 'online' ? 'offline' : 'online');
    }, 10000);
    return () => clearInterval(interval);
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
  const logoPath = '../assets/logo.png';

  return (
    <div className="admin-page">
      <style>{css}</style>

      <div className="admin-bg-shapes">
        <div className="admin-shape admin-shape-1" />
        <div className="admin-shape admin-shape-2" />
        <div className="admin-shape admin-shape-3" />
      </div>

      <header className="admin-header">
        <div className="admin-header-left">
          <button className="admin-menu-toggle" onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu size={19} />
          </button>
          <span className="admin-logo-text">Admin Portal</span>
        </div>
        <div className="admin-header-right">
          <div className="admin-search">
            <Search size={15} />
            <input type="text" placeholder="Search users, logs, reports..." />
          </div>
          <div className={`admin-sync-indicator ${syncStatus === 'online' ? '' : 'offline'}`}>
            <span className="dot"></span>
            {syncStatus === 'online' ? 'Online' : 'Offline'}
          </div>
          <div className="admin-user">
            <div className="admin-avatar">{initials(user.username)}</div>
            <div className="admin-user-info">
              <h4>{user.username}</h4>
              <p>{user.role}</p>
            </div>
          </div>
        </div>
      </header>

      <Sidebar
        title="Wendy Private School"
        subtitle="Admin Portal"
        items={NAV_ITEMS}
        activeKey={activeView}
        onNavigate={handleNavigate}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="admin-main">
        {activeView !== 'dashboard' ? (
          <div className="admin-card">
            <h3 className="admin-card-title">{activeLabel}</h3>
            {activeView === 'settings' ? (
              <SyncPanel />
            ) : (
              <p style={{ color: '#6b7280', fontSize: '0.85rem', marginTop: '0.75rem' }}>
                This section will be built with live data in the next iteration.
              </p>
            )}
          </div>
        ) : (
          <>
            {/* Welcome Strip */}
            <div className="admin-welcome">
              <h1>
                Welcome, <span>{user.username}</span>!
              </h1>
              <p>
                Last login: {new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                <span className="admin-mock-flag">Mock data</span>
              </p>
              <div className="admin-quick-stats">
                <div className="admin-stat-item">
                  <div className="admin-stat-number">{STATS.financeSecretaries}</div>
                  <div className="admin-stat-label">Finance Secretaries</div>
                </div>
                <div className="admin-stat-item">
                  <div className="admin-stat-number">{STATS.activeStudents}</div>
                  <div className="admin-stat-label">Active Students</div>
                </div>
                <div className="admin-stat-item">
                  <div className="admin-stat-number">{money(STATS.monthlyCollection)}</div>
                  <div className="admin-stat-label">Monthly Collection</div>
                </div>
                <div className="admin-stat-item">
                  <div className="admin-stat-number">{STATS.pendingApprovals}</div>
                  <div className="admin-stat-label">Pending Approvals</div>
                </div>
              </div>
            </div>

            {/* Grid Row 1 */}
            <div className="admin-grid">
              {/* Quick Actions */}
              <div className="admin-card">
                <div className="admin-card-header">
                  <h3 className="admin-card-title"><Zap size={17} /> Quick Actions</h3>
                </div>
                <div className="admin-quick-actions">
                  <div className="admin-action-item" onClick={() => handleNavigate('secretaries')}>
                    <div className="admin-action-icon"><UserPlus size={18} /></div>
                    <div className="admin-action-label">Add Secretary</div>
                  </div>
                  <div className="admin-action-item" onClick={() => handleNavigate('users')}>
                    <div className="admin-action-icon"><UserCog size={18} /></div>   {/* ✅ fixed */}
                    <div className="admin-action-label">Manage Users</div>
                  </div>
                  <div className="admin-action-item" onClick={() => handleNavigate('reports')}>
                    <div className="admin-action-icon"><BarChart2 size={18} /></div>
                    <div className="admin-action-label">Generate Reports</div>
                  </div>
                  <div className="admin-action-item" onClick={() => handleNavigate('settings')}>
                    <div className="admin-action-icon"><Cog size={18} /></div>
                    <div className="admin-action-label">System Config</div>
                  </div>
                </div>
              </div>

              {/* System Status */}
              <div className="admin-card">
                <div className="admin-card-header">
                  <h3 className="admin-card-title"><Activity size={17} /> System Status</h3>
                  <button className="admin-card-action"><RefreshCw size={12} /> Refresh</button>
                </div>
                {SYSTEM_STATUS.map((s) => (
                  <div className="admin-status-item" key={s.label}>
                    <span className="admin-status-label">
                      <span className={`admin-status-dot ${s.ok ? 'ok' : 'warn'}`} />
                      {s.label}
                    </span>
                    <span className="admin-status-value">{s.value}</span>
                  </div>
                ))}
              </div>

              {/* Recent Activity */}
              <div className="admin-card">
                <div className="admin-card-header">
                  <h3 className="admin-card-title"><ListChecks size={17} /> Recent Activity</h3>
                  <button className="admin-card-action">View All</button>
                </div>
                {RECENT_ACTIVITY.map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <div className="admin-activity-item" key={i}>
                      <div className="admin-activity-icon"><Icon size={15} /></div>
                      <div>
                        <div className="admin-activity-title">{a.title}</div>
                        <div className="admin-activity-desc">{a.description}</div>
                        <div className="admin-activity-time">{a.time}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Chart Card */}
            <div className="admin-chart-card">
              <div className="admin-chart-header">
                <h3 className="admin-chart-title">
                  <BarChart2 size={17} /> Fee Collection Trends
                </h3>
                <div className="admin-range-toggle">
                  {['Monthly', 'Quarterly', 'Yearly'].map((r) => (
                    <button
                      key={r}
                      className={`admin-range-btn ${range === r ? 'active' : ''}`}
                      onClick={() => setRange(r)}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={COLLECTION_TREND}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} />
                    <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} axisLine={{ stroke: '#e5e7eb' }} tickFormatter={(v) => `$${v/1000}k`} />
                    <Tooltip formatter={(v) => money(v)} />
                    <Line type="monotone" dataKey="total" stroke="#06b6d4" strokeWidth={2.5} dot={{ fill: '#f59e0b', r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="admin-footer">
        <div className="admin-footer-grid">
          <div>
            <div className="admin-footer-logo">
              <img src={logoPath} alt="Wendy Private School" />
              <div className="admin-footer-logo-text">Wendy Private School</div>
            </div>
            <p style={{ marginBottom: '1rem', opacity: 0.9 }}>Providing quality education since 1985.</p>
            <div style={{ display: 'flex', gap: '12px' }}>
              <a href="#" style={{ color: '#fff', opacity: 0.8 }}><i className="fab fa-facebook-f"></i></a>
              <a href="#" style={{ color: '#fff', opacity: 0.8 }}><i className="fab fa-twitter"></i></a>
              <a href="#" style={{ color: '#fff', opacity: 0.8 }}><i className="fab fa-instagram"></i></a>
              <a href="#" style={{ color: '#fff', opacity: 0.8 }}><i className="fab fa-linkedin-in"></i></a>
            </div>
          </div>

          <div className="admin-footer-links">
            <h4>Quick Links</h4>
            <ul>
              <li><a href="#">Dashboard</a></li>
              <li><a href="#">Students</a></li>
              <li><a href="#">Reports</a></li>
              <li><a href="#">Help</a></li>
              <li><a href="#">Contact</a></li>
            </ul>
          </div>

          <div className="admin-footer-links">
            <h4>Resources</h4>
            <ul>
              <li><a href="#">Documentation</a></li>
              <li><a href="#">Tutorials</a></li>
              <li><a href="#">FAQ</a></li>
              <li><a href="#">Support</a></li>
              <li><a href="#">Updates</a></li>
            </ul>
          </div>

          <div className="admin-footer-contact">
            <h4>Contact Info</h4>
            <div className="contact-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              <span>Onesi, Oshana region, P.O BOX 2958 Ondangwa</span>
            </div>
            <div className="contact-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
              <span>+1 (555) 123-4567</span>
            </div>
            <div className="contact-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
              <span>info@wendyprivateschool.com</span>
            </div>
            <div className="contact-item">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <span>Mon - Fri: 8:00 AM - 5:00 PM</span>
            </div>
          </div>
        </div>
        <div className="admin-footer-bottom">
          &copy; 2025 Wendy Private School. All rights reserved. | Designed by J & L Technologies
        </div>
      </footer>
    </div>
  );
}