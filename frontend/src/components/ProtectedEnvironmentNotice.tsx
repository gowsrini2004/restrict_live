import React, { useState } from 'react';
import { ShieldAlert, Settings2, Check } from 'lucide-react';

/* Shown to attendees every time they log in (this component only mounts
 * once UserLivePage itself mounts, which only happens right after a fresh
 * login), explaining up front why YouTube's own on-screen controls don't
 * work here and where quality/speed actually live — so it's not something
 * they have to discover by trial and error. Not shown to admins, who
 * already know the system. No persistence/dismiss-memory on purpose — the
 * whole point is a fresh reminder on every login, not a one-time notice. */
export const ProtectedEnvironmentNotice: React.FC = () => {
  const [visible, setVisible] = useState(true);

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
      <div className="bg-slate-900 border border-amber-500/30 rounded-2xl max-w-md w-full p-5 sm:p-6 shadow-2xl text-center space-y-3 sm:space-y-4 transform animate-scaleUp">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
          <ShieldAlert className="w-7 h-7 sm:w-8 sm:h-8" />
        </div>

        <div className="space-y-2 sm:space-y-2.5">
          <h3 className="text-lg sm:text-xl font-bold text-white leading-snug">Protected Live Viewing Environment</h3>
          {/* Plain block text — NOT a flex row with the icon wedged inline,
              which wrapped into uneven, off-center fragments on narrow
              phone widths. The icon+instruction below is its own short,
              separate row instead, which wraps cleanly since it's short. */}
          <p className="text-slate-300 text-sm leading-relaxed">
            This stream plays inside a protected viewing environment, so YouTube's own on-screen controls are disabled here. Please use this player's built-in controls — play/pause, volume, and the timeline — for everything you need.
          </p>
          <div className="flex items-center justify-center gap-1.5 text-slate-300 text-sm leading-relaxed">
            <Settings2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>For quality or speed, go fullscreen and tap the gear icon.</span>
          </div>
        </div>

        <button
          onClick={() => setVisible(false)}
          className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
        >
          <Check className="w-4 h-4" />
          <span>Got It, Continue</span>
        </button>
      </div>
    </div>
  );
};
