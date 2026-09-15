import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  Play, Pause, Volume2, VolumeX, Maximize, Minimize2,
  ShieldAlert, Radio, Clock,
} from 'lucide-react';

interface ProtectedPlayerProps {
  videoId: string;
  title?: string;
  isLive?: boolean;
  offlineImageUrl?: string;
  offlineMessage?: string;
}

export const ProtectedPlayer: React.FC<ProtectedPlayerProps> = ({
  videoId,
  title = 'International Retreat 2026 — Live Stream',
  isLive = true,
  offlineImageUrl = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=1200&q=80',
  offlineMessage  = 'The live broadcast is currently offline. Please stay tuned for the next session.',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef    = useRef<HTMLIFrameElement>(null);

  const [isPlaying,    setIsPlaying]    = useState(true);
  const [isMuted,      setIsMuted]      = useState(false);
  const [volume,       setVolume]       = useState(80);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  /* Compute the amber-filled gradient for the slider track */
  const sliderTrackStyle = useCallback((val: number): React.CSSProperties => {
    const pct = isMuted ? 0 : val;
    return {
      background: `linear-gradient(to right, #f59e0b ${pct}%, rgba(255,255,255,0.12) ${pct}%)`,
    };
  }, [isMuted]);

  const ytCmd = (func: string, args: unknown[] = []) => {
    iframeRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: 'command', func, args }), '*',
    );
  };

  const togglePlay = () => {
    if (isPlaying) { ytCmd('pauseVideo'); setIsPlaying(false); }
    else           { ytCmd('playVideo');  setIsPlaying(true);  }
  };

  const toggleMute = () => {
    if (isMuted) { ytCmd('unMute'); ytCmd('setVolume', [volume]); setIsMuted(false); }
    else         { ytCmd('mute');                                  setIsMuted(true);  }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (v === 0) { ytCmd('mute');   setIsMuted(true);  }
    else         { ytCmd('unMute'); ytCmd('setVolume', [v]); setIsMuted(false); }
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

  const embedUrl = `https://www.youtube.com/embed/${videoId}?enablejsapi=1&controls=0&modestbranding=1&rel=0&autoplay=1&origin=${encodeURIComponent(window.location.origin)}`;

  return (
    <div
      ref={containerRef}
      className={`protected-player-container relative bg-black select-none flex flex-col justify-between overflow-hidden ${
        isFullscreen ? 'w-screen h-screen fixed inset-0 z-50' : 'w-full h-full min-h-[240px]'
      }`}
      onContextMenu={(e) => e.preventDefault()}
    >
      {/* ── 16:9 Video Container — fits available height strictly ──────── */}
      <div className="relative w-full flex-1 min-h-0 flex items-center justify-center bg-black overflow-hidden">
        {isLive ? (
          <div className="relative w-full h-full max-w-full max-h-full aspect-video flex items-center justify-center">
            <iframe
              ref={iframeRef}
              src={embedUrl}
              title={title}
              className="absolute inset-0 w-full h-full border-0"
              style={{ pointerEvents: 'none' }}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />

            {/* Top overlay — hides YouTube logo, shows LIVE badge */}
            <div className="absolute top-0 left-0 right-0 h-16 bg-gradient-to-b from-black/85 to-transparent z-20 flex items-center justify-between px-3 sm:px-4 pointer-events-auto">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-600 text-white font-bold text-[11px] uppercase tracking-widest shadow-lg animate-pulse">
                <Radio className="w-3 h-3" /> LIVE
              </span>

              <div className="flex items-center gap-2">
                {isFullscreen && (
                  <button
                    onClick={toggleFullscreen}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 hover:bg-red-700/80 text-white text-xs font-bold border border-white/20 backdrop-blur transition-all active:scale-95"
                  >
                    <Minimize2 className="w-3.5 h-3.5" /> Exit Fullscreen
                  </button>
                )}
                <span className="inline-flex items-center gap-1 text-[10px] text-amber-400 bg-black/50 px-2.5 py-1 rounded-full border border-amber-500/25 backdrop-blur">
                  <ShieldAlert className="w-3 h-3" /> Protected
                </span>
              </div>
            </div>

            {/* Bottom shield — hides YouTube seek bar */}
            <div className="absolute bottom-0 left-0 right-0 h-14 bg-gradient-to-t from-black to-transparent z-20 pointer-events-none" />

            {/* Click overlay — tap to play/pause */}
            <div className="absolute inset-0 z-10 cursor-pointer" onClick={togglePlay} />
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

      {/* ── Control Bar (Hidden in Fullscreen Mode) ──────────────────── */}
      {isLive && !isFullscreen && (
        <div className="bg-slate-950 border-t border-white/10 px-3 sm:px-4 py-2.5 flex items-center justify-between gap-3 shrink-0">

          {/* Left group: Play/Pause & Compact Volume Slider */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* Play / Pause */}
            <button
              onClick={togglePlay}
              className="w-9 h-9 rounded-xl flex items-center justify-center bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md shadow-amber-500/30 transition-all active:scale-90 shrink-0"
              title={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying
                ? <Pause className="w-4 h-4" />
                : <Play  className="w-4 h-4 fill-current" />
              }
            </button>

            {/* Compact Volume Pill */}
            <div className="flex items-center gap-2 bg-slate-900/90 border border-white/10 px-2.5 py-1.5 rounded-xl">
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

              <div className="w-16 sm:w-24 flex items-center">
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

              <span className="w-6 text-right text-[10px] text-slate-400 font-mono shrink-0 tabular-nums">
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

          {/* Right group: Fullscreen button */}
          <button
            onClick={toggleFullscreen}
            className="w-9 h-9 rounded-xl flex items-center justify-center bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-white/10 transition-all shrink-0"
            title={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {isFullscreen
              ? <Minimize2 className="w-4 h-4 text-amber-400" />
              : <Maximize  className="w-4 h-4" />
            }
          </button>
        </div>
      )}
    </div>
  );
};
