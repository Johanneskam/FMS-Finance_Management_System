import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { UserPlus, UserCheck, UserX, Download, Edit2, KeyRound, QrCode, X, Users as UsersIcon, ShieldCheck, Search } from 'lucide-react';
import QRCredentialCard from './QRCredentialCard.jsx';
import Toggle from './ui/Toggle.jsx';
import Pagination from './ui/Pagination.jsx';
import ConfirmDialog from './ui/ConfirmDialog.jsx';

const ROLE_BADGE_COLOR = { Superadmin: '#7c3aed', Admin: '#2563eb', Secretary: '#0891b2' };
const SECTION_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy', Both: 'Both Schools' };
const PAGE_SIZE = 8;

function initials(firstName, lastName, username) {
  const a = (firstName || '')[0] || '';
  const b = (lastName || '')[0] || '';
  return (a + b).toUpperCase() || (username || '?')[0].toUpperCase();
}

function formatDateTime(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function csvEscape(v) {
  return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
}

export default function UserManagement({ user }) {
  const isSuperadmin = user.role === 'Superadmin';

  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modalMode, setModalMode] = useState(null);
  const [form, setForm] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const [tempPasswordNotice, setTempPasswordNotice] = useState(null);
  const [qrCardData, setQrCardData] = useState(null);
  const [qrLoadingFor, setQrLoadingFor] = useState(null);
  const [alertInfo, setAlertInfo] = useState(null); // { title, message } | null — replaces alert()

  const load = useCallback(async () => {
    setLoading(true);
    const result = await window.electronAPI.listUsers(user.role);
    if (result.success) setUsers(result.users);
    setLoading(false);
  }, [user.role]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filter, search]);

  const stats = useMemo(() => ({
    total: users.length,
    active: users.filter((u) => u.isActive).length,
    inactive: users.filter((u) => !u.isActive).length,
    roles: new Set(users.map((u) => u.role)).size
  }), [users]);

  const roleDistribution = useMemo(() => {
    const counts = users.reduce((acc, u) => {
      if (u.isActive) acc[u.role] = (acc[u.role] || 0) + 1;
      return acc;
    }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === 'active' && !u.isActive) return false;
      if (filter === 'inactive' && u.isActive) return false;
      if (!q) return true;
      return (
        `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        u.username.toLowerCase().includes(q) ||
        u.role.toLowerCase().includes(q)
      );
    });
  }, [users, filter, search]);

  const paged = useMemo(
    () => filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filtered, page]
  );

  function openCreate() {
    setForm({
      username: '', firstName: '', lastName: '', email: '', phone: '',
      role: isSuperadmin ? '' : 'Secretary',
      section: isSuperadmin ? '' : (user.section === 'Both' ? '' : user.section),
      isActive: true
    });
    setFormError('');
    setModalMode('create');
  }

  function openEdit(u) {
    if (!isSuperadmin && u.role !== 'Secretary') {
      setAlertInfo({ title: 'Cannot Edit This User', message: 'As an Admin, you can only edit Secretary accounts.' });
      return;
    }
    setForm({ ...u });
    setFormError('');
    setModalMode('edit');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      if (modalMode === 'create') {
        const result = await window.electronAPI.createUser({ requestingRole: user.role, ...form });
        if (!result.success) { setFormError(result.message); return; }
        setTempPasswordNotice({ username: result.username, tempPassword: result.tempPassword });
      } else {
        const result = await window.electronAPI.updateUser({ requestingRole: user.role, ...form });
        if (!result.success) { setFormError(result.message); return; }
      }
      setModalMode(null);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function confirmReset() {
    setSaving(true);
    const result = await window.electronAPI.resetUserPassword({ requestingRole: user.role, username: resetTarget.username });
    setSaving(false);
    setResetTarget(null);
    if (result.success) {
      setTempPasswordNotice({ username: result.username, tempPassword: result.tempPassword });
    } else {
      setAlertInfo({ title: 'Password Reset Failed', message: result.message });
    }
  }

  async function generateQR(u) {
    if (!isSuperadmin && u.role !== 'Secretary') {
      setAlertInfo({ title: 'Cannot Generate QR Card', message: 'As an Admin, you can only generate QR credentials for Secretary accounts.' });
      return;
    }
    setQrLoadingFor(u.username);
    const result = await window.electronAPI.resetUserPassword({ requestingRole: user.role, username: u.username });
    setQrLoadingFor(null);
    if (!result.success) { setAlertInfo({ title: 'QR Card Generation Failed', message: result.message }); return; }
    setQrCardData({ username: u.username, password: result.tempPassword, role: u.role, section: u.section, firstName: u.firstName, lastName: u.lastName });
  }

  function exportCSV() {
    const header = ['Username', 'First Name', 'Last Name', 'Email', 'Phone', 'Role', 'Section', 'Status', 'Last Login'];
    const rows = filtered.map((u) => [
      u.username, u.firstName, u.lastName, u.email, u.phone, u.role,
      SECTION_LABEL[u.section] || u.section, u.isActive ? 'Active' : 'Inactive', u.lastLoginAt || 'Never'
    ]);
    const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'users-export.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  const sectionOptions = form?.role === 'Secretary' ? ['WENDY', 'KEILA'] : ['WENDY', 'KEILA', 'Both'];

  return (
    <div>
      <div className="ent-kpi-grid" style={{ marginBottom: '1.4rem' }}>
        <div className="ent-kpi-card ent-kpi-card--highlight">
          <div className="ent-kpi-icon">👥</div>
          <div className="ent-kpi-label">{isSuperadmin ? 'Total Users' : 'Secretaries'}</div>
          <div className="ent-kpi-value">{stats.total}</div>
        </div>
        <div className="ent-kpi-card">
          <div className="ent-kpi-icon">✅</div>
          <div className="ent-kpi-label">Active Users</div>
          <div className="ent-kpi-value">{stats.active}</div>
        </div>
        <div className="ent-kpi-card">
          <div className="ent-kpi-icon">🚫</div>
          <div className="ent-kpi-label">Inactive Users</div>
          <div className="ent-kpi-value">{stats.inactive}</div>
        </div>
        <div className="ent-kpi-card">
          <div className="ent-kpi-icon">🛡️</div>
          <div className="ent-kpi-label">{isSuperadmin ? 'User Roles' : 'Access Level'}</div>
          <div className="ent-kpi-value">{stats.roles}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '1.2rem', marginBottom: '1.2rem' }}>
        <div className="ent-card ent-card--hover">
          <h3 className="ent-card-title"><UsersIcon size={16} /> Quick Actions</h3>
          <div className="ent-quick-actions">
            <button className="ent-action-item" onClick={openCreate}>
              <div className="ent-action-icon"><UserPlus size={16} /></div>
              <div className="ent-action-label">{isSuperadmin ? 'Create User' : 'Add Secretary'}</div>
            </button>
            <button className="ent-action-item" onClick={() => setFilter('active')}>
              <div className="ent-action-icon"><UserCheck size={16} /></div>
              <div className="ent-action-label">Active Users</div>
            </button>
            <button className="ent-action-item" onClick={() => setFilter('inactive')}>
              <div className="ent-action-icon"><UserX size={16} /></div>
              <div className="ent-action-label">Inactive Users</div>
            </button>
            <button className="ent-action-item" onClick={exportCSV}>
              <div className="ent-action-icon"><Download size={16} /></div>
              <div className="ent-action-label">Export CSV</div>
            </button>
          </div>
        </div>

        <div className="ent-card ent-card--hover">
          <h3 className="ent-card-title"><ShieldCheck size={16} /> Role Distribution</h3>
          {roleDistribution.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--c-faint)' }}>No active users yet.</p>
          ) : (
            roleDistribution.map(([role, count]) => (
              <div className="ent-status-item" key={role}>
                <span className="ent-status-label">{role}</span>
                <span className="ent-status-value">
                  {count} <span style={{ color: 'var(--c-faint)', fontWeight: 400 }}>({stats.active > 0 ? Math.round((count / stats.active) * 100) : 0}%)</span>
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="ent-card">
        <div className="ent-card-head">
          <h3 className="ent-card-title" style={{ margin: 0 }}>
            <UsersIcon size={16} /> {isSuperadmin ? 'All Users' : 'Secretary Users'}
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div className="ent-autocomplete-input-wrap">
              <Search size={14} />
              <input
                className="ent-input"
                style={{ width: '220px' }}
                placeholder="Search name, email, role..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="ent-tabs">
              {['all', 'active', 'inactive'].map((f) => (
                <button key={f} className={`ent-tab ${filter === f ? 'is-active' : ''}`} onClick={() => setFilter(f)}>
                  {f[0].toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <p style={{ fontSize: '0.82rem', color: 'var(--c-faint)' }}>Loading...</p>
        ) : (
          <>
            <div className="ent-table-wrap" style={{ maxHeight: '480px' }}>
              <table className="ent-table ent-table--zebra">
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Section</th>
                    <th>Status</th>
                    <th>Last Login</th>
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.length === 0 && (
                    <tr><td colSpan={6} className="ent-table-empty">No users found.</td></tr>
                  )}
                  {paged.map((u) => {
                    const canManage = isSuperadmin || u.role === 'Secretary';
                    return (
                      <tr key={u.username}>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                            <div className="ent-avatar ent-avatar--sm">{initials(u.firstName, u.lastName, u.username)}</div>
                            <div>
                              <div style={{ fontWeight: 600, color: 'var(--c-ink)' }}>{u.firstName} {u.lastName || u.username}</div>
                              <div style={{ fontSize: '0.72rem', color: 'var(--c-faint)' }}>{u.email || u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td><span className="ent-badge" style={{ background: ROLE_BADGE_COLOR[u.role] || '#6b7280' }}>{u.role}</span></td>
                        <td style={{ fontSize: '0.78rem' }}>{SECTION_LABEL[u.section] || u.section}</td>
                        <td><span className={`ent-badge ${u.isActive ? 'ent-badge--success' : 'ent-badge--danger'}`}>{u.isActive ? 'Active' : 'Inactive'}</span></td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--c-muted)' }}>{formatDateTime(u.lastLoginAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                            {canManage ? (
                              <>
                                <button className="ent-icon-btn ent-icon-btn--blue ent-tooltip" data-tooltip="Edit User" onClick={() => openEdit(u)}><Edit2 size={13} /></button>
                                <button className="ent-icon-btn ent-icon-btn--amber ent-tooltip" data-tooltip="Reset Password" onClick={() => setResetTarget(u)}><KeyRound size={13} /></button>
                                <button
                                  className="ent-icon-btn ent-icon-btn--purple ent-tooltip"
                                  data-tooltip="Generate QR Credentials"
                                  disabled={qrLoadingFor === u.username}
                                  onClick={() => generateQR(u)}
                                >
                                  <QrCode size={13} />
                                </button>
                              </>
                            ) : (
                              <span style={{ color: 'var(--c-faint)', fontSize: '0.72rem' }}>Restricted</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE_SIZE} total={filtered.length} onChange={setPage} />
          </>
        )}
      </div>

      {modalMode && form && (
        <div className="ent-modal-overlay" onClick={() => setModalMode(null)}>
          <div className="ent-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ent-modal-head">
              <h3>{modalMode === 'create' ? (isSuperadmin ? 'Create New User' : 'Add Secretary') : 'Edit User'}</h3>
              <button className="ent-modal-close" onClick={() => setModalMode(null)}><X size={18} /></button>
            </div>
            <form onSubmit={handleSubmit}>
              <div className="ent-modal-body">
                {formError && <div className="ent-error-box">{formError}</div>}

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
                  <div className="ent-field">
                    <label>First Name</label>
                    <input required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
                  </div>
                  <div className="ent-field">
                    <label>Last Name</label>
                    <input required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
                  </div>
                </div>

                <div className="ent-field">
                  <label>Username</label>
                  <input
                    required
                    disabled={modalMode === 'edit'}
                    value={form.username}
                    onChange={(e) => setForm({ ...form, username: e.target.value })}
                  />
                </div>

                <div className="ent-field">
                  <label>Email</label>
                  <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>

                <div className="ent-field">
                  <label>Phone</label>
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
                  <div className="ent-field">
                    <label>Role</label>
                    <select
                      required
                      disabled={!isSuperadmin}
                      value={form.role}
                      onChange={(e) => setForm({ ...form, role: e.target.value })}
                    >
                      {!form.role && <option value="">Select a role</option>}
                      {isSuperadmin ? (
                        <>
                          <option value="Superadmin">Superadmin</option>
                          <option value="Admin">Admin</option>
                          <option value="Secretary">Secretary</option>
                        </>
                      ) : (
                        <option value="Secretary">Secretary</option>
                      )}
                    </select>
                    {!isSuperadmin && <p className="ent-hint">As an Admin, you can only create/manage Secretary users.</p>}
                  </div>
                  <div className="ent-field">
                    <label>School / Section</label>
                    <select required value={form.section} onChange={(e) => setForm({ ...form, section: e.target.value })}>
                      {!form.section && <option value="">Select</option>}
                      {sectionOptions.map((s) => <option key={s} value={s}>{SECTION_LABEL[s]}</option>)}
                    </select>
                  </div>
                </div>

                {modalMode === 'edit' && (
                  <div className="ent-field">
                    <Toggle
                      checked={form.isActive}
                      onChange={(val) => setForm({ ...form, isActive: val })}
                      label="User is active"
                      id="user-active-toggle"
                    />
                  </div>
                )}

                <div className="ent-modal-footer">
                  <button type="button" className="ent-btn ent-btn--secondary" onClick={() => setModalMode(null)}>Cancel</button>
                  <button type="submit" className="ent-btn ent-btn--primary" disabled={saving}>
                    {saving ? 'Saving...' : modalMode === 'create' ? 'Create User' : 'Update User'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!resetTarget}
        title="Reset Password"
        message="A new temporary password will be generated and shown once — share it securely with the user."
        detailBlock={resetTarget && (
          <>
            <strong>{resetTarget.firstName} {resetTarget.lastName}</strong><br />
            {resetTarget.username} &bull; {resetTarget.role}
          </>
        )}
        confirmLabel={saving ? 'Resetting...' : 'Reset Password'}
        cancelLabel="Cancel"
        confirming={saving}
        onConfirm={confirmReset}
        onCancel={() => setResetTarget(null)}
      />

      <ConfirmDialog
        open={!!alertInfo}
        tone="danger"
        title={alertInfo?.title || 'Notice'}
        message={alertInfo?.message || ''}
        confirmLabel="Got It"
        onConfirm={() => setAlertInfo(null)}
      />

      {tempPasswordNotice && (
        <div className="ent-modal-overlay" onClick={() => setTempPasswordNotice(null)}>
          <div className="ent-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '380px' }}>
            <div className="ent-modal-head">
              <h3>Temporary Password</h3>
              <button className="ent-modal-close" onClick={() => setTempPasswordNotice(null)}><X size={18} /></button>
            </div>
            <div className="ent-modal-body" style={{ textAlign: 'center' }}>
              <p style={{ fontSize: '0.85rem' }}>For <strong>{tempPasswordNotice.username}</strong> — shown once, won't be shown again:</p>
              <code style={{ display: 'block', margin: '0.8rem 0', padding: '0.7rem', background: 'var(--c-surface-flat)', borderRadius: 'var(--r-sm)', fontSize: '1rem', letterSpacing: '0.05em' }}>
                {tempPasswordNotice.tempPassword}
              </code>
              <p className="ent-hint">Share this securely and have them change it on first login.</p>
              <button className="ent-btn ent-btn--primary" style={{ width: '100%' }} onClick={() => setTempPasswordNotice(null)}>Done</button>
            </div>
          </div>
        </div>
      )}

      {qrCardData && (
        <div className="ent-modal-overlay" onClick={() => setQrCardData(null)}>
          <div className="ent-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '400px' }}>
            <div className="ent-modal-head">
              <h3>QR Credential Card</h3>
              <button className="ent-modal-close" onClick={() => setQrCardData(null)}><X size={18} /></button>
            </div>
            <div className="ent-modal-body">
              <QRCredentialCard
                username={qrCardData.username}
                password={qrCardData.password}
                role={qrCardData.role}
                section={qrCardData.section}
                firstName={qrCardData.firstName}
                lastName={qrCardData.lastName}
              />
              <p className="ent-hint" style={{ textAlign: 'center', marginTop: '0.8rem' }}>
                This issued a new temporary password — share the card securely.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
