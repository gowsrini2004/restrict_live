import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize2,
  ShieldAlert, Radio, Clock, SkipForward, Settings2,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

interface ProtectedPlayerProps {
  videoId: string;
  title?: string;
  isLive?: boolean;
  // Admin-controlled, backend-driven flag (StreamConfig.is_playback_mode) —
  // set once a broadcast has ended so viewers can log in and watch the
  // recording back. Same protected chrome as live, just with every
  // "LIVE"/"Go Live" signal replaced by a neutral "Playback" label, since
  // there is no live edge to jump back to once the stream is over.
  isPlaybackMode?: boolean;
  offlineImageUrl?: string;
  offlineMessage?: string;
}

// Consider playback "live" once within this many seconds of the broadcast's
// leading edge — matches YouTube's own DVR live-edge granularity.
const LIVE_EDGE_THRESHOLD_SECONDS = 12;

/* YouTube's explicit setPlaybackQuality()/setPlaybackRate() calls are only
 * ever hints — confirmed unreliable in practice: even a resize-based nudge
 * technique couldn't reliably reach a specific quality tier a viewer's own
 * connection could plainly sustain (proven by the same tier loading fine on
 * youtube.com directly). The ONLY thing that reliably works is a genuine
 * user click on YouTube's OWN settings menu — that's an internal code path
 * inside YouTube's player that no embedder's JS can trigger. So instead of
 * fighting the API, we expose a small real click-through window onto
 * YouTube's native settings-gear cluster (quality + speed live in the same
 * menu there), while keeping everything else — play/pause, volume, the DVR
 * timeline, fullscreen — fully custom. See the click-catcher in the render
 * below for how the window is carved out.
 *
 * Confirmed (visually, on a real embed) that this cluster renders in the
 * TOP-right of the video, not the bottom — the "Protected" badge that used
 * to live there was moved to the top-LEFT to make room. These sizes are
 * still estimates — YouTube doesn't publish exact control-bar dimensions
 * and can change its player UI without notice, so nudge after checking a
 * real embed if the gear isn't quite inside the window. */
const NATIVE_CONTROLS_ZONE_HEIGHT_PX = 50;
// Width of the exposed click-through window — sized to cover the settings
// gear (quality + speed).
const NATIVE_CONTROLS_ZONE_WIDTH_PX = 96;
// Width deliberately left BLOCKED at the very right edge (YouTube's own
// logo/watermark, and — for the bottom bar's fullscreen icon in the
// unlikely event this ever needs re-tuning there instead) — kept covered
// on purpose so it can't lead a viewer back toward YouTube's own chrome.
const NATIVE_CONTROLS_ZONE_RIGHT_OFFSET_PX = 48;

const formatTime = (totalSeconds: number): string => {
  if (!isFinite(totalSeconds) || totalSeconds < 0) return '0:00';
  const s = Math.floor(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/* Loads the official YouTube IFrame Player API script exactly once, shared
 * across every ProtectedPlayer instance on the page. This gives us real,
 * documented methods (getCurrentTime/getDuration/seekTo/...) instead of
 * hand-parsing YouTube's undocumented internal postMessage protocol, which
 * is unreliable — e.g. it can silently omit `duration` for some streams. */
let youtubeApiPromise: Promise<void> | null = null;
const loadYouTubeIframeAPI = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve();
  const w = window as any;
  if (w.YT && w.YT.Player) return Promise.resolve();
  if (youtubeApiPromise) return youtubeApiPromise;

  youtubeApiPromise = new Promise((resolve) => {
    const previousCallback = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      if (typeof previousCallback === 'function') previousCallback();
      resolve();
    };
    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(tag);
  });
  return youtubeApiPromise;
};

const PLAYER_POLL_INTERVAL_MS = 400;
const SEEK_SETTLE_GRACE_MS = 1500;
// How long fullscreen controls stay visible after the last mouse/touch
// activity, while playing, before fading out — matches YouTube's own timing.
const CONTROLS_AUTO_HIDE_MS = 3000;
// How far the real post-seek position is allowed to differ from what we
// asked for before we treat it as YouTube having rejected the seek (i.e.
// the requested point is outside this stream's actual DVR retention window).
const SEEK_VERIFY_TOLERANCE_SECONDS = 20;

