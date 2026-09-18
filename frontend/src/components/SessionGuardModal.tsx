import React from 'react';
import { AlertTriangle, Clock, LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export const SessionGuardModal: React.FC = () => {
  const { isSessionEvicted, isSessionExpired, dismissSessionEvictedModal } = useAuth();

  if (!isSessionEvicted && !isSessionExpired) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-red-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl text-center space-y-4 transform animate-scaleUp">
        <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
          {isSessionExpired ? <Clock className="w-8 h-8" /> : <AlertTriangle className="w-8 h-8" />}
        </div>

        <div>
          <h3 className="text-xl font-bold text-white">
            {isSessionExpired ? 'Session Expired' : 'Session Logged Out'}
          </h3>
          <p className="text-slate-300 text-sm mt-2 leading-relaxed">
            {isSessionExpired
              ? "Your session couldn't be renewed and has expired. Please log in again to continue."
              : 'Your account was logged in from another device or browser tab. To protect your access, this device was automatically logged out.'}
          </p>
        </div>

        <button
          onClick={dismissSessionEvictedModal}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
        >
          <LogIn className="w-4 h-4" />
          <span>Return to Login</span>
        </button>
      </div>
    </div>
  );
};
