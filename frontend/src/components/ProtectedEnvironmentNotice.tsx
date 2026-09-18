import React, { useState, useEffect } from 'react';
import { ShieldAlert, Settings2, Check } from 'lucide-react';

const DISMISSED_KEY = 'protected_env_notice_dismissed';

/* One-time (per browser session) notice shown to attendees right after
 * login, explaining up front why YouTube's own on-screen controls don't
 * work here and where quality/speed actually live — so it's not something
 * they have to discover by trial and error. Not shown to admins, who
 * already know the system. */
export const ProtectedEnvironmentNotice: React.FC = () => {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!sessionStorage.getItem(DISMISSED_KEY)) {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  const dismiss = () => {
    try { sessionStorage.setItem(DISMISSED_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-md w-full p-6 shadow-2xl text-center space-y-4 transform animate-scaleUp">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-8 h-8" />
        </div>

        <div>
          <h3 className="text-xl font-bold text-white">Protected Live Viewing Environment</h3>
          <p className="text-slate-300 text-sm mt-2 leading-relaxed">
            This stream plays inside a protected viewing environment, so YouTube's own on-screen controls are disabled here. Please use this player's built-in controls — play/pause, volume, and the timeline — for everything you need.
          </p>
          <p className="text-slate-300 text-sm mt-2 leading-relaxed flex items-center justify-center gap-1.5 flex-wrap">
            For video quality or playback speed, switch to fullscreen and tap the <Settings2 className="w-3.5 h-3.5 text-amber-400 inline shrink-0" /> gear icon inside the video.
          </p>
        </div>

        <button
          onClick={dismiss}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
        >
          <Check className="w-4 h-4" />
          <span>Got It, Continue</span>
        </button>
      </div>
    </div>
  );
};
