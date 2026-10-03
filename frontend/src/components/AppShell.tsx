import { useState, useEffect, type ReactNode } from 'react';
import {
  Link2,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { TruncatedHash } from './ui/TruncatedHash';
import { Badge } from './ui/Badge';

export interface NavItem {
  id: string;
  label: string;
  icon: ReactNode;
  badge?: number | string;
  active: boolean;
  onClick: () => void;
}

export interface AppShellProps {
  roleTitle?: string;
  userName?: string;
  userIdentifier?: string; // DID or email
  userRole?: string;
  navItems: NavItem[];
  onLogout?: () => void;
  children: ReactNode;
  footerInfo?: ReactNode;
}

export function AppShell({
  roleTitle = 'Digital Identity Wallet',
  userName,
  userIdentifier,
  userRole = 'citizen',
  navItems,
  onLogout,
  children,
  footerInfo,
}: AppShellProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Close mobile drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileMenuOpen(false);
    };
    if (mobileMenuOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const roleLabel =
    userRole === 'organization' || userRole === 'issuer'
      ? 'Organization'
      : userRole === 'admin'
      ? 'Trust Admin'
      : userRole === 'verifier'
      ? 'Verifier'
      : 'Student';

  const roleBadgeTone =
    userRole === 'admin'
      ? 'warning'
      : userRole === 'organization' || userRole === 'issuer'
      ? 'info'
      : userRole === 'verifier'
      ? 'pending'
      : 'active';

  const renderNavContent = () => (
    <>
      {/* Brand logo & role */}
      <div className="mb-6 sm:mb-8">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-white shadow-sm">
            <Link2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <span className="text-xl font-bold tracking-tight text-blue-900 block leading-none">
              GitLink
            </span>
            <span className="text-xs text-slate-500 font-medium block mt-1">
              {roleTitle}
            </span>
          </div>
        </div>
        <div className="mt-3">
          <Badge tone={roleBadgeTone} size="sm">
            {roleLabel} Portal
          </Badge>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="space-y-1.5 flex-1" aria-label="Main Navigation">
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              item.onClick();
              setMobileMenuOpen(false);
            }}
            aria-current={item.active ? 'page' : undefined}
            className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
              item.active
                ? 'bg-blue-50 text-blue-700 font-semibold shadow-xs'
                : 'text-slate-600 hover:bg-slate-100/70 hover:text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0">
              <span
                className={`shrink-0 ${
                  item.active ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
                }`}
                aria-hidden="true"
              >
                {item.icon}
              </span>
              <span className="truncate">{item.label}</span>
            </div>
            {item.badge !== undefined && Number(item.badge) > 0 && (
              <span className="ml-2 inline-flex items-center justify-center px-2 py-0.5 text-xs font-bold leading-none text-white bg-blue-600 rounded-full">
                {item.badge}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* User profile / session status */}
      <div className="mt-auto pt-6 border-t border-slate-100 space-y-3">
        <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200/60">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              Account Status
            </span>
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active
            </span>
          </div>
          {userName && (
            <p className="mt-1 text-sm font-semibold text-slate-800 truncate" title={userName}>
              {userName}
            </p>
          )}
          {userIdentifier && (
            <div className="mt-1.5">
              <TruncatedHash value={userIdentifier} start={10} end={6} />
            </div>
          )}
        </div>

        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="w-full flex items-center gap-2.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:bg-rose-50 hover:text-rose-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Log out</span>
          </button>
        )}
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col md:flex-row text-slate-800 antialiased">
      {/* Mobile Top Header */}
      <header className="md:hidden sticky top-0 z-40 bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between shadow-xs">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-white shadow-xs">
            <Link2 className="h-4 w-4" aria-hidden="true" />
          </div>
          <span className="text-lg font-bold text-blue-900 leading-none">GitLink</span>
          <Badge tone={roleBadgeTone} size="sm">
            {roleLabel}
          </Badge>
        </div>

        <button
          type="button"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </header>

      {/* Mobile Drawer (off-canvas) */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex" role="dialog" aria-modal="true">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Drawer Panel */}
          <aside className="relative flex flex-col w-4/5 max-w-xs bg-white p-6 shadow-xl z-10 h-full overflow-y-auto">
            {renderNavContent()}
          </aside>
        </div>
      )}

      {/* Desktop Persistent Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-white border-r border-slate-200 p-6 flex-col sticky top-0 h-screen overflow-y-auto">
        {renderNavContent()}
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 flex flex-col min-h-screen">
        <div className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </div>

        {footerInfo && (
          <footer className="mt-auto border-t border-slate-200/80 bg-white/50 px-4 py-4 sm:px-6 text-center text-xs text-slate-400">
            {footerInfo}
          </footer>
        )}
      </main>
    </div>
  );
}
