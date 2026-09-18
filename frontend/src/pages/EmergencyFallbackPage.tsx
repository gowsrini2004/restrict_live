import React from 'react';

interface EmergencyFallbackPageProps {
  videoId: string;
  title: string;
  onAdminBypass: () => void;
}

/* Deliberately as bare as possible — no login, no ProtectedPlayer chrome,
 * no Q&A, no tab-lock, no API calls beyond the one that already told the
 * app to render this page. This is the "break glass" view: if the normal
 * app is broken, this is the one thing that still has to work. */
export const EmergencyFallbackPage: React.FC<EmergencyFallbackPageProps> = ({ videoId, title, onAdminBypass }) => {
  return (
    <div className="fixed inset-0 bg-black">
      {videoId ? (
        <iframe
          className="w-full h-full border-0"
          src={`https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1`}
          title={title || 'Live Stream'}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          allowFullScreen
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-white/60 text-sm px-4 text-center">
          Stream unavailable right now. Please check back shortly.
        </div>
      )}

      {/* Small, deliberately unobtrusive — not an invitation for random
          visitors, just a way back in for whoever knows to look for it. */}
      <button
        onClick={onAdminBypass}
        className="fixed bottom-2 right-2 text-[10px] text-white/15 hover:text-white/50 px-2 py-1 transition-colors"
      >
        Admin Access
      </button>
    </div>
  );
};