export const ProtectedPlayer: React.FC<ProtectedPlayerProps> = ({
  videoId,
  title = 'International Retreat 2026 — Live Stream',
  isLive = true,
  isPlaybackMode = false,
  offlineImageUrl = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80',
  offlineMessage  = 'The live broadcast is currently offline. Please stay tuned for the next session.',
}) => {
  const { showWarning } = useToast();

  const containerRef  = useRef<HTMLDivElement>(null);
  const playerMountRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const iframeElRef = useRef<HTMLIFrameElement | null>(null);
  const aspectVideoRef = useRef<HTMLDivElement>(null);

  const [isPlaying,       setIsPlaying]       = useState(true);
  const [isMuted,         setIsMuted]         = useState(false);
  const [volume,          setVolume]          = useState(80);
  const [isFullscreen,    setIsFullscreen]    = useState(false);

  // Timeline / DVR-seek state
  const [currentTime,   setCurrentTime]   = useState(0);
  const [duration,      setDuration]      = useState(0);
  const [isAtLiveEdge,  setIsAtLiveEdge]  = useState(true);
  // Earliest point we've confirmed the stream can actually seek back to —
  // discovered dynamically the first time a rewind request gets rejected.
  const [minSeekable,   setMinSeekable]   = useState(0);
  // Fullscreen auto-hide: controls fade out after inactivity while playing,
  // and reappear (in place — nothing is unmounted) on any mouse/touch activity.
  const [controlsVisible, setControlsVisible] = useState(true);

  // Refs mirroring latest state so the postMessage listener (registered once)
  // always reads current values instead of a stale closure.
  const isMutedRef = useRef(isMuted);
  const volumeRef = useRef(volume);

  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isScrubbingRef = useRef(false);
  const wasAtLiveEdgeRef = useRef(true);
  // Mirrors the isPlaybackMode prop for the poll/seek callbacks below (which
  // are set up with stable deps and read refs rather than closing over
  // props). In playback mode there's no live edge at all — no locking speed
  // near the end of the recording, no "Go Live" jump — so every site that
  // computes/acts on isAtLiveEdge is gated on this being false first.
  const isPlaybackModeRef = useRef(isPlaybackMode);
  useEffect(() => { isPlaybackModeRef.current = isPlaybackMode; }, [isPlaybackMode]);
  // Entering playback mode: there's no live edge to be "at", so clear it
  // immediately rather than waiting for the next poll tick to notice.
  useEffect(() => {
    if (isPlaybackMode) {
      wasAtLiveEdgeRef.current = false;
      setIsAtLiveEdge(false);
    }
  }, [isPlaybackMode]);
  // While a manual seek is settling, YouTube's getCurrentTime() can still
  // briefly report the pre-seek position — trust our own optimistic value
  // instead of the poll during this window, to stop the thumb/LIVE badge
  // from snapping back right after the user releases the scrubber.
  const lastManualSeekAtRef = useRef(0);
  // Safety valve: if a drag's release event is ever missed (e.g. pointer
  // released outside the window), don't let the timeline freeze forever.
  const scrubStartedAtRef = useRef(0);
  const minSeekableRef = useRef(0);
  const seekVerifyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideControlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { minSeekableRef.current = minSeekable; }, [minSeekable]);
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);

  useEffect(() => {
    const onChange = () => {
      const isFS = !!document.fullscreenElement;
      setIsFullscreen(isFS);
      if (!isFS && window.screen?.orientation?.unlock) {
        try {
          window.screen.orientation.unlock();
        } catch (e) {
          /* ignore */
        }
      }
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  const clearHideControlsTimer = () => {
    if (hideControlsTimeoutRef.current) {
      clearTimeout(hideControlsTimeoutRef.current);
      hideControlsTimeoutRef.current = null;
    }
  };

  const scheduleControlsAutoHide = () => {
    clearHideControlsTimer();
    hideControlsTimeoutRef.current = setTimeout(() => setControlsVisible(false), CONTROLS_AUTO_HIDE_MS);
  };

  /* Any mouse/touch activity brings fullscreen controls back exactly where
   * they were (nothing is unmounted — just a fade), and restarts the
   * inactivity countdown while playing. Paused playback always stays visible. */
  const handleControlsActivity = () => {
    setControlsVisible(true);
    if (isFullscreen && isPlaying) {
      scheduleControlsAutoHide();
    } else {
      clearHideControlsTimer();
    }
  };

  /* Reset visibility whenever fullscreen or play/pause state changes. */
  useEffect(() => {
    if (!isFullscreen) {
      setControlsVisible(true);
      clearHideControlsTimer();
      return;
    }
    setControlsVisible(true);
    if (isPlaying) {
      scheduleControlsAutoHide();
    } else {
      clearHideControlsTimer();
    }
    return clearHideControlsTimer;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFullscreen, isPlaying]);

  useEffect(() => clearHideControlsTimer, []);

  /* Compute the amber-filled gradient for a slider track given a 0-100 percentage */
  const trackGradientStyle = useCallback((pct: number): React.CSSProperties => ({
    background: `linear-gradient(to right, #f59e0b ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
  }), []);

  const sliderTrackStyle = useCallback((val: number): React.CSSProperties => {
    return trackGradientStyle(isMuted ? 0 : val);
  }, [isMuted, trackGradientStyle]);

  // Apply our desired mute/volume to whatever player instance is currently
  // loaded (fresh load or after a videoId change). A freshly loaded player
  // always starts at the live edge at 1x.
  const applyDesiredPlaybackState = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      if (isMutedRef.current) {
        player.mute();
      } else {
        player.unMute();
        player.setVolume(volumeRef.current);
      }
    } catch {
      /* player not fully initialized yet */
    }
  }, []);

  /* Poll the real YouTube player state (not just our optimistic local state)
   * via the official, documented getter methods — so the UI (timeline
   * position, live-edge badge, mute/volume) never drifts from what is
   * actually audible/visible. Quality and speed are no longer tracked here —
   * both are handled entirely by YouTube's own native settings menu now. */
  const pollPlayerState = useCallback(() => {
    const player = playerRef.current;
    if (!player || typeof player.getCurrentTime !== 'function') return;

    // If a drag's mouseup/touchend was somehow missed, don't let the
    // timeline stay frozen indefinitely.
    if (isScrubbingRef.current && Date.now() - scrubStartedAtRef.current > 8000) {
      isScrubbingRef.current = false;
    }

    try {
      const dur = player.getDuration();
      if (typeof dur === 'number' && dur > 0) {
        durationRef.current = dur;
        setDuration(dur);
      }

      // Right after a manual seek, YouTube can briefly keep reporting the
      // pre-seek position while it settles — ignore polled time/edge state
      // during that short window so the UI doesn't snap back.
      const isSettlingSeek = Date.now() - lastManualSeekAtRef.current < SEEK_SETTLE_GRACE_MS;

      if (!isScrubbingRef.current && !isSettlingSeek) {
        const cur = player.getCurrentTime();
        if (typeof cur === 'number') {
          currentTimeRef.current = cur;
          setCurrentTime(cur);
        }
      }

      if (!isPlaybackModeRef.current && durationRef.current > 0 && !isScrubbingRef.current && !isSettlingSeek) {
        const atEdge = (durationRef.current - currentTimeRef.current) < LIVE_EDGE_THRESHOLD_SECONDS;
        if (atEdge !== wasAtLiveEdgeRef.current) {
          wasAtLiveEdgeRef.current = atEdge;
          setIsAtLiveEdge(atEdge);
        }
      }

      const muted = player.isMuted();
      if (typeof muted === 'boolean' && muted !== isMutedRef.current) {
        setIsMuted(muted);
      }
      if (!muted) {
        const vol = player.getVolume();
        if (typeof vol === 'number' && vol !== volumeRef.current) {
          setVolume(vol);
        }
      }
    } catch {
      /* transient — player may be mid-reload */
    }
  }, []);

  /* Create (and tear down) the real YT.Player instance whenever the video
   * or live/offline visibility changes. controls=1 so YouTube's own native
   * control bar renders — we don't show most of it (see the click-catcher
   * in the render below, which blocks everywhere except a small window
   * onto the real settings gear), but the gear itself needs YouTube's own
   * controls actually present to exist at all. */
  useEffect(() => {
    if (!isLive) return;
    let cancelled = false;
    let pollHandle: ReturnType<typeof setInterval> | null = null;

    loadYouTubeIframeAPI().then(() => {
      if (cancelled || !playerMountRef.current) return;
      const YT = (window as any).YT;

      playerRef.current = new YT.Player(playerMountRef.current, {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            const iframeEl = event.target?.getIframe?.();
            if (iframeEl) {
              iframeEl.className = 'absolute inset-0 w-full h-full border-0';
              // Pointer events ARE enabled now (unlike the old controls=0
              // setup) — the click-catcher rectangles rendered on top of
              // this iframe cover everywhere except the native settings-gear
              // window, so only that small region actually reaches through
              // to real YouTube controls; everywhere else is still fully
              // blocked by our own overlays sitting above it.
              iframeEl.style.pointerEvents = 'auto';
              iframeEl.title = title;
              iframeElRef.current = iframeEl;
            }
            applyDesiredPlaybackState();
            pollHandle = setInterval(pollPlayerState, PLAYER_POLL_INTERVAL_MS);
          },
          onStateChange: (event: any) => {
            const state = event.data;
            if (state === YT.PlayerState.PLAYING) setIsPlaying(true);
            else if (state === YT.PlayerState.PAUSED) setIsPlaying(false);
          },
        },
      });
    });

    return () => {
      cancelled = true;
      if (pollHandle) clearInterval(pollHandle);
      if (playerRef.current?.destroy) {
        try { playerRef.current.destroy(); } catch { /* ignore */ }
      }
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, isLive]);

  const togglePlay = () => {
    if (isPlaying) { playerRef.current?.pauseVideo(); setIsPlaying(false); }
    else           { playerRef.current?.playVideo();  setIsPlaying(true);  }
  };

  const toggleMute = () => {
    if (isMuted) { playerRef.current?.unMute(); playerRef.current?.setVolume(volume); setIsMuted(false); }
    else         { playerRef.current?.mute();                                          setIsMuted(true);  }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (v === 0) { playerRef.current?.mute();   setIsMuted(true);  }
    else         { playerRef.current?.unMute(); playerRef.current?.setVolume(v); setIsMuted(false); }
  };

  /* Mark scrubbing the instant the user grabs the thumb/track — before the
   * value has even changed — so a poll tick that lands mid-gesture can't
   * overwrite the input's value out from under the user's own drag. */
  const handleScrubStart = () => {
    isScrubbingRef.current = true;
    scrubStartedAtRef.current = Date.now();
  };

  /* Continuous drag preview — do not seek yet, just move the thumb/label. */
  const handleScrubInput = (e: React.FormEvent<HTMLInputElement>) => {
    isScrubbingRef.current = true;
    setCurrentTime(Number(e.currentTarget.value));
  };

  const applyAtEdgeState = (atEdge: boolean) => {
    // No live edge in playback mode — never show live UI, regardless of how
    // close the scrub position is to the recording's end.
    const effectiveAtEdge = isPlaybackModeRef.current ? false : atEdge;
    wasAtLiveEdgeRef.current = effectiveAtEdge;
    setIsAtLiveEdge(effectiveAtEdge);
  };

  /* After a seek settles, confirm the player actually landed where we asked.
   * Some live streams only retain a limited DVR window — requesting a point
   * further back than that gets silently clamped by YouTube instead of
   * erroring, which otherwise shows up as an unexplained "snap back". When
   * that happens we remember the real boundary and tell the viewer why. */
  const scheduleSeekVerification = (requestedTarget: number, isRewindAttempt: boolean) => {
    if (seekVerifyTimeoutRef.current) clearTimeout(seekVerifyTimeoutRef.current);
    seekVerifyTimeoutRef.current = setTimeout(() => {
      const player = playerRef.current;
      if (!player || isScrubbingRef.current) return;
      try {
        const actual = player.getCurrentTime();
        if (typeof actual !== 'number') return;

        const mismatch = actual - requestedTarget;
        if (isRewindAttempt && mismatch > SEEK_VERIFY_TOLERANCE_SECONDS) {
          // Asked to rewind further than the stream actually retains —
          // YouTube landed later than requested. Remember that boundary.
          setMinSeekable(actual);
          minSeekableRef.current = actual;
          showWarning(
            'Rewind Limit Reached',
            "This stream's replay doesn't go back that far — jumped to the earliest point still available."
          );
        }

        currentTimeRef.current = actual;
        setCurrentTime(actual);
        const atEdge = durationRef.current > 0 && (durationRef.current - actual) < LIVE_EDGE_THRESHOLD_SECONDS;
        applyAtEdgeState(atEdge);
      } catch {
        /* ignore — player mid-transition */
      }
    }, SEEK_SETTLE_GRACE_MS + 200);
  };

  /* Commit the seek once the user releases the scrubber. */
  const commitScrub = (e: React.SyntheticEvent<HTMLInputElement>) => {
    const raw = Number(e.currentTarget.value);
    const max = durationRef.current > 0 ? durationRef.current : raw;
    const clamped = Math.min(Math.max(raw, minSeekableRef.current), max);
    playerRef.current?.seekTo(clamped, true);
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
    isScrubbingRef.current = false;
    lastManualSeekAtRef.current = Date.now();

    // Decide LIVE vs behind-live immediately from the seek target itself,
    // rather than waiting for a poll readback that may still be stale.
    const atEdge = durationRef.current > 0 && (durationRef.current - clamped) < LIVE_EDGE_THRESHOLD_SECONDS;
    applyAtEdgeState(atEdge);
    scheduleSeekVerification(clamped, !atEdge);
  };

  const handleJumpToLive = () => {
    // Seek well past the last-known duration so YouTube snaps fully to the
    // live edge rather than landing just short of it.
    const knownLiveEdge = durationRef.current;
    playerRef.current?.seekTo(knownLiveEdge + 30, true);
    playerRef.current?.playVideo();
    setIsPlaying(true);
    currentTimeRef.current = knownLiveEdge;
    setCurrentTime(knownLiveEdge);
    lastManualSeekAtRef.current = Date.now();
    applyAtEdgeState(true);
    scheduleSeekVerification(knownLiveEdge, false);
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;

    if (document.fullscreenElement) {
      if (document.exitFullscreen) {
        await document.exitFullscreen();
      }
      if (window.screen?.orientation?.unlock) {
        try { window.screen.orientation.unlock(); } catch (e) { /* ignore */ }
      }
    } else {
      try {
        const elem = containerRef.current as any;
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
          await elem.webkitRequestFullscreen();
        } else if (elem.msRequestFullscreen) {
          await elem.msRequestFullscreen();
        }

        // Lock screen orientation to landscape on mobile phones
        if (window.screen?.orientation && 'lock' in window.screen.orientation) {
          try {
            await (window.screen.orientation as any).lock('landscape');
          } catch (e) {
            console.log('Orientation lock not supported on this device/browser:', e);
          }
        }
      } catch (err) {
        console.error('Fullscreen request failed:', err);
      }
    }
  };

  /* YouTube-style scrubber row: seek within the live DVR window + Go-Live pill. */
  const renderTimelineRow = () => {
    const safeDuration = Math.max(duration, minSeekable + 1, 1);
    const range = Math.max(safeDuration - minSeekable, 1);
    const pct = duration > 0 ? Math.min(100, Math.max(0, ((currentTime - minSeekable) / range) * 100)) : 0;
    return (
      <div className="flex items-center gap-1.5 sm:gap-2.5">
        {/* Left: fixed stream start. Right: where you are now — your scrub
            position, or the live running time while at the live edge. */}
        <span className="text-[9px] sm:text-[10px] text-slate-400 font-mono tabular-nums w-7 sm:w-10 text-right shrink-0">
          {formatTime(minSeekable)}
        </span>
        <input
          type="range"
          min={minSeekable}
          max={safeDuration}
          step={1}
          value={Math.min(Math.max(currentTime, minSeekable), safeDuration)}
          onMouseDown={handleScrubStart}
          onTouchStart={handleScrubStart}
          onKeyDown={handleScrubStart}
          onInput={handleScrubInput}
          onMouseUp={commitScrub}
          onTouchEnd={commitScrub}
          onKeyUp={commitScrub}
          className="timeline-slider w-full min-w-0"
          style={trackGradientStyle(pct)}
          aria-label="Seek stream timeline"
        />
        <span className="text-[9px] sm:text-[10px] text-slate-400 font-mono tabular-nums w-7 sm:w-10 shrink-0">
          {formatTime(currentTime)}
        </span>
        {isPlaybackMode ? (
          // No live edge to show or jump to once the broadcast has ended —
          // a neutral, static badge instead of any LIVE/Go-Live signal.
          <span className="inline-flex items-center gap-1 px-1.5 sm:px-2.5 py-1 rounded-full bg-slate-800 text-slate-200 font-bold text-[9px] sm:text-[10px] uppercase tracking-widest shrink-0 border border-white/10">
            <Clock className="w-3 h-3 text-amber-400" /> <span className="hidden sm:inline">Playback</span>
          </span>
        ) : isAtLiveEdge ? (
          <span className="inline-flex items-center gap-1 px-1.5 sm:px-2.5 py-1 rounded-full bg-red-600 text-white font-bold text-[9px] sm:text-[10px] uppercase tracking-widest shrink-0 animate-pulse">
            <Radio className="w-3 h-3" /> <span className="hidden sm:inline">LIVE</span>
          </span>
        ) : (
          <button
            onClick={handleJumpToLive}
            className="inline-flex items-center gap-1 px-1.5 sm:px-2.5 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-[9px] sm:text-[10px] uppercase tracking-widest border border-white/10 transition-all active:scale-95 shrink-0"
            title="Jump back to the live broadcast"
          >
            <SkipForward className="w-3 h-3 text-amber-400" /> <span className="hidden sm:inline">Go Live</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`protected-player-container relative bg-black select-none flex flex-col justify-between overflow-hidden ${
        isFullscreen ? 'w-screen h-screen fixed inset-0 z-50' : 'w-full h-full min-h-[240px]'
      } ${isFullscreen && !controlsVisible ? 'cursor-none' : ''}`}
      onContextMenu={(e) => e.preventDefault()}
      onMouseMove={handleControlsActivity}
      onTouchStart={handleControlsActivity}
      onClick={handleControlsActivity}
    >
      {/* ── 16:9 Video Container — fits available height strictly ──────── */}
      <div className="relative w-full flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden">
        {/* This wrapper (and playerMountRef inside it) is ALWAYS mounted,
            never conditionally removed by React — only hidden via CSS when
            offline. The official YT.Player API REPLACES the DOM node it's
            given with its own <iframe>, entirely outside React's knowledge.
            If React itself ever tries to unmount/remove that node (e.g. the
            old isLive ? (...) : (...) ternary did, swapping to the offline
            banner), it throws "Failed to execute 'removeChild': the node to
            be removed is not a child of this node" — React's fiber tree
            still expects the plain div it originally rendered, but YouTube
            already swapped it out, and by the time React tries to clean it
            up the DOM no longer matches. Never asking React to remove this
            subtree avoids the crash entirely, regardless of live/offline. */}
        <div
          ref={aspectVideoRef}
          className={`relative w-full h-full max-w-full max-h-full aspect-video items-center justify-center overflow-hidden ${isLive ? 'flex' : 'hidden'}`}
        >
          {/* The official YT.Player API replaces this node with its own
              managed <iframe>, styled/sized via the onReady handler above. */}
          <div ref={playerMountRef} className="absolute inset-0 w-full h-full" />

          {isLive && (
          <>
            {/* Top overlay — hides YouTube logo/title. "Protected" badge
                lives on the LEFT now (was right), since the right side of
                this same row is where YouTube's real settings gear renders
                — see the native-controls hot zone + hint badge below. The
                gradient itself stops short of that zone so the gear isn't
                visually darkened. Fades out with the rest of the chrome on
                fullscreen inactivity. */}
            <div className={`absolute top-0 left-0 h-16 bg-gradient-to-b from-black/85 to-transparent z-20 flex items-center gap-3 px-3 sm:px-4 pointer-events-auto transition-opacity duration-300 ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
              style={{ right: NATIVE_CONTROLS_ZONE_WIDTH_PX + NATIVE_CONTROLS_ZONE_RIGHT_OFFSET_PX }}
            >
              {!isFullscreen && (
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-black/50 px-2.5 py-1 rounded-full border border-amber-500/25 backdrop-blur">
                  <ShieldAlert className="w-3 h-3" /> Protected
                </span>
              )}
            </div>

            {/* Small hint badge sitting just left of the native-controls
                window, pointer-events-none so it never blocks the click-
                through gap next to it — same visual language as the
                "Protected" badge, just pointing at where quality/speed
                actually live now. */}
            <div className={`absolute top-2 sm:top-3 z-20 pointer-events-none transition-opacity duration-300 ${
              controlsVisible ? 'opacity-100' : 'opacity-0'
            }`}
              style={{ right: NATIVE_CONTROLS_ZONE_WIDTH_PX + NATIVE_CONTROLS_ZONE_RIGHT_OFFSET_PX + 8 }}
            >
              <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-black/50 px-2.5 py-1 rounded-full border border-amber-500/25 backdrop-blur whitespace-nowrap">
                <Settings2 className="w-3 h-3" /> Click ⚙ for Quality/Speed
              </span>
            </div>

            {/* Bottom shield — hides YouTube's own seek bar/branding. Full
                width now — the native-controls window moved to the TOP, so
                the bottom needs no gap. */}
            <div className="absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-black to-transparent z-20 pointer-events-none" />

            {/* Click-to-play catcher, tiled as three rectangles instead of
                one full-coverage div, deliberately leaving a small window
                uncovered over YouTube's native captions+settings icons (see
                NATIVE_CONTROLS_ZONE_* above) — confirmed to render in the
                TOP-right of the video, not the bottom. Clicks in that gap
                fall through to the real iframe underneath (pointer-events:
                auto, set in onReady) instead of being captured here, so the
                native quality/speed menu is genuinely clickable. Whatever
                sits at the very top-right edge beyond the gear (YouTube's
                own logo/watermark) stays deliberately covered. */}
            <div
              className="absolute bottom-0 left-0 right-0 z-10 cursor-pointer"
              style={{ top: NATIVE_CONTROLS_ZONE_HEIGHT_PX }}
              onClick={togglePlay}
            />
            <div
              className="absolute top-0 left-0 z-10 cursor-pointer"
              style={{ height: NATIVE_CONTROLS_ZONE_HEIGHT_PX, right: NATIVE_CONTROLS_ZONE_WIDTH_PX + NATIVE_CONTROLS_ZONE_RIGHT_OFFSET_PX }}
              onClick={togglePlay}
            />
            <div
              className="absolute top-0 right-0 z-10 cursor-pointer"
              style={{ height: NATIVE_CONTROLS_ZONE_HEIGHT_PX, width: NATIVE_CONTROLS_ZONE_RIGHT_OFFSET_PX }}
              onClick={togglePlay}
            />

            {/* Fullscreen bottom overlay — timeline, play/pause, volume &
                exit-fullscreen; fades out with the rest of the chrome on
                inactivity. Quality/speed are reached via the native window
                above, not shown here — YouTube's own control bar is visible
                at the bottom of the video itself in fullscreen too. */}
            {isFullscreen && (
              <div className={`absolute bottom-0 left-0 right-0 z-30 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-2 sm:px-4 pt-10 pb-2 sm:pb-3 space-y-1.5 sm:space-y-2.5 pointer-events-auto transition-opacity duration-300 ${
                controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}>
                {renderTimelineRow()}
                <div className="flex items-center justify-between gap-1.5 sm:gap-3">
                  <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
                    <button
                      onClick={togglePlay}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30 transition-all active:scale-90 shrink-0"
                      title={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying
                        ? <Pause className="w-4 h-4" />
                        : <Play  className="w-4 h-4 fill-current" />
                      }
                    </button>

                    <div className="flex items-center gap-1 sm:gap-2 bg-slate-900/90 border border-white/10 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-xl">
                      <button
                        onClick={toggleMute}
                        className="shrink-0 text-slate-400 hover:text-amber-400 transition-colors"
                        title={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted || volume === 0
                          ? <VolumeX className="w-4 h-4 text-red-400" />
                          : <Volume2 className="w-4 h-4" />
                        }
                      </button>

                      <div className="w-10 sm:w-24 flex items-center">
                        <input
                          type="range"
                          min={0}
                          max={100}
                          value={isMuted ? 0 : volume}
                          onChange={handleVolumeChange}
                          className="vol-slider w-full"
                          style={sliderTrackStyle(volume)}
                        />
                      </div>

                      <span className="hidden sm:inline w-6 text-right text-[10px] text-slate-400 font-mono shrink-0 tabular-nums">
                        {isMuted ? 0 : volume}%
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                    <button
                      onClick={toggleFullscreen}
                      className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-all shrink-0"
                      title="Exit Fullscreen"
                    >
                      <Minimize2 className="w-4 h-4 text-amber-400" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
          )}
        </div>

        {!isLive && (
          /* ── Offline banner ─────────────────────────────────────────── */
          <div className="relative w-full h-full min-h-[240px] z-20 flex items-center justify-center p-4 bg-slate-950">
            <img
              src={offlineImageUrl}
              alt="Offline"
              className="absolute inset-0 w-full h-full object-cover opacity-20 blur-sm"
            />
            {/* Solid background, no backdrop-filter — a `backdrop-blur-*`
                card stacked on top of an already-blurred image failed to
                paint at all in some browser/GPU environments (backdrop-
                filter support is far less consistent than plain filter),
                which looked like nothing but the blurred image was ever
                there. A plain opaque card can't have that failure mode. */}
            <div className="relative z-10 max-w-xs sm:max-w-sm w-full bg-slate-900 border border-white/10 rounded-2xl p-5 shadow-2xl text-center space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                <Clock className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <span className="inline-block px-3 py-1 rounded-full bg-slate-800 text-amber-400 font-bold text-[11px] uppercase tracking-wider border border-amber-500/20 mb-2">
                  Stream Offline
                </span>
                <h3 className="text-base font-extrabold text-white">{title}</h3>
                <p className="text-slate-400 text-sm mt-1 leading-relaxed">{offlineMessage}</p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Control Bar (Hidden in Fullscreen Mode — fullscreen has its own overlay bar) ── */}
      {isLive && !isFullscreen && (
        <div className="bg-slate-950 border-t border-white/10 px-2 sm:px-4 py-2 sm:py-2.5 space-y-1.5 sm:space-y-2 shrink-0">

        {renderTimelineRow()}

        <div className="flex items-center justify-between gap-1.5 sm:gap-3">

          {/* Left group: Play/Pause & Compact Volume Slider */}
          <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0">
            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30 transition-all active:scale-90 shrink-0"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying
                ? <Pause className="w-4 h-4" />
                : <Play  className="w-4 h-4 fill-current" />
              }
            </button>

            {/* Compact Volume Pill */}
            <div className="flex items-center gap-1 sm:gap-2 bg-slate-900/90 border border-white/10 px-1.5 sm:px-2.5 py-1 sm:py-1.5 rounded-xl">
              <button
                onClick={toggleMute}
                className="shrink-0 text-slate-400 hover:text-amber-400 transition-colors"
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted || volume === 0
                  ? <VolumeX className="w-4 h-4 text-red-400" />
                  : <Volume2 className="w-4 h-4" />
                }
              </button>

              <div className="w-10 sm:w-24 flex items-center">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="vol-slider w-full"
                  style={sliderTrackStyle(volume)}
                />
              </div>

              <span className="hidden sm:inline w-6 text-right text-[10px] text-slate-400 font-mono shrink-0 tabular-nums">
                {isMuted ? 0 : volume}%
              </span>
            </div>
          </div>

          {/* Center stream title indicator */}
          <div className="hidden sm:flex flex-1 min-w-0 items-center justify-center px-2">
            <span className="text-xs font-semibold text-slate-400 truncate max-w-[240px]">
              {title}
            </span>
          </div>

          {/* Right group: native-quality hint & Fullscreen. Quality/speed
              live in YouTube's own settings gear now (top-right corner of
              the video itself), not a custom dropdown here — see the
              NATIVE_CONTROLS_ZONE click-catcher gap above. */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <span
              className="hidden sm:flex h-8 sm:h-9 px-2 sm:px-3 rounded-xl items-center gap-1 sm:gap-1.5 bg-slate-900 text-slate-400 border border-white/10 text-[10px] sm:text-xs font-semibold shrink-0"
              title="Quality and playback speed are set from YouTube's own settings icon, in the top-right corner of the video."
            >
              <Settings2 className="w-3.5 h-3.5 text-amber-400" />
              Quality/Speed ↗
            </span>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-all shrink-0"
              title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            >
              {isFullscreen
                ? <Minimize2 className="w-4 h-4 text-amber-400" />
                : <Maximize  className="w-4 h-4" />
              }
            </button>
          </div>

        </div>
        </div>
      )}
    </div>
  );
};
