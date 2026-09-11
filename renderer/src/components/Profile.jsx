import React, { useEffect, useRef, useState } from 'react';
import {
  User, Mail, Phone, Calendar, Lock, CheckCircle2, Camera,
  Save, KeyRound, ShieldCheck
} from 'lucide-react';
import ImageCropModal from './ui/ImageCropModal.jsx';
import QRCredentialCard from './QRCredentialCard.jsx';

const SCHOOL_LABEL = { WENDY: 'Wendy Private School', KEILA: 'Keila Academy', Both: 'Both Schools' };

const ROLE_ACCESS_COPY = {
  Superadmin: {
    headline: 'Full system access',
    points: [
      'Create, edit, and deactivate any account — including other Superadmin and Admin accounts',
      'Reset any user\'s password and generate QR login credential cards',
      'View system status and Firebase sync configuration'
    ]
  },
  Admin: {
    headline: 'Administrator access across both schools',
    points: [
      'Full financial dashboard and Reports & Analytics for both schools',
      'Create, edit, and reset passwords for Secretary accounts only',
      'Cannot manage Superadmin or other Admin accounts'
    ]
  },
  Secretary: {
    headline: 'Secretary access, scoped to your school',
    points: [
      'Process payments, register students, and manage financial communication for your school',
      'Full Reports & Analytics, scoped to your own school only',
      'No access to user management or the other school\'s data'
    ]
  }
};

