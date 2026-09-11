import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import QRLoginPanel from './QRLoginPanel.jsx';

// Visual language pulled from index.php (split card, floating labels, tab bar)
// plus splash.html (logo sizing/style), kept consistent between both screens.
const css = `
.login-page {
  min-height: 100vh;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: clamp(0.75rem, 3vw, 1.5rem) clamp(0.75rem, 3vw, 1.5rem) clamp(2.5rem, 6vw, 3.5rem);
  background: linear-gradient(to bottom right, #06b6d4, #fcd34d);
  position: relative;
  box-sizing: border-box;
  overflow: hidden;
}

/* Soft floating background shapes — same treatment as the main app
   shell's .ent-bg-shapes, brought here too for a consistent first
   impression rather than a plain gradient on login specifically. */
.login-bg-shapes { position: absolute; inset: 0; overflow: hidden; z-index: 0; pointer-events: none; }
.login-shape { position: absolute; border-radius: 50%; background: rgba(255,255,255,0.15); animation: loginFloat 15s infinite linear; }
.login-shape-1 { width: 350px; height: 350px; top: -175px; right: -175px; }
.login-shape-2 { width: 280px; height: 280px; bottom: -140px; left: -140px; animation-delay: -5s; }
.login-shape-3 { width: 200px; height: 200px; top: 50%; right: 15%; animation-delay: -10s; }
@keyframes loginFloat {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  33% { transform: translateY(-20px) rotate(120deg); }
  66% { transform: translateY(10px) rotate(240deg); }
}

.login-container {
  background: rgba(255,255,255,0.10);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius: 1.25rem;
  box-shadow: 0 25px 50px -12px rgba(0,0,0,0.25);
  width: min(94vw, 920px);
  min-height: min(80vh, 560px);
  display: grid;
  grid-template-columns: 1fr 1.1fr;
  overflow: hidden;
  position: relative;
  z-index: 1;
  animation: loginSlideIn 0.6s ease-out;
}
@keyframes loginSlideIn {
  from { opacity: 0; transform: translateY(20px); }
  to { opacity: 1; transform: translateY(0); }
}
@media (max-width: 700px) {
  .login-container { grid-template-columns: 1fr; width: min(94vw, 460px); min-height: auto; }
}

.login-left {
  padding: clamp(1.5rem, 4vw, 2.5rem);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  background: rgba(255,255,255,0.05);
  position: relative;
}
/* Bigger footprint, matching the prototype's grander scale — minimal
   headroom, same treatment as the taskbar icon. */
.login-left img {
  width: clamp(180px, 34vw, 300px);
  height: clamp(180px, 34vw, 300px);
  object-fit: contain;
  margin-bottom: 1.5rem;
  filter: drop-shadow(0 8px 16px rgba(0,0,0,0.15));
  animation: logoFloat 3s ease-in-out infinite;
  transition: transform 0.2s ease;
}
.login-left img:hover { transform: scale(1.03); }
@keyframes logoFloat {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-8px); }
}
.login-left h1 { color: #fff; font-size: clamp(1.1rem, 2.4vw, 1.35rem); font-weight: 700; margin-bottom: 0.6rem; text-shadow: 0 2px 6px rgba(0,0,0,0.1); }
.login-left p { color: rgba(0,0,0,0.75); font-size: 0.82rem; font-weight: 500; line-height: 1.5; }

.login-right {
  padding: clamp(1.5rem, 4vw, 2.5rem);
  background: #fff;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.login-header { text-align: center; margin-bottom: 1.5rem; }
.login-header h2 { color: #06b6d4; font-size: 1.4rem; font-weight: 600; margin-bottom: 0.25rem; }
.login-header p { color: #6b7280; font-size: 0.75rem; }

.login-tabs { display: flex; gap: 0.25rem; background: #f3f4f6; padding: 0.25rem; border-radius: 0.5rem; margin-bottom: 1.5rem; }
.login-tab {
  flex: 1; padding: 0.5rem 0.75rem; border: none; border-radius: 0.4rem; font-size: 0.82rem; font-weight: 500;
  cursor: pointer; background: transparent; color: #6b7280; transition: all 0.15s;
}
.login-tab.active { background: #fff; color: #06b6d4; box-shadow: 0 1px 2px rgba(0,0,0,0.06); }

.login-error {
  background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c;
  font-size: 0.78rem; padding: 0.6rem 0.75rem; border-radius: 0.5rem; margin-bottom: 1rem;
  text-align: center;
}

/* Floating label fields — text is vertically centered via a fixed height +
   flex, and the label sits centered at rest, floating up on focus/fill. */
.floating-group { position: relative; margin-bottom: 1.2rem; }
.floating-group input {
  width: 100%;
  height: 3rem;
  padding: 0 2.5rem 0 0.85rem;
  border: 1px solid #d1d5db;
  border-radius: 0.5rem;
  font-size: 0.9rem;
  outline: none;
  transition: border-color 0.15s;
  background: #fff;
  color: #111827;
  box-sizing: border-box;
  display: flex;
  align-items: center;
}
.floating-group.no-icon input { padding-right: 0.85rem; }
.floating-group input:focus { border-color: #06b6d4; }
.floating-group label {
  position: absolute;
  left: 0.85rem;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.9rem;
  color: #9ca3af;
  pointer-events: none;
  transition: all 0.15s ease;
  background: #fff;
  padding: 0 4px;
}
.floating-group input:focus + label,
.floating-group input:not(:placeholder-shown) + label {
  top: 0;
  transform: translateY(-50%) scale(0.78);
  left: 0.7rem;
  color: #06b6d4;
}

.password-toggle {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: #9ca3af;
  display: flex;
  align-items: center;
  justify-content: center;
}
.password-toggle:hover { color: #06b6d4; }
.password-toggle svg { width: 18px; height: 18px; }

.login-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.1rem; font-size: 0.75rem; flex-wrap: wrap; gap: 0.5rem; }
.login-row label { display: flex; align-items: center; gap: 0.4rem; color: #6b7280; cursor: pointer; }
.login-row button.link { background: none; border: none; color: #06b6d4; font-weight: 500; cursor: pointer; padding: 0; font-size: 0.75rem; }

.login-btn {
  width: 100%; padding: 0.75rem; border: none; border-radius: 0.5rem;
  background: linear-gradient(135deg, #06b6d4, #0e7490);
  color: #fff; font-weight: 600; font-size: 0.88rem; cursor: pointer;
  display: flex; align-items: center; justify-content: center; gap: 0.5rem;
  box-shadow: 0 4px 10px rgba(6,182,212,0.35); transition: transform 0.15s ease;
}
.login-btn:hover:not(:disabled) { transform: translateY(-1px); }
.login-btn:disabled { opacity: 0.75; cursor: default; }

.login-spinner { width: 15px; height: 15px; border: 2.5px solid rgba(255,255,255,0.4); border-top-color: #fff; border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.login-status { margin-top: 1rem; text-align: center; font-size: 0.7rem; color: #9ca3af; }

.login-footer {
  position: fixed; bottom: 0; left: 0; right: 0;
  background: linear-gradient(to right, #0891b2, #0d9488);
  color: #fff; text-align: center; font-size: 0.68rem; padding: 0.55rem;
}

.qr-placeholder { text-align: center; padding: 2.5rem 1rem; color: #9ca3af; font-size: 0.82rem; }

.qr-login { text-align: center; padding: 0.5rem 0 0.25rem; }
.qr-login-hint { font-size: 0.8rem; color: #6b7280; margin-bottom: 1.1rem; }
.qr-login-actions { display: flex; flex-direction: column; gap: 0.6rem; }
.qr-btn {
  padding: 0.65rem; border-radius: 0.5rem; font-size: 0.85rem; font-weight: 600;
  cursor: pointer; border: none; text-align: center; display: block;
}
.qr-btn-primary { background: linear-gradient(135deg, #06b6d4, #0e7490); color: #fff; }
.qr-btn-secondary { background: #f3f4f6; color: #374151; border: 1px solid #d1d5db; }
.qr-btn-cancel { background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; margin-top: 0.8rem; width: 100%; }
.qr-video { width: 100%; border-radius: 0.6rem; background: #000; max-height: 220px; object-fit: cover; }

@media (max-width: 400px) {
  .login-header h2 { font-size: 1.2rem; }
  .login-right, .login-left { padding: 1.25rem; }
}
`;

