import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Header } from './components/Header';
import { SessionGuardModal } from './components/SessionGuardModal';
import { LoginPage } from './pages/LoginPage';
import { UserLivePage } from './pages/UserLivePage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { EmergencyFallbackPage } from './pages/EmergencyFallbackPage';
import { streamApiClient } from './services/apiClient';

interface FallbackStatus {
  active: boolean;
  videoId: string;
  title: string;
}

const AppContent: React.FC = () => {
  const { isLoggedIn, isAdmin } = useAuth();
  const [currentView, setCurrentView] = useState<'live' | 'admin'>('live');

  // Checked BEFORE the login gate — the whole point of emergency fallback
  // is that it works even for visitors who were never going to make it
  // through login anyway. `null` = still checking (brief, first paint only).
  const [fallback, setFallback] = useState<FallbackStatus | null>(null);
  // Lets an admin who knows to look for it get back into the real app
  // (login form, then dashboard) while fallback is active for everyone else.
  const [adminBypass, setAdminBypass] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const checkFallback = async () => {
      try {
        const res = await streamApiClient.get('/stream/config/');
        if (cancelled) return;
        const data = res.data?.data;
        setFallback({
          active: !!data?.is_emergency_fallback,
          videoId: data?.youtube_video_id || '',
          title: data?.title || '',
        });
      } catch {
        // Can't even determine fallback status — fail open to the normal
        // app rather than silently stranding everyone on a blank screen.
        if (!cancelled) setFallback((prev) => prev ?? { active: false, videoId: '', title: '' });
      }
    };
    checkFallback();
    // Poll so it also takes effect for tabs already open, and so turning it
    // back OFF is picked up automatically without a manual refresh.
    const interval = setInterval(checkFallback, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (fallback === null) {
    // Briefest of loading states — this check is fast and only happens once.
    return <div className="fixed inset-0 bg-slate-950" />;
  }

  // Fallback active and this session isn't an already-authenticated admin —
  // show ONLY the bare embed, completely bypassing login/dashboard/everything.
  if (fallback.active && !isAdmin && !adminBypass) {
    return (
      <EmergencyFallbackPage
        videoId={fallback.videoId}
        title={fallback.title}
        onAdminBypass={() => setAdminBypass(true)}
      />
    );
  }

  if (!isLoggedIn) {
    return (
      <>
        <LoginPage />
        <SessionGuardModal />
      </>
    );
  }

  const isLiveView = !isAdmin || currentView === 'live';

  return (
    <div className={`bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-amber-500 selection:text-slate-950 ${
      isLiveView ? 'h-screen max-h-screen lg:overflow-hidden' : 'min-h-screen'
    }`}>
      <Header
        currentView={currentView}
        onNavigate={(view) => setCurrentView(view)}
      />

      <main className={`flex-1 flex flex-col min-h-0 ${isLiveView ? 'lg:overflow-hidden' : 'overflow-y-auto'}`}>
        {isAdmin && currentView === 'admin' ? (
          <AdminDashboardPage />
        ) : (
          <UserLivePage />
        )}
      </main>

      <SessionGuardModal />
    </div>
  );
};

export function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </ToastProvider>
  );
}

export default App;