function formatDateTime(iso) {
  if (!iso) return 'Never';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function initials(firstName, lastName, username) {
  const a = (firstName || '')[0] || '';
  const b = (lastName || '')[0] || '';
  return (a + b).toUpperCase() || (username || '?')[0].toUpperCase();
}

export default function Profile({ user, onProfileUpdated }) {
  const fileInputRef = useRef(null);
  const schoolLabel = SCHOOL_LABEL[user.section] || user.section;
  const access = ROLE_ACCESS_COPY[user.role] || ROLE_ACCESS_COPY.Secretary;

  // The parent's `user` (from AuthContext) only carries username/role/section
  // — everything else here (name, avatar, dates) comes from a real fetch.
  const [fullProfile, setFullProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState({ firstName: '', lastName: '', email: '', phone: '', avatarDataUrl: null });
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMessage, setProfileMessage] = useState('');
  const [profileError, setProfileError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    window.electronAPI.getOwnProfile(user.username).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setFullProfile(result.user);
        setProfile({
          firstName: result.user.firstName || '', lastName: result.user.lastName || '',
          email: result.user.email || '', phone: result.user.phone || '', avatarDataUrl: result.user.avatarDataUrl || null
        });
      }
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [user.username]);

  const [rawImageForCrop, setRawImageForCrop] = useState(null);
  const [showCropModal, setShowCropModal] = useState(false);

  // Printing your own QR login card needs your real current password
  // encoded in it (that's literally what makes the card scan-to-login) —
  // and passwords are hashed server-side, never retrievable. So this
  // re-verifies the password you type against the real login check before
  // ever generating the card, rather than silently trusting the field.
  const [showQrPrompt, setShowQrPrompt] = useState(false);
  const [qrPassword, setQrPassword] = useState('');
  const [qrVerifying, setQrVerifying] = useState(false);
  const [qrError, setQrError] = useState('');
  const [verifiedQrPassword, setVerifiedQrPassword] = useState(null);

  async function handleVerifyForQrCard() {
    setQrError('');
    if (!qrPassword) { setQrError('Enter your current password.'); return; }
    setQrVerifying(true);
    try {
      const res = await window.electronAPI.login(user.username, qrPassword);
      if (!res.success) { setQrError('Incorrect password.'); return; }
      setVerifiedQrPassword(qrPassword);
      setShowQrPrompt(false);
      setQrPassword('');
    } finally {
      setQrVerifying(false);
    }
  }

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');
  const [passwordError, setPasswordError] = useState('');

  function handlePickAvatar(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setRawImageForCrop(reader.result);
      setShowCropModal(true);
    };
    reader.readAsDataURL(file);
    e.target.value = ''; // allow picking the same file again later
  }

  function handleCropConfirm(croppedDataUrl) {
    setProfile((p) => ({ ...p, avatarDataUrl: croppedDataUrl }));
    setShowCropModal(false);
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    setProfileMessage(''); setProfileError('');
    setSavingProfile(true);
    try {
      const result = await window.electronAPI.updateOwnProfile({
        username: user.username,
        firstName: profile.firstName, lastName: profile.lastName,
        email: profile.email, phone: profile.phone, avatarDataUrl: profile.avatarDataUrl
      });
      if (!result.success) { setProfileError(result.message); return; }
      setProfileMessage('Profile updated.');
      setFullProfile((prev) => ({ ...prev, ...result.user }));
      if (onProfileUpdated) onProfileUpdated(result.user);
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setPasswordMessage(''); setPasswordError('');
    if (newPassword !== confirmPassword) { setPasswordError('New password and confirmation do not match.'); return; }
    setChangingPassword(true);
    try {
      const result = await window.electronAPI.changeOwnPassword({ username: user.username, currentPassword, newPassword });
      if (!result.success) { setPasswordError(result.message); return; }
      setPasswordMessage('Password changed successfully.');
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
    } finally {
      setChangingPassword(false);
    }
  }

  if (loading || !fullProfile) {
    return <p style={{ color: 'rgba(255,255,255,0.85)', fontSize: '0.85rem' }}>Loading profile...</p>;
  }

  return (
    <div>
      <div className="ent-card-hero" style={{ marginBottom: '1.4rem', textAlign: 'center' }}>
        <div style={{ position: 'relative', width: '96px', height: '96px', margin: '0 auto 1rem' }}>
          {profile.avatarDataUrl ? (
            <img src={profile.avatarDataUrl} alt="Your avatar" style={{ width: '96px', height: '96px', borderRadius: '50%', objectFit: 'cover', boxShadow: '0 4px 14px rgba(0,0,0,0.15)' }} />
          ) : (
            <div className="ent-avatar ent-avatar--lg" style={{ width: '96px', height: '96px', fontSize: '1.6rem', margin: '0 auto' }}>
              {initials(profile.firstName, profile.lastName, user.username)}
            </div>
          )}
          <button
            type="button"
            onClick={() => fileInputRef.current.click()}
            style={{
              position: 'absolute', bottom: 0, right: 0, width: '32px', height: '32px', borderRadius: '50%',
              background: 'var(--gradient-action)', color: '#fff', border: '2px solid #fff', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.2)'
            }}
            aria-label="Change photo"
          >
            <Camera size={14} />
          </button>
          <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handlePickAvatar} />
        </div>
        <h1 style={{ margin: '0 0 0.3rem', fontSize: '1.3rem' }}>{profile.firstName} {profile.lastName}</h1>
        <span className="ent-badge" style={{ background: 'var(--gradient-action)' }}>{user.role}</span>
        <p style={{ margin: '0.6rem 0 0', color: 'var(--c-muted)', fontSize: '0.85rem' }}>
          {schoolLabel} &bull; Member since {new Date(fullProfile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1.2rem', alignItems: 'start' }}>
        <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
          <h3 className="ent-card-title"><User size={16} /> Personal Information</h3>
          {profileError && <div className="ent-error-box">{profileError}</div>}
          {profileMessage && <div className="ent-success-box">{profileMessage}</div>}
          <form onSubmit={handleSaveProfile}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.7rem' }}>
              <div className="ent-field">
                <label>First Name</label>
                <input value={profile.firstName} onChange={(e) => setProfile((p) => ({ ...p, firstName: e.target.value }))} required />
              </div>
              <div className="ent-field">
                <label>Last Name</label>
                <input value={profile.lastName} onChange={(e) => setProfile((p) => ({ ...p, lastName: e.target.value }))} required />
              </div>
            </div>
            <div className="ent-field">
              <label><Mail size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Email Address</label>
              <input type="email" value={profile.email} onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
            </div>
            <div className="ent-field">
              <label><Phone size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />Phone Number</label>
              <input value={profile.phone} onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
            </div>

            <div style={{ background: 'var(--c-surface-flat)', borderRadius: 'var(--r-md)', padding: '0.8rem 1rem', margin: '0.9rem 0', fontSize: '0.82rem', color: 'var(--c-ink-soft)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Username</span><strong>{user.username}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.35rem' }}><span>Role</span><strong>{user.role}</strong></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>School</span><strong>{schoolLabel}</strong></div>
            </div>
            <p className="ent-hint">Username, role, and school can only be changed by an administrator.</p>

            <button type="submit" className="ent-btn ent-btn--primary" disabled={savingProfile} style={{ marginTop: '0.6rem' }}>
              <Save size={15} /> {savingProfile ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>

        <div>
          <div className="ent-card" style={{ marginBottom: '1.2rem' }}>
            <h3 className="ent-card-title"><Lock size={16} /> Security</h3>
            {passwordError && <div className="ent-error-box">{passwordError}</div>}
            {passwordMessage && <div className="ent-success-box">{passwordMessage}</div>}

            <div style={{ fontSize: '0.8rem', color: 'var(--c-muted)', marginBottom: '1rem' }}>
              <div className="ent-status-item"><span className="ent-status-label"><Calendar size={13} /> Last Login</span><span className="ent-status-value">{formatDateTime(fullProfile.lastLoginAt)}</span></div>
              <div className="ent-status-item"><span className="ent-status-label"><KeyRound size={13} /> Password Last Changed</span><span className="ent-status-value">{formatDateTime(fullProfile.passwordChangedAt)}</span></div>
            </div>

            <form onSubmit={handleChangePassword}>
              <div className="ent-field">
                <label>Current Password</label>
                <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
              </div>
              <div className="ent-field">
                <label>New Password</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
                <p className="ent-hint">At least 8 characters.</p>
              </div>
              <div className="ent-field">
                <label>Confirm New Password</label>
                <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
              </div>
              <button type="submit" className="ent-btn ent-btn--primary ent-btn--sm" disabled={changingPassword}>
                {changingPassword ? 'Changing...' : 'Change Password'}
              </button>
            </form>
          </div>

          <div className="ent-card">
            <h3 className="ent-card-title"><ShieldCheck size={16} /> Your Access</h3>
            <p style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--c-cyan-dark)', marginBottom: '0.7rem' }}>{access.headline}</p>
            {access.points.map((point, i) => (
              <div key={i} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', marginBottom: '0.55rem' }}>
                <CheckCircle2 size={14} color="var(--c-success)" style={{ marginTop: '2px', flexShrink: 0 }} />
                <span style={{ fontSize: '0.8rem', color: 'var(--c-ink-soft)' }}>{point}</span>
              </div>
            ))}
          </div>

          <div className="ent-card">
            <h3 className="ent-card-title"><ShieldCheck size={16} /> QR Login Card</h3>
            <p style={{ fontSize: '0.82rem', color: 'var(--c-muted)', marginBottom: '0.8rem' }}>
              A printable card that lets you log in by scanning it instead of typing your password. Confirming your password below is required — it's what actually gets encoded onto the card.
            </p>
            {verifiedQrPassword ? (
              <>
                <QRCredentialCard
                  username={user.username} password={verifiedQrPassword} role={user.role} section={user.section}
                  firstName={profile.firstName || user.username} lastName={profile.lastName || ''}
                />
                <button className="ent-btn ent-btn--secondary ent-btn--sm" style={{ marginTop: '0.8rem' }} onClick={() => setVerifiedQrPassword(null)}>
                  Done
                </button>
              </>
            ) : (
              <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={() => { setShowQrPrompt(true); setQrError(''); setQrPassword(''); }}>
                Print My QR Login Card
              </button>
            )}
          </div>
        </div>
      </div>

      {showQrPrompt && (
        <div className="ent-modal-overlay ent-modal-overlay--blur" onClick={() => setShowQrPrompt(false)}>
          <div className="ent-modal" style={{ maxWidth: '380px' }} onClick={(e) => e.stopPropagation()}>
            <div className="ent-modal-head"><h3>Confirm Your Password</h3></div>
            <div className="ent-modal-body">
              {qrError && <div className="ent-error-box">{qrError}</div>}
              <div className="ent-field">
                <label>Current Password</label>
                <input type="password" value={qrPassword} onChange={(e) => setQrPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleVerifyForQrCard()} autoFocus />
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.8rem' }}>
                <button className="ent-btn ent-btn--secondary ent-btn--sm" onClick={() => setShowQrPrompt(false)}>Cancel</button>
                <button className="ent-btn ent-btn--primary ent-btn--sm" onClick={handleVerifyForQrCard} disabled={qrVerifying}>
                  {qrVerifying ? 'Verifying...' : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ImageCropModal
        imageSrc={rawImageForCrop}
        open={showCropModal}
        onCancel={() => setShowCropModal(false)}
        onConfirm={handleCropConfirm}
        outputSize={256}
        title="Adjust Your Photo"
      />
    </div>
  );
}
