import React, { useState, useEffect } from 'react';
import { ProtectedPlayer } from '../components/ProtectedPlayer';
import { QnAPanel } from '../components/QnAPanel';
import { streamApiClient } from '../services/apiClient';
import { useTabLock } from '../hooks/useTabLock';
import { AlertOctagon, ArrowRightLeft, Sparkles } from 'lucide-react';

export const UserLivePage: React.FC = () => {
  const { isTabLocked, forceClaimLock } = useTabLock();

  const [streamConfig, setStreamConfig] = useState<{
    title: string;
    youtube_video_id: string;
    is_live: boolean;
    offline_image_url?: string;
    offline_message?: string;
  }>({
    title: 'International Retreat 2026 — Live Stream',
    youtube_video_id: 'jfKfPfyJRdk',
    is_live: true,
    offline_image_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80',
    offline_message: 'The live broadcast is currently offline. Please stay tuned for the next session.',
  });

  const fetchStreamConfig = async () => {
    try {
      const res = await streamApiClient.get('/stream/config/');
      if (res.data?.success && res.data.data) setStreamConfig(res.data.data);
    } catch (err) {
      console.error('Failed to load stream config:', err);
    }
  };

  useEffect(() => {
    fetchStreamConfig();
    const iv = setInterval(fetchStreamConfig, 10000);
    return () => clearInterval(iv);
  }, []);

  /* ── Tab-locked screen ───────────────────────────────────────────── */
  if (isTabLocked) {
    return (
      <div className="h-full bg-slate-950 flex flex-col justify-center items-center p-4">
        <div className="max-w-sm w-full bg-slate-900 border border-amber-500/30 rounded-2xl p-7 text-center space-y-5 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
            <AlertOctagon className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-lg font-extrabold text-white">Stream Open in Another Tab</h2>
            <p className="text-slate-400 text-sm mt-2 leading-relaxed">
              Multi-tab playback is restricted. Switch the stream to this tab to continue watching.
            </p>
          </div>
          <button
            onClick={forceClaimLock}
            className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm shadow-xl shadow-amber-500/20 transition-all flex items-center justify-center gap-2 active:scale-95"
          >
            <ArrowRightLeft className="w-4 h-4" />
            Switch Stream to This Tab
          </button>
        </div>
      </div>
    );
  }

  /* ── Main page ───────────────────────────────────────────────────── */
  return (
    <div className="h-full max-h-full bg-slate-950 flex flex-col overflow-hidden">

      {/* Title bar (shrink-0) */}
      <div className="bg-gradient-to-r from-slate-900 to-amber-950/20 border-b border-white/8 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-white font-extrabold text-sm sm:text-base leading-tight truncate">
              {streamConfig.title}
            </h2>
            <p className="text-slate-500 text-[11px] leading-none hidden sm:block mt-0.5">
              Sri Ramakrishna Math &amp; Mission
            </p>
          </div>
        </div>

        {/* Live status badge */}
        <div className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border shrink-0 ${
          streamConfig.is_live
            ? 'text-red-400 bg-red-500/10 border-red-500/25'
            : 'text-slate-500 bg-slate-800/60 border-white/10'
        }`}>
          <span className={`w-2 h-2 rounded-full ${streamConfig.is_live ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`} />
          {streamConfig.is_live ? 'Broadcasting Live' : 'Offline'}
        </div>
      </div>

      {/* Content area — fills remaining height strictly without outer page scroll on desktop */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-hidden">

        {/* Left: Video Player container */}
        <div className="w-full lg:flex-1 lg:min-w-0 flex flex-col h-auto lg:h-full overflow-hidden bg-slate-950">
          <ProtectedPlayer
            videoId={streamConfig.youtube_video_id}
            title={streamConfig.title}
            isLive={streamConfig.is_live}
            offlineImageUrl={streamConfig.offline_image_url}
            offlineMessage={streamConfig.offline_message}
          />
        </div>

        {/* Right: Q&A Panel container */}
        <div className="w-full lg:w-[360px] xl:w-[400px] shrink-0 flex flex-col border-t border-white/8 lg:border-t-0 lg:border-l lg:border-white/8 h-auto lg:h-full overflow-hidden">
          <QnAPanel />
        </div>

      </div>
    </div>
  );
};
