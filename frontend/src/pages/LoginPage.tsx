import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { parseErrorMessage } from '../services/apiClient';
import { Mail, Radio, KeyRound, AlertCircle, ShieldAlert, Eye, EyeOff } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const { login } = useAuth();

  const [email, setEmail] = useState<string>('');
  const [passcode, setPasscode] = useState<string>('');
  const [showPasscode, setShowPasscode] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const cleanEmail = email.trim();
    const cleanPasscode = passcode.trim();

    if (!cleanEmail) {
      setErrorMessage('Please enter your registered email address.');
      return;
    }
    if (!cleanPasscode) {
      setErrorMessage('Please enter the event passcode.');
      return;
    }

    try {
      setIsLoading(true);
      await login(cleanEmail, cleanPasscode);
    } catch (err) {
      setErrorMessage(parseErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  const fillSuperAdmin = () => { setEmail('events@chennaimath.org'); setPasscode('Mother108*'); };
  const fillDemoAdmin  = () => { setEmail('admin@chennaimath.org');  setPasscode('183663');     };
  const fillDemoUser   = () => { setEmail('attendee@example.com');   setPasscode('IRK2026');    };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Ambient orbs */}
      <div className="absolute top-1/4 -left-24 w-72 h-72 bg-amber-600/10 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-1/4 -right-24 w-72 h-72 bg-blue-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Solid background, no backdrop-filter — see ProtectedPlayer's
          offline-banner fix for why a backdrop-blur card sitting over
          other blurred elements can fail to paint entirely in some
          browser/GPU environments, which for THIS card would mean the
          whole login form silently disappearing behind the ambient orbs. */}
      <div className="w-full max-w-sm bg-slate-900 border border-white/10 rounded-2xl p-5 shadow-2xl relative z-10 space-y-5">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center mx-auto shadow-xl shadow-amber-500/20">
            <Radio className="w-6 h-6 text-slate-950 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-black text-white tracking-tight">Live Broadcast Access</h1>
            <p className="text-slate-400 text-xs mt-0.5">Sri Ramakrishna Math &amp; Mission</p>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Email */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Email Address</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <Mail className="w-4 h-4" />
              </div>
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className="w-full pl-9 pr-4 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-all"
              />
            </div>
          </div>

          {/* Passcode */}
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1">Event Passcode</label>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <KeyRound className="w-4 h-4" />
              </div>
              <input
                type={showPasscode ? 'text' : 'password'}
                autoComplete="current-password"
                value={passcode}
                onChange={(e) => setPasscode(e.target.value)}
                placeholder="Enter event passcode"
                required
                className="w-full pl-9 pr-10 py-2.5 bg-slate-950/80 border border-white/10 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPasscode((v) => !v)}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-500 hover:text-slate-300 transition-colors"
                tabIndex={-1}
              >
                {showPasscode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Error */}
          {errorMessage && (
            <div className="flex items-start gap-2 text-xs text-red-400 bg-red-950/50 p-2.5 rounded-xl border border-red-500/20 animate-shake">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-xl shadow-amber-500/20 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isLoading ? 'Verifying…' : 'Sign In to Live Stream'}
          </button>
        </form>

        {/* Security note */}
        <div className="flex items-center gap-2 text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-white/5">
          <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Single device session enforced. Logging in here signs out previous devices.</span>
        </div>

        {/* Demo shortcuts */}
        <div className="pt-1 border-t border-white/10 space-y-2">
          <p className="text-[11px] text-slate-500 text-center font-medium">Quick Demo Accounts</p>
          <div className="grid grid-cols-3 gap-1.5 text-[11px]">
            <button onClick={fillDemoUser}   className="py-2 px-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-slate-300 border border-white/10 transition-all truncate">Attendee</button>
            <button onClick={fillDemoAdmin}  className="py-2 px-1 rounded-lg bg-slate-950 hover:bg-slate-800 text-amber-400 border border-amber-500/20 font-semibold transition-all truncate">Admin</button>
            <button onClick={fillSuperAdmin} className="py-2 px-1 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold transition-all truncate">Super Admin</button>
          </div>
        </div>
      </div>
    </div>
  );
};
