import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize2,
  ShieldAlert, Radio, Clock, Settings, Check, Sparkles,
  Gauge, SkipForward, CheckCircle2, Loader2,
} from 'lucide-react';
import { useToast } from '../context/ToastContext';

interface ProtectedPlayerProps {
  videoId: string;
  title?: string;
  isLive?: boolean;
  // Admin-controlled, backend-driven flag (StreamConfig.is_playback_mode) —
  // set once a broadcast has ended so viewers can log in and watch the
  // recording back. Same protected chrome/quality/speed controls as live,
  // just with every "LIVE"/"Go Live" signal replaced by a neutral
  // "Playback" label, since there is no live edge to lock speed to or jump
  // back to once the stream is over.
  isPlaybackMode?: boolean;
  offlineImageUrl?: string;
  offlineMessage?: string;
}

// Only 3 selectable tiers, and only these 3 are ever loaded — no 'auto'
// fallback, internal or otherwise. If the requested tier can't be reached,
// the retry system below steps DOWN this same list to the next-highest tier
// that still IS reachable, rather than ever handing control fully back to
// YouTube's own unconstrained adaptive pick.
const QUALITIES = [
  // 'hd2160' is YouTube's real identifier for 4K, reported by the live
  // onPlaybackQualityChange event. 'highres' is a separate, legacy tag
  // YouTube only uses for resolutions ABOVE 4K — using it here meant a
  // genuinely-achieved 4K stream could never match, so it looked stuck
  // "retrying" forever even when it was already actually playing at 4K.
  { label: '4K Ultra HD',   value: 'hd2160', badge: '4K' },
  { label: '2K Quad HD',    value: 'hd1440', badge: '2K' },
  { label: 'Full HD',       value: 'hd1080', badge: 'FHD' },
];

const QUALITY_STORAGE_KEY = 'protected_player_selected_quality';

/* YouTube's explicit setPlaybackQuality()/getPlaybackQuality()/
 * getAvailableQualityLevels() are officially no-ops as of their current
 * IFrame API docs — calling them has zero effect on playback. The only real
 * lever left is that YouTube's own adaptive algorithm picks resolution
 * partly from the iframe's actual rendered pixel size. So instead we render
 * the underlying player at the target resolution and CSS-scale it back down
 * to fit the visible area — a genuine nudge, not a guarantee (bandwidth
 * still matters, and no embed integration can force an exact resolution). */
const QUALITY_RESOLUTIONS: Record<string, { width: number; height: number }> = {
  hd2160:  { width: 3840, height: 2160 },
  hd1440:  { width: 2560, height: 1440 },
  hd1080:  { width: 1920, height: 1080 },
};

// Lowest → highest, used to tell whether YouTube actually delivered what was
// requested or had to substitute something lower (e.g. due to bandwidth).
// 'highres' (legacy, >4K) is kept as an alias ranked alongside 'hd2160' as a
// safety net in case some stream ever reports it instead.
const QUALITY_RANK: Record<string, number> = {
  tiny: 0, small: 1, medium: 2, large: 3, hd720: 4, hd1080: 5, hd1440: 6, hd2160: 7, highres: 7,
};

// YouTube isn't always consistent about which string it reports for the
// same real 4K playback — 'highres' and 'hd2160' can both show up for what
// is functionally identical quality. Collapse both to our one canonical
// key the instant we read a value FROM YouTube, so every comparison below
// (matches / rank / label) is immune to which one it happens to report.
const normalizeQualityValue = (value: string): string => (value === 'highres' ? 'hd2160' : value);

