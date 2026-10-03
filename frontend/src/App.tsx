/**
 * GitLink unified app shell: session gate, role-based navigation, and toasts.
 *
 * All roles (Student, Organization, Admin, Verifier) use the shared AppShell.
 */
import { useEffect, useState } from 'react';
import {
  Building2,
  ShieldCheck,
  Shield,
  CheckCircle2,
} from 'lucide-react';
import { API_BASE } from './lib/api';
import { AuthProvider, useAuth } from './lib/auth';
import { CitizenApp } from './CitizenApp';
import { OrganizationTab } from './tabs/OrganizationTab';
import { VerifierTab } from './tabs/VerifierTab';
import { AdminTab } from './tabs/AdminTab';
import { AuditTab } from './tabs/AuditTab';
import { LoginScreen } from './components/LoginScreen';
import { LoadingBlock, ToastProvider } from './components/ui';
import { AppShell } from './components/AppShell';

type OrgTab = 'dashboard' | 'audit';
type AdminTabId = 'admin' | 'audit';
type VerifierTabId = 'verifier' | 'audit';

function Shell() {
  const { user, ready, logout } = useAuth();
  const [orgTab, setOrgTab] = useState<OrgTab>('dashboard');
  const [adminTab, setAdminTab] = useState<AdminTabId>('admin');
  const [verifierTab, setVerifierTab] = useState<VerifierTabId>('verifier');

  useEffect(() => {
    if (user?.kind === 'organization' || user?.kind === 'issuer') setOrgTab('dashboard');
    if (user?.kind === 'admin') setAdminTab('admin');
    if (user?.kind === 'verifier') setVerifierTab('verifier');
  }, [user?.kind, user?.id]);

  if (!ready) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <LoadingBlock label="Checking your GitLink session…" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  if (user.kind === 'citizen') {
    return <CitizenApp />;
  }

  const footerNotice = (
    <p>
      GitLink · W3C Verifiable Credentials (SD-JWT / Ed25519) · did:key &amp; did:web · W3C Bitstring
      Status List · Hash-chained audit log · API at <code className="font-mono">{API_BASE}</code>
    </p>
  );

  // Organization role
  if (user.kind === 'organization' || user.kind === 'issuer') {
    return (
      <AppShell
        roleTitle="Organization Portal"
        userName={user.name}
        userIdentifier={user.email ?? user.did}
        userRole="organization"
        onLogout={logout}
        footerInfo={footerNotice}
        navItems={[
          {
            id: 'dashboard',
            label: 'Organization Dashboard',
            icon: <Building2 className="h-5 w-5" />,
            active: orgTab === 'dashboard',
            onClick: () => setOrgTab('dashboard'),
          },
          {
            id: 'audit',
            label: 'Activity & Audit Log',
            icon: <ShieldCheck className="h-5 w-5" />,
            active: orgTab === 'audit',
            onClick: () => setOrgTab('audit'),
          },
        ]}
      >
        {orgTab === 'dashboard' ? <OrganizationTab /> : <AuditTab />}
      </AppShell>
    );
  }

  // Admin role
  if (user.kind === 'admin') {
    return (
      <AppShell
        roleTitle="Trust Registry Admin"
        userName={user.name}
        userIdentifier={user.email ?? user.did}
        userRole="admin"
        onLogout={logout}
        footerInfo={footerNotice}
        navItems={[
          {
            id: 'admin',
            label: 'Trust Registry',
            icon: <Shield className="h-5 w-5" />,
            active: adminTab === 'admin',
            onClick: () => setAdminTab('admin'),
          },
          {
            id: 'audit',
            label: 'System Audit Log',
            icon: <ShieldCheck className="h-5 w-5" />,
            active: adminTab === 'audit',
            onClick: () => setAdminTab('audit'),
          },
        ]}
      >
        {adminTab === 'admin' ? <AdminTab /> : <AuditTab />}
      </AppShell>
    );
  }

  // Legacy Verifier role
  if (user.kind === 'verifier') {
    return (
      <AppShell
        roleTitle="Verifier Portal"
        userName={user.name}
        userIdentifier={user.email ?? user.did}
        userRole="verifier"
        onLogout={logout}
        footerInfo={footerNotice}
        navItems={[
          {
            id: 'verifier',
            label: 'Verifier Portal',
            icon: <CheckCircle2 className="h-5 w-5" />,
            active: verifierTab === 'verifier',
            onClick: () => setVerifierTab('verifier'),
          },
          {
            id: 'audit',
            label: 'Audit Log',
            icon: <ShieldCheck className="h-5 w-5" />,
            active: verifierTab === 'audit',
            onClick: () => setVerifierTab('audit'),
          },
        ]}
      >
        {verifierTab === 'verifier' ? <VerifierTab userId={user.id} /> : <AuditTab />}
      </AppShell>
    );
  }

  return null;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </AuthProvider>
  );
}
