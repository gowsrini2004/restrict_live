import React, { useState, useEffect } from 'react';
import { ProtectedPlayer } from '../components/ProtectedPlayer';
import { QnAPanel } from '../components/QnAPanel';
import { ProtectedEnvironmentNotice } from '../components/ProtectedEnvironmentNotice';
import { streamApiClient } from '../services/apiClient';
import { useTabLock } from '../hooks/useTabLock';
import { useDisableInspection } from '../hooks/useDisableInspection';
import { useAuth } from '../context/AuthContext';
import { AlertOctagon, ArrowRightLeft, Sparkles, Clock, MessageSquare } from 'lucide-react';

export const UserLivePage: React.FC = () => {
  const { isTabLocked, forceClaimLock } = useTabLock();
  const { isAdmin } = useAuth();
  // Admins keep normal DevTools access for debugging — only attendees get
  // the right-click/devtools-shortcut friction.
  useDisableInspection(!isAdmin);

  const [streamConfig, setStreamConfig] = useState<{
    title: string;
    youtube_video_id: string;
    is_live: boolean;
    is_playback_mode: boolean;
    offline_image_url?: string;
    offline_message?: string;
  }>({
    title: 'International Retreat 2026 — Live Stream',
    youtube_video_id: 'jfKfPfyJRdk',
    is_live: true,
    is_playback_mode: false,
    offline_image_url: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80',
    offline_message: 'The live broadcast is currently offline. Please stay tuned for the next session.',
  });

  // Playback mode (admin-enabled once a broadcast has ended) forces the
  // player visible even if is_live is off — that's normally the case once
  // a stream ends, and playback mode is exactly what lets viewers watch the
  // recording back despite that.
  const isPlayerVisible = streamConfig.is_playback_mode || streamConfig.is_live;

  const fetchStreamConfig = async () => {
    try {
      const res = await streamApiClient.get('/stream/config/');
      if (res.data?.success && res.data.data) {
        const incoming = res.data.data;
        // The backend blanks youtube_video_id on this poll whenever the
        // request looks unauthenticated (e.g. a momentarily-expired access
        // token, self-healed within ~15s by the background session
        // heartbeat) — never let that transient gap stomp a video ID we
        // already know is good and tear down playback for a few seconds.
        setStreamConfig((prev) => ({
          ...incoming,
          youtube_video_id: incoming.youtube_video_id || prev.youtube_video_id,
        }));
      }
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

      {/* Attendee-only, once-per-session notice explaining up front why
          YouTube's own controls are disabled and where quality/speed
          actually live — admins already know this, so it's skipped for them. */}
      {!isAdmin && <ProtectedEnvironmentNotice />}

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

        {/* Live / Playback / Offline status badge */}
        <div className={`inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-full border shrink-0 ${
          streamConfig.is_playback_mode
            ? 'text-amber-400 bg-amber-500/10 border-amber-500/25'
            : streamConfig.is_live
            ? 'text-red-400 bg-red-500/10 border-red-500/25'
            : 'text-slate-500 bg-slate-800/60 border-white/10'
        }`}>
          {streamConfig.is_playback_mode ? (
            <Clock className="w-3 h-3" />
          ) : (
            <span className={`w-2 h-2 rounded-full ${streamConfig.is_live ? 'bg-red-500 animate-pulse' : 'bg-slate-600'}`} />
          )}
          {streamConfig.is_playback_mode ? 'Playback Mode' : streamConfig.is_live ? 'Broadcasting Live' : 'Not Live'}
        </div>
      </div>

      {/* Content area — fills remaining height strictly on desktop (no outer
          scroll); on mobile the two panels stack and this area itself
          scrolls, since a stacked player + Q&A list is taller than one
          screen and each panel below needs a real (not auto/0) height for
          its own internal layout to work. */}
      <div className="flex-1 min-h-0 flex flex-col lg:flex-row overflow-y-auto lg:overflow-hidden">

        {/* Left: Video Player container */}
        <div className="w-full lg:flex-1 lg:min-w-0 flex flex-col shrink-0 lg:shrink lg:h-full overflow-hidden bg-slate-950">
          <ProtectedPlayer
            videoId={streamConfig.youtube_video_id}
            title={streamConfig.title}
            isLive={isPlayerVisible}
            isPlaybackMode={streamConfig.is_playback_mode}
            offlineImageUrl={streamConfig.offline_image_url}
            offlineMessage={streamConfig.offline_message}
          />
        </div>

        {/* Right: Q&A Panel container — needs an explicit height on mobile
            (not h-auto) because QnAPanel itself is `h-full` with an internal
            `flex-1 overflow-y-auto` message list; against an auto-height
            ancestor that h-full resolves to 0, collapsing the whole panel.
            Q&A only works while actually live — not during playback of a
            past recording, and not while fully offline — so the panel
            itself is swapped for an explanatory placeholder the rest of
            the time, keeping the same footprint either way. */}
        <div className="w-full lg:w-[360px] xl:w-[400px] shrink-0 flex flex-col border-t border-white/8 lg:border-t-0 lg:border-l lg:border-white/8 h-[70vh] lg:h-full overflow-hidden">
          {streamConfig.is_live ? (
            <QnAPanel />
          ) : (
            <div className="qna-panel flex flex-col items-center justify-center h-full max-h-full bg-slate-900 text-center px-6 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-slate-800 border border-white/10 text-slate-500 flex items-center justify-center">
                <MessageSquare className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-300">Q&amp;A Unavailable</h3>
                <p className="text-slate-500 text-xs mt-1 leading-relaxed">
                  {streamConfig.is_playback_mode
                    ? "Q&A is only open during the live broadcast, not while watching the recording back."
                    : "Q&A opens once the live broadcast starts."}
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
