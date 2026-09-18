import React from 'react';
import { useAuth } from '../context/AuthContext';
import { Radio, LogOut, ShieldCheck, User as UserIcon, LayoutDashboard } from 'lucide-react';

interface HeaderProps {
  currentView?: 'live' | 'admin';
  onNavigate?: (view: 'live' | 'admin') => void;
}

export const Header: React.FC<HeaderProps> = ({ currentView = 'live', onNavigate }) => {
  const { user, logout, isAdmin } = useAuth();

  return (
    <header className="sticky top-0 z-50 bg-slate-950 border-b border-white/10 px-3 sm:px-6 h-14 flex items-center justify-between shadow-xl">
      {/* Brand */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shrink-0 shadow-lg shadow-amber-500/20">
          <Radio className="w-4 h-4 text-slate-950 animate-pulse" />
        </div>
        <div className="min-w-0">
          <h1 className="text-white font-extrabold text-sm leading-tight truncate">
            International Retreat 2026
          </h1>
          <p className="text-slate-500 text-[10px] leading-none hidden sm:block">Sri Ramakrishna Math &amp; Mission</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Admin / Live toggle */}
        {isAdmin && onNavigate && (
          <button
            onClick={() => onNavigate(currentView === 'live' ? 'admin' : 'live')}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-amber-400 border border-amber-500/30 text-xs font-semibold transition-all"
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{currentView === 'live' ? 'Admin' : 'Live Stream'}</span>
          </button>
        )}

        {/* User email chip — desktop only */}
        {user && (
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-white/10 text-slate-300 text-xs font-medium max-w-[180px]">
            {user.is_admin
              ? <ShieldCheck className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              : <UserIcon    className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            }
            <span className="truncate">{user.email}</span>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={logout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 text-xs font-semibold transition-all"
          title="Sign Out"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  );
};
