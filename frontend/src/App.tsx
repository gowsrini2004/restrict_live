import React, { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { Header } from './components/Header';
import { SessionGuardModal } from './components/SessionGuardModal';
import { LoginPage } from './pages/LoginPage';
import { UserLivePage } from './pages/UserLivePage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';

const AppContent: React.FC = () => {
  const { isLoggedIn, isAdmin } = useAuth();
  const [currentView, setCurrentView] = useState<'live' | 'admin'>('live');

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
