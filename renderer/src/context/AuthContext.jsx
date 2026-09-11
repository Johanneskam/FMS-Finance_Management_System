import React, { createContext, useContext, useState, useCallback } from 'react';
import { playLoginSuccessChime } from '../utils/sound.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);       // full profile record (minus secrets) | null
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const login = useCallback(async (username, password) => {
    setLoading(true);
    setError('');
    try {
      // window.electronAPI.login is exposed by preload.js — the renderer
      // never touches the database or the crypto directly.
      const result = await window.electronAPI.login(username, password);

      if (result.success) {
        // Fetch the full profile (name, avatar, dates...) right away rather
        // than just holding {username, role, section} — anywhere in the
        // app that wants to show the real name or avatar (the dashboard
        // header, for instance) needs this to already be here, not have to
        // fetch it separately itself.
        let fullUser = { username: result.username, role: result.role, section: result.section };
        try {
          const profileResult = await window.electronAPI.getOwnProfile(result.username);
          if (profileResult.success) fullUser = profileResult.user;
        } catch (_) {
          // Non-fatal — login itself already succeeded; worst case the
          // header falls back to initials until something refreshes it.
        }
        setUser(fullUser);
        playLoginSuccessChime();
        return true;
      }

      setError(result.message || 'Invalid username or password.');
      window.electronAPI.beep();
      return false;
    } catch (err) {
      setError('Could not reach the local application service.');
      window.electronAPI.beep();
      return false;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setError('');
  }, []);

  // Merges a partial update (e.g. the result of a profile save) into the
  // shared user object — this is what lets the header's avatar/name update
  // immediately after a save on the Profile page, without a re-login.
  const updateUser = useCallback((partial) => {
    setUser((prev) => (prev ? { ...prev, ...partial } : prev));
  }, []);

  return (
    <AuthContext.Provider value={{ user, login, logout, updateUser, loading, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() must be used inside <AuthProvider>');
  return ctx;
}