// Simple hand-built eye / eye-slash icon (not a copied icon-font glyph),
// kept deliberately minimal so it renders correctly with no dependency.
function EyeIcon({ open }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" />
      <circle cx="12" cy="12" r="3" />
      {!open && <line x1="3" y1="3" x2="21" y2="21" />}
    </svg>
  );
}

export default function LoginScreen() {
  const { login, loading, error } = useAuth();
  const [tab, setTab] = useState('credentials');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Pre-fill the last-remembered username (never the password — see
  // main.js's auth:getRememberedUsername for why).
  useEffect(() => {
    window.electronAPI.getRememberedUsername().then((saved) => {
      if (saved) {
        setUsername(saved);
        setRemember(true);
      }
    });
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!username || !password || loading) return;
    const success = await login(username, password);
    if (success) {
      window.electronAPI.setRememberedUsername(remember ? username : null);
    }
  }

  return (
    <div className="login-page">
      <style>{css}</style>

      <div className="login-bg-shapes">
        <div className="login-shape login-shape-1" />
        <div className="login-shape login-shape-2" />
        <div className="login-shape login-shape-3" />
      </div>

      <div className="login-container">
        {/* LEFT: brand panel */}
        <div className="login-left">
          <img src="../assets/icon.png" alt="School logo" />
          <h1>F M S</h1>
          <p>Fee Management System<br />Secure &bull; Efficient &bull; Transparent</p>
        </div>

        {/* RIGHT: form panel */}
        <div className="login-right">
          <div className="login-header">
            <h2>Login</h2>
            <p>Please log in to access your dashboard</p>
          </div>

          <div className="login-tabs">
            <button
              type="button"
              className={`login-tab ${tab === 'credentials' ? 'active' : ''}`}
              onClick={() => setTab('credentials')}
            >
              Credentials
            </button>
            <button
              type="button"
              className={`login-tab ${tab === 'qr' ? 'active' : ''}`}
              onClick={() => setTab('qr')}
            >
              QR Code
            </button>
          </div>

          {error ? <div className="login-error">{error}</div> : null}

          {tab === 'credentials' ? (
            <form onSubmit={handleSubmit} noValidate>
              <div className="floating-group no-icon">
                <input
                  id="username"
                  type="text"
                  autoFocus
                  placeholder=" "
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={loading}
                />
                <label htmlFor="username">Username</label>
              </div>

              <div className="floating-group">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder=" "
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={loading}
                />
                <label htmlFor="password">Password</label>
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  <EyeIcon open={showPassword} />
                </button>
              </div>

              <div className="login-row">
                <label>
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                  />
                  Remember Me
                </label>
                <button type="button" className="link" onClick={() => alert('Password resets go through a Superadmin — this flow is not wired up yet.')}>
                  Forgot Password?
                </button>
              </div>

              <button className="login-btn" type="submit" disabled={loading}>
                {loading ? <span className="login-spinner" /> : null}
                {loading ? 'Signing In...' : 'Log In'}
              </button>

              <div className="login-status">v0.1 &bull; Local &bull; Offline-first</div>
            </form>
          ) : (
            <QRLoginPanel />
          )}
        </div>
      </div>

      <footer className="login-footer">&copy; 2025 J &amp; L Technologies. All rights reserved</footer>
    </div>
  );
}