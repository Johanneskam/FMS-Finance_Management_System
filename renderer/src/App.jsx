import React from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import LoginScreen from './components/LoginScreen.jsx';
import SuperadminDashboard from './components/SuperadminDashboard.jsx';
import SecretaryDashboard from './components/SecretaryDashboard.jsx';

function Dashboard() {
  const { user, logout, updateUser } = useAuth();

  // Superadmin (you, the developer) and Admin (the CEO) both get the
  // full-page admin dashboard layout (header, sidebar, logout live inside
  // SuperadminDashboard itself) to match the admin_dashboard.php reference,
  // rather than being wrapped in the generic bar below.
  if (user.role === 'Superadmin' || user.role === 'Admin') {
    return <SuperadminDashboard user={user} onLogout={logout} onProfileUpdated={updateUser} />;
  }

  // Secretary gets its own full-page portal, matching secretary_dashboard.php
  // + sidebar_secretary.php, with real data (not mock) from the ledger engine.
  return <SecretaryDashboard user={user} onLogout={logout} onProfileUpdated={updateUser} />;
}

function Shell() {
  const { user } = useAuth();
  return user ? <Dashboard /> : <LoginScreen />;
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}