const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2];
// Consider playback "live" once within this many seconds of the broadcast's
// leading edge — matches YouTube's own DVR live-edge granularity.
const LIVE_EDGE_THRESHOLD_SECONDS = 12;

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
// While the real (verified) quality doesn't exactly match what the viewer
// asked for — too low (couldn't reach it) OR too high (YouTube over-served
// and needs pulling back down) — keep re-nudging on this cadence until it does.
// Note: YouTube's own ABR algorithm decides when it actually acts on a resize
// nudge, and it's often more reluctant to downgrade than to upgrade when
// bandwidth is healthy — so downscale requests can take longer to land than
// upscale ones even with a fast retry cadence; that lag is on YouTube's side.
const QUALITY_RETRY_INTERVAL_MS = 2500;
// After this many failed retry nudges at the SAME desired quality, stop
// nudging the existing player instance and force a real reinit instead — a
// genuinely fresh initial-size hint, the one thing YouTube's algorithm
// reliably listens to (see applyRenderResolution's `jiggle` comment above).
// Manual quality switches now reinit immediately (see handleQualitySelect),
// so this only guards the rarer case of YouTube's own ABR silently drifting
// away from an already-matched quality mid-stream.
const QUALITY_RETRY_RELOAD_THRESHOLD = 30;
// How many hard reinits we'll force for the SAME desired quality before
// giving up on it. Each reinit still targets what the viewer actually
// asked for (a reload never silently downgrades the request), so this is
// "try 3 fresh starts", not "retry then quietly settle for something else".
const QUALITY_MAX_RELOAD_ATTEMPTS = 3;
// Highest → lowest, exactly the 3 selectable tiers. Once all reinit
// attempts for a tier are exhausted, the retry system steps DOWN to the
// next entry here (the highest quality still realistically achievable)
// instead of ever giving up to an unconstrained 'auto'. FHD is the floor —
// if even that can't be reached, there's nowhere lower to fall to, so it
// just keeps retrying FHD.
const QUALITY_TIERS_DESC = QUALITIES.map((q) => q.value);

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
  const qualityRetryIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Tracks whether the last known state was "matched" so we only toast on
  // the transition (achieved / regressed), not on every retry tick.
  const wasQualityMatchedRef = useRef(true);
  const qualityMenuRef = useRef<HTMLDivElement>(null);
  const speedMenuRef   = useRef<HTMLDivElement>(null);

  const [isPlaying,       setIsPlaying]       = useState(true);
  const [isMuted,         setIsMuted]         = useState(false);
  const [volume,          setVolume]          = useState(80);
  const [isFullscreen,    setIsFullscreen]    = useState(false);
  const [selectedQuality, setSelectedQuality] = useState<string>(() => {
    // Migrate a preference saved before the 'highres'→'hd2160' fix, or one
    // pointing at a tier that's no longer offered (720p/480p/Low Data/Auto
    // were all dropped — only 4K/2K/FHD are selectable now) to the nearest
    // tier that's still selectable. Default is always 4K for everyone with
    // no (or no longer valid) saved preference.
    const migrate: Record<string, string> = {
      highres: 'hd2160',
      auto:    'hd2160',
      hd720:   'hd1080',
      large:   'hd1080',
      medium:  'hd1080',
      small:   'hd1080',
      tiny:    'hd1080',
    };
    try {
      const stored = localStorage.getItem(QUALITY_STORAGE_KEY);
      if (!stored) return 'hd2160';
      return migrate[stored] || stored;
    } catch {
      return 'hd2160';
    }
  });
  const [showQualityMenu, setShowQualityMenu] = useState<boolean>(false);

  // Timeline / DVR-seek & playback-speed state
  const [currentTime,   setCurrentTime]   = useState(0);
  const [duration,      setDuration]      = useState(0);
  const [isAtLiveEdge,  setIsAtLiveEdge]  = useState(true);
  const [playbackRate,  setPlaybackRate]  = useState(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);
  // Earliest point we've confirmed the stream can actually seek back to —
  // discovered dynamically the first time a rewind request gets rejected.
  const [minSeekable,   setMinSeekable]   = useState(0);
  // Fullscreen auto-hide: controls fade out after inactivity while playing,
  // and reappear (in place — nothing is unmounted) on any mouse/touch activity.
  const [controlsVisible, setControlsVisible] = useState(true);
  // Ground truth for what's actually playing, from YouTube's still-working
  // onPlaybackQualityChange event — not something we can fake or guess.
  const [actualQuality, setActualQuality] = useState<string>('auto');
  // In-player toast (shown inside the video overlay, not the app-wide corner
  // popup) for quality request/result messages.
  const [qualityToast, setQualityToast] = useState<string | null>(null);
  // How many retry nudges we've sent while not yet matching the request —
  // drives the visible "still trying" spinner/counter (not just a one-off
  // toast) so it's clear this is actively ongoing, not stuck or silent.
  const [qualityRetryAttempt, setQualityRetryAttempt] = useState(0);
  // Bumping this forces the player-creation effect to tear down and recreate
  // the YT.Player instance from scratch — our stand-in for "reload with the
  // target quality", since YouTube's embed has no real per-quality URL and a
  // true page reload would interrupt a live viewer's session/tab-lock state.
  const [playerReloadKey, setPlayerReloadKey] = useState(0);
  // How many hard reinits we've already forced while chasing the CURRENT
  // desired quality — each retry-threshold hit increments this; once it
  // reaches QUALITY_MAX_RELOAD_ATTEMPTS, we stop reinit-ing that quality
  // and step down to the next-lower of the 3 real tiers instead.
  const qualityReloadAttemptsRef = useRef(0);
  // Position/speed to restore right after a quality-triggered reinit — a
  // fresh YT.Player always starts back at the live edge at 1x, so without
  // this a quality switch while rewound into the DVR buffer would silently
  // yank the viewer back to live. `null` means "this load is a genuinely
  // new video/session, don't restore anything."
  const resumePositionRef = useRef<number | null>(null);
  const resumeRateRef = useRef<number>(1);

  // Refs mirroring latest state so the postMessage listener (registered once)
  // always reads current values instead of a stale closure.
  const isMutedRef = useRef(isMuted);
  const volumeRef = useRef(volume);
  const desiredQualityRef = useRef(selectedQuality);

  const currentTimeRef = useRef(0);
  const durationRef = useRef(0);
  const isScrubbingRef = useRef(false);
  const desiredPlaybackRateRef = useRef(1);
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
  useEffect(() => { desiredQualityRef.current = selectedQuality; }, [selectedQuality]);
  useEffect(() => { desiredPlaybackRateRef.current = playbackRate; }, [playbackRate]);

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

  /* Close quality/speed menus when clicking outside */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (qualityMenuRef.current && !qualityMenuRef.current.contains(e.target as Node)) {
        setShowQualityMenu(false);
      }
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false);
      }
    };
    if (showQualityMenu || showSpeedMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showQualityMenu, showSpeedMenu]);

  /* Compute the amber-filled gradient for a slider track given a 0-100 percentage */
  const trackGradientStyle = useCallback((pct: number): React.CSSProperties => ({
    background: `linear-gradient(to right, #f59e0b ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
  }), []);

  const sliderTrackStyle = useCallback((val: number): React.CSSProperties => {
    return trackGradientStyle(isMuted ? 0 : val);
  }, [isMuted, trackGradientStyle]);

  // Apply our desired mute/volume to whatever player instance is currently
  // loaded (fresh load or after a videoId change). A freshly loaded player
  // always starts at the live edge, so speed is reset to 1x — UNLESS this
  // load is actually a quality-triggered reinit resuming a specific
  // position/speed (resumePositionRef set), in which case the resume logic
  // in onReady re-asserts the real rate right after this runs. Quality
  // itself is handled separately via applyRenderResolution/setPlaybackQuality
  // below — YouTube's explicit quality setter is only ever a hint.
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
      if (resumePositionRef.current === null) {
        player.setPlaybackRate(1);
      }
    } catch {
      /* player not fully initialized yet */
    }
  }, []);

  /* Render the underlying player at the target resolution for the selected
   * quality (nudging YouTube's adaptive algorithm toward it), then CSS-scale
   * it back down so it still exactly fills the visible player area. 'auto'
   * renders at the real visible size — no artificial inflation. */
  /* `jiggle`: when retrying at an UNCHANGED target size, calling
   * player.setSize() with the exact same values it's already at is a no-op —
   * there's no real dimension change, so nothing tells YouTube's player to
   * re-evaluate its resolution choice (this is why a fresh page reload could
   * fix it — a genuinely new initial size hint — but repeated live retries
   * at the same size silently did nothing). Jiggling briefly perturbs the
   * size before snapping back, forcing a real resize each retry tick. */
  const applyRenderResolution = useCallback((jiggle: boolean = false) => {
    const player = playerRef.current;
    const iframeEl = iframeElRef.current;
    const container = aspectVideoRef.current;
    if (!player || !iframeEl || !container || typeof player.setSize !== 'function') return;

    const rect = container.getBoundingClientRect();
    const visibleWidth = Math.round(rect.width);
    const visibleHeight = Math.round(rect.height);
    if (!visibleWidth || !visibleHeight) return;

    const target = QUALITY_RESOLUTIONS[desiredQualityRef.current];

    const setSizeAndScale = (w: number, h: number) => {
      player.setSize(w, h);
      iframeEl.style.transformOrigin = 'top left';
      iframeEl.style.transform = `scale(${visibleWidth / w})`;
    };

    try {
      if (!target) {
        // Auto: no inflation, let YouTube pick naturally for the real size.
        player.setSize(visibleWidth, visibleHeight);
        iframeEl.style.transform = 'none';
        return;
      }
      if (jiggle) {
        setSizeAndScale(target.width - 4, target.height - 4);
        setTimeout(() => setSizeAndScale(target.width, target.height), 150);
      } else {
        setSizeAndScale(target.width, target.height);
      }
    } catch {
      /* transient — player mid-reload */
    }
  }, []);

  /* Keep pushing toward exactly what the viewer asked for — in EITHER
   * direction. If YouTube served less than requested (couldn't reach 4K),
   * keep retrying upward. If it served more than requested (e.g. picked
   * 720p when the viewer explicitly wants 360p to save data), pull it back
   * down too — a request for a specific quality should be honored, not
   * just treated as a minimum. Toasts fire only on state transitions. */
  useEffect(() => {
    const clearRetry = () => {
      if (qualityRetryIntervalRef.current) {
        clearInterval(qualityRetryIntervalRef.current);
        qualityRetryIntervalRef.current = null;
      }
    };

    // Nothing to enforce before any real reading has arrived yet
    // (onPlaybackQualityChange hasn't fired for this load yet — 'auto' here
    // is just that initial placeholder, never a chosen target).
    if (actualQuality === 'auto') {
      clearRetry();
      wasQualityMatchedRef.current = true;
      return clearRetry;
    }

    const matches = actualQuality === selectedQuality;
    // Only ever describe quality using our 3 badges — never YouTube's raw
    // internal quality string (e.g. 'large', 'medium', 'hd720'). Anything
    // YouTube reports below our floor tier still gets called "FHD", since
    // that's the lowest term we expose to viewers.
    const desiredLabel = QUALITIES.find((q) => q.value === selectedQuality)?.badge || 'FHD';
    const actualLabel = QUALITIES.find((q) => q.value === actualQuality)?.badge || 'FHD';
    const desiredRank = QUALITY_RANK[selectedQuality];
    const actualRank = QUALITY_RANK[actualQuality];
    const isOverDelivering = typeof desiredRank === 'number' && typeof actualRank === 'number' && actualRank > desiredRank;

    if (matches) {
      if (!wasQualityMatchedRef.current) {
        setQualityToast(`Now Showing: ${desiredLabel}`);
        setTimeout(() => setQualityToast(null), 3000);
      }
      wasQualityMatchedRef.current = true;
      setQualityRetryAttempt(0);
      qualityReloadAttemptsRef.current = 0;
      clearRetry();
    } else {
      if (wasQualityMatchedRef.current) {
        setQualityToast(
          isOverDelivering
            ? `Requested ${desiredLabel} — pulling down from ${actualLabel}`
            : `Requested ${desiredLabel} — showing ${actualLabel} for now`
        );
        setTimeout(() => setQualityToast(null), 3000);
        setQualityRetryAttempt(0);
      }
      wasQualityMatchedRef.current = false;

      if (!qualityRetryIntervalRef.current) {
        // Must pass jiggle=true explicitly — setInterval invokes the callback
        // with no arguments, so `applyRenderResolution` alone would silently
        // fall back to its jiggle=false default and retry with a no-op.
        qualityRetryIntervalRef.current = setInterval(() => {
          setQualityRetryAttempt((n) => {
            const next = n + 1;
            if (next < QUALITY_RETRY_RELOAD_THRESHOLD) {
              applyRenderResolution(true);
              return next;
            }

            // A run of nudges against the SAME live player instance did
            // nothing — stop nudging and force a genuinely fresh reinit
            // instead (see QUALITY_RETRY_RELOAD_THRESHOLD comment for why
            // that's the one thing that reliably makes YouTube re-evaluate
            // resolution). This still targets exactly what the viewer
            // originally asked for — a reload never silently downgrades it.
            if (qualityReloadAttemptsRef.current < QUALITY_MAX_RELOAD_ATTEMPTS) {
              qualityReloadAttemptsRef.current += 1;
              setQualityToast(
                `Still can't reach ${desiredLabel} — reloading player (${qualityReloadAttemptsRef.current}/${QUALITY_MAX_RELOAD_ATTEMPTS})…`
              );
              setTimeout(() => setQualityToast(null), 3000);
              resumePositionRef.current = currentTimeRef.current;
              resumeRateRef.current = desiredPlaybackRateRef.current;
              setPlayerReloadKey((k) => k + 1);
              return 0;
            }

            // Exhausted every reinit attempt and it STILL doesn't match —
            // step down to the next-highest tier that's realistically
            // achievable instead of retrying this one forever. Still one of
            // the 3 real tiers, never an unconstrained 'auto'.
            const tierIndex = QUALITY_TIERS_DESC.indexOf(selectedQuality);
            const nextLowerTier = tierIndex >= 0 ? QUALITY_TIERS_DESC[tierIndex + 1] : undefined;
            if (nextLowerTier) {
              const nextLabel = QUALITIES.find((q) => q.value === nextLowerTier)?.badge || 'FHD';
              setQualityToast(`Couldn't reach ${desiredLabel} after ${QUALITY_MAX_RELOAD_ATTEMPTS} reloads — switching to ${nextLabel}`);
              setTimeout(() => setQualityToast(null), 3000);
              desiredQualityRef.current = nextLowerTier;
              setSelectedQuality(nextLowerTier);
            }
            // Already at the lowest tier (FHD) — nothing left to step down
            // to, so just reset and keep retrying it at the normal cadence.
            qualityReloadAttemptsRef.current = 0;
            return 0;
          });
        }, QUALITY_RETRY_INTERVAL_MS);
      }
    }

    return clearRetry;
  }, [selectedQuality, actualQuality, applyRenderResolution]);

  /* Poll the real YouTube player state (not just our optimistic local state)
   * via the official, documented getter methods — so the UI never drifts
   * from what is actually audible/visible, and we keep re-asserting the
   * user's chosen quality/speed if YouTube reverts it. */
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
          // Speed isn't valid at the live edge — snap back to 1x, same as YouTube.
          if (atEdge && desiredPlaybackRateRef.current !== 1) {
            desiredPlaybackRateRef.current = 1;
            setPlaybackRate(1);
            player.setPlaybackRate(1);
          }
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

      if (!wasAtLiveEdgeRef.current) {
        const rate = player.getPlaybackRate();
        if (typeof rate === 'number' && rate !== desiredPlaybackRateRef.current) {
          desiredPlaybackRateRef.current = rate;
          setPlaybackRate(rate);
        }
      }
    } catch {
      /* transient — player may be mid-reload */
    }
  }, []);

  /* Create (and tear down) the real YT.Player instance whenever the video
   * or live/offline visibility changes. */
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
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onReady: (event: any) => {
            const iframeEl = event.target?.getIframe?.();
            if (iframeEl) {
              // No w-full/h-full here — the whole point is that this
              // element's actual box size can differ from the visible area
              // (see applyRenderResolution), which a 100% CSS size would override.
              iframeEl.className = 'absolute top-0 left-0 border-0';
              iframeEl.style.pointerEvents = 'none';
              iframeEl.style.transformOrigin = 'top left';
              iframeEl.title = title;
              iframeElRef.current = iframeEl;
            }
            applyDesiredPlaybackState();
            applyRenderResolution();
            // Cheap, harmless insurance alongside the resize technique — YouTube
            // treats this as a non-binding hint these days rather than a hard
            // setter, but passing it costs nothing and occasionally helps the
            // very first ABR decision land closer to what was requested.
            if (desiredQualityRef.current !== 'auto') {
              try { event.target.setPlaybackQuality?.(desiredQualityRef.current); } catch { /* ignore */ }
            }
            pollHandle = setInterval(pollPlayerState, PLAYER_POLL_INTERVAL_MS);

            // If this load is a quality-triggered reinit (not a brand new
            // video/session), restore the viewer's exact position and speed
            // instead of leaving them snapped back to the live edge at 1x —
            // give the fresh player a brief moment to actually start
            // buffering before seeking, or the seek can be silently dropped.
            if (resumePositionRef.current !== null) {
              const resumeAt = resumePositionRef.current;
              const resumeRate = resumeRateRef.current;
              resumePositionRef.current = null;
              setTimeout(() => {
                try {
                  event.target.seekTo(resumeAt, true);
                  if (resumeRate !== 1) event.target.setPlaybackRate(resumeRate);
                } catch { /* transient — player mid-reload */ }
              }, 400);
            }
          },
          onStateChange: (event: any) => {
            const state = event.data;
            if (state === YT.PlayerState.PLAYING) setIsPlaying(true);
            else if (state === YT.PlayerState.PAUSED) setIsPlaying(false);
          },
          // Still officially supported — the only real, honest way to know
          // what resolution YouTube actually ended up using.
          onPlaybackQualityChange: (event: any) => {
            if (typeof event.data === 'string') setActualQuality(normalizeQualityValue(event.data));
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
  }, [videoId, isLive, playerReloadKey]);

  /* Re-apply the render-resolution technique whenever the visible player
   * box actually changes size (window resize, entering/exiting fullscreen,
   * responsive layout shifts) — the scale factor is derived from that size. */
  useEffect(() => {
    const el = aspectVideoRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => applyRenderResolution());
    ro.observe(el);
    return () => ro.disconnect();
  }, [isLive, applyRenderResolution]);

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

  const handleQualitySelect = (val: string) => {
    setSelectedQuality(val);
    desiredQualityRef.current = val;
    try { localStorage.setItem(QUALITY_STORAGE_KEY, val); } catch { /* ignore */ }
    setShowQualityMenu(false);
    setQualityRetryAttempt(0);
    qualityReloadAttemptsRef.current = 0;
    setActualQuality('auto'); // clear stale reading immediately — the old value is about to be torn down anyway, and leaving it visible while a reinit is in flight misleadingly implies it's still live

    const targetObj = QUALITIES.find((q) => q.value === val) || QUALITIES[0];
    setQualityToast(`Switching to ${targetObj.badge}…`);
    setTimeout(() => setQualityToast(null), 3000);

    // Resizing the ALREADY-RUNNING player and waiting for YouTube's ABR to
    // notice was the slow/unreliable path (could take many retry cycles, or
    // never land, since ABR is reluctant to act on a size change alone mid-
    // stream). A genuinely fresh reinit — a new player instance whose very
    // FIRST size hint is the target resolution — is what YouTube's algorithm
    // actually listens to, so do that immediately on every manual switch
    // instead of trickling nudges in. Preserve exactly where the viewer is
    // (including if they're rewound into the DVR buffer) and their current
    // speed across the reinit, so this feels like a quality change, not a
    // "start over" — real YouTube also briefly rebuffers on a quality change,
    // so a short stutter here is expected, not a bug.
    resumePositionRef.current = currentTimeRef.current;
    resumeRateRef.current = desiredPlaybackRateRef.current;
    setPlayerReloadKey((k) => k + 1);
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
    // No live edge in playback mode — never lock speed or show live UI,
    // regardless of how close the scrub position is to the recording's end.
    const effectiveAtEdge = isPlaybackModeRef.current ? false : atEdge;
    wasAtLiveEdgeRef.current = effectiveAtEdge;
    setIsAtLiveEdge(effectiveAtEdge);
    if (effectiveAtEdge && desiredPlaybackRateRef.current !== 1) {
      desiredPlaybackRateRef.current = 1;
      setPlaybackRate(1);
      playerRef.current?.setPlaybackRate(1);
    }
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

  const handleSpeedSelect = (rate: number) => {
    if (isAtLiveEdge) return; // Speed only changeable while behind the live edge, like YouTube.
    desiredPlaybackRateRef.current = rate;
    setPlaybackRate(rate);
    setShowSpeedMenu(false);
    playerRef.current?.setPlaybackRate(rate);
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

  /* Playback-speed dropdown — disabled at the live edge, exactly like YouTube. */
  const renderSpeedDropdown = () => (
    <div className="relative" ref={speedMenuRef}>
      <button
        onClick={() => { if (!isAtLiveEdge) setShowSpeedMenu(!showSpeedMenu); }}
        disabled={isAtLiveEdge}
        className={`h-8 sm:h-9 px-2 sm:px-3 rounded-xl flex items-center gap-1 sm:gap-1.5 border transition-all shrink-0 text-xs font-semibold ${
          isAtLiveEdge
            ? 'bg-slate-900/60 text-slate-600 border-white/5 cursor-not-allowed'
            : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border-white/10'
        }`}
        title={isAtLiveEdge ? 'Rewind behind live to change playback speed' : 'Playback Speed'}
      >
        <Gauge className={`w-3.5 h-3.5 ${isAtLiveEdge ? 'text-slate-600' : 'text-amber-400'}`} />
        <span className={`font-extrabold text-[11px] ${isAtLiveEdge ? 'text-slate-600' : 'text-amber-400'}`}>
          {playbackRate}x
        </span>
      </button>

      {showSpeedMenu && !isAtLiveEdge && (
        <div className="absolute right-0 bottom-12 w-28 sm:w-36 max-w-[60vw] bg-slate-900/95 border border-white/15 rounded-xl sm:rounded-2xl p-1.5 sm:p-2 shadow-2xl backdrop-blur-xl z-50 space-y-1 animate-fadeIn max-h-[70vh] overflow-y-auto">
          <div className="px-2 sm:px-2.5 py-1 sm:py-1.5 text-[9px] sm:text-[10px] font-extrabold text-slate-400 uppercase tracking-wider border-b border-white/10">
            Speed
          </div>
          {SPEED_OPTIONS.map((rate) => (
            <button
              key={rate}
              onClick={() => handleSpeedSelect(rate)}
              className={`w-full flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-medium transition-all ${
                playbackRate === rate
                  ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30'
                  : 'text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              <span>{rate}x{rate === 1 ? ' (Normal)' : ''}</span>
              {playbackRate === rate && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  /* Stream quality dropdown — shared between the normal bar and the
   * fullscreen overlay bar (only one of the two is ever mounted at once).
   * The button shows the REAL, verified quality YouTube is actually using
   * (from onPlaybackQualityChange) — not just what you asked for — so you
   * can always tell whether your preference actually took effect. */
  const renderQualityDropdown = () => {
    // Only ever describe quality using our 3 badges (FHD/2K/4K) — never
    // YouTube's raw internal quality string, and never a bare "AUTO"/"LIVE"
    // placeholder either. Before the first real reading arrives, show what
    // we're targeting (the spinner already signals "still working").
    const desiredLabel = QUALITIES.find((q) => q.value === selectedQuality)?.badge || 'FHD';
    const actualObj = QUALITIES.find((q) => q.value === actualQuality);
    const actualLabel = actualObj ? actualObj.badge : (actualQuality === 'auto' ? desiredLabel : 'FHD');

    const desiredRank = QUALITY_RANK[selectedQuality];
    const actualRank = QUALITY_RANK[actualQuality];
    // A specific quality request must match exactly — playing HIGHER than
    // requested (e.g. 4K when 1080p was asked, to save data) is just as much
    // a mismatch as playing lower, and both keep getting corrected below.
    const gotExactlyWhatWasAsked = actualQuality === selectedQuality;
    const isOverDelivering =
      !gotExactlyWhatWasAsked && typeof desiredRank === 'number' && typeof actualRank === 'number' && actualRank > desiredRank;

    return (
      <div className="relative" ref={qualityMenuRef}>
        <button
          onClick={() => setShowQualityMenu(!showQualityMenu)}
          className="h-8 sm:h-9 px-2 sm:px-3 rounded-xl flex items-center gap-1 sm:gap-1.5 bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-all shrink-0 text-xs font-semibold"
          title={gotExactlyWhatWasAsked ? 'Now playing quality — click to change your preference' : `Still working on reaching ${desiredLabel}…`}
        >
          {gotExactlyWhatWasAsked
            ? <Settings className="w-3.5 h-3.5 text-amber-400" />
            : <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
          }
          <span className="text-amber-400 font-extrabold text-[11px] uppercase">{actualLabel}</span>
        </button>

        {showQualityMenu && (
          <div className="absolute right-0 bottom-12 w-52 sm:w-64 max-w-[78vw] bg-slate-900/95 border border-white/15 rounded-xl sm:rounded-2xl p-1.5 sm:p-2 shadow-2xl backdrop-blur-xl z-50 space-y-1 animate-fadeIn max-h-[70vh] overflow-y-auto">
            <div className="px-2 sm:px-2.5 py-1 sm:py-1.5 border-b border-white/10 space-y-1 sm:space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] sm:text-[10px] font-extrabold text-slate-400 uppercase tracking-wider">Quality</span>
                <Sparkles className="w-3 h-3 text-amber-400 hidden sm:block" />
              </div>
              {gotExactlyWhatWasAsked ? (
                <p className="flex items-start gap-1 sm:gap-1.5 text-[9px] sm:text-[10px] text-emerald-400 leading-snug font-semibold">
                  <CheckCircle2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 mt-px" />
                  <span>Now playing {actualLabel}.</span>
                </p>
              ) : (
                <p className="flex items-start gap-1 sm:gap-1.5 text-[9px] sm:text-[10px] text-amber-400 leading-snug font-semibold">
                  <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 mt-px animate-spin" />
                  <span>
                    {isOverDelivering
                      ? `Pulling down to ${desiredLabel} — now ${actualLabel}.`
                      : `Reaching for ${desiredLabel} — now ${actualLabel}.`}
                    {qualityRetryAttempt > 0 && (
                      <span className="text-slate-500"> (#{qualityRetryAttempt})</span>
                    )}
                  </span>
                </p>
              )}
              <p className="hidden sm:block text-[10px] text-slate-500 leading-snug">
                YouTube auto-adjusts for each viewer's connection — this sets a strong preference, not a guarantee.
              </p>
            </div>
            {QUALITIES.map((q) => (
              <button
                key={q.value}
                onClick={() => handleQualitySelect(q.value)}
                className={`w-full flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl text-[11px] sm:text-xs font-medium transition-all ${
                  selectedQuality === q.value
                    ? 'bg-amber-500/20 text-amber-400 font-bold border border-amber-500/30'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span>{q.label}</span>
                {selectedQuality === q.value && <Check className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
              </button>
            ))}
          </div>
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
        {isLive ? (
          <div ref={aspectVideoRef} className="relative w-full h-full max-w-full max-h-full aspect-video flex items-center justify-center overflow-hidden">
            {/* The official YT.Player API replaces this node with its own
                managed <iframe>, styled/sized via the onReady handler above. */}
            <div ref={playerMountRef} className="absolute inset-0 w-full h-full" />

            {/* Quality request/result toast — deliberately OUTSIDE the
                auto-hiding overlay below and never fades with it, so a
                status update firing while fullscreen controls are hidden
                (inactivity fade) is still actually seen. */}
            {qualityToast && (
              <div className="absolute top-2 sm:top-3 left-1/2 -translate-x-1/2 z-40 max-w-[85vw] sm:max-w-sm bg-slate-900/95 border border-amber-500/40 text-amber-400 font-extrabold text-[10px] sm:text-xs px-2.5 sm:px-3.5 py-1 sm:py-1.5 rounded-xl sm:rounded-full shadow-2xl backdrop-blur-xl flex items-center gap-1 sm:gap-1.5 animate-fadeIn pointer-events-none">
                <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-amber-400 shrink-0" />
                <span className="leading-snug">{qualityToast}</span>
              </div>
            )}

            {/* Top overlay — hides YouTube logo. Fades out with the rest of
                the chrome on fullscreen inactivity. */}
            <div className={`absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/85 to-transparent z-20 flex items-center justify-end gap-3 px-3 sm:px-4 pointer-events-auto transition-opacity duration-300 ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}>
              <div className="flex items-center gap-2">
                {!isFullscreen && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-black/50 px-2.5 py-1 rounded-full border border-amber-500/25 backdrop-blur">
                    <ShieldAlert className="w-3 h-3" /> Protected
                  </span>
                )}
              </div>
            </div>

            {/* Bottom shield — hides YouTube seek bar */}
            <div className="absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-black to-transparent z-20 pointer-events-none" />

            {/* Click overlay — tap to play/pause */}
            <div className="absolute inset-0 z-10 cursor-pointer" onClick={togglePlay} />

            {/* Fullscreen bottom overlay — timeline, play/pause, volume,
                speed, quality & exit-fullscreen all together; fades out
                with the rest of the chrome on inactivity. */}
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
                    {renderSpeedDropdown()}
                    {renderQualityDropdown()}
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
          </div>
        ) : (
          /* ── Offline banner ─────────────────────────────────────────── */
          <div className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-slate-950">
            <img
              src={offlineImageUrl}
              alt="Offline"
              className="absolute inset-0 w-full h-full object-cover opacity-20 blur-sm"
            />
            <div className="relative z-10 max-w-xs sm:max-w-sm w-full bg-slate-900/95 border border-white/10 rounded-2xl p-5 shadow-2xl backdrop-blur-xl text-center space-y-3">
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

          {/* Right group: Playback Speed, Stream Quality Selector & Fullscreen */}
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            {/* Playback Speed Dropdown Button */}
            {renderSpeedDropdown()}

            {/* Quality Selector Dropdown Button */}
            {renderQualityDropdown()}

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
