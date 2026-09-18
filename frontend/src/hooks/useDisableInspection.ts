import { useEffect } from 'react';

/**
 * Blocks the casual, everyday paths into DevTools (right-click → Inspect,
 * F12, Ctrl+Shift+I/J/C on Windows/Linux, Cmd+Option+I/J/C on Mac, Ctrl/Cmd+U
 * view-source) for as long as the calling page is mounted. This raises
 * friction for the average viewer — it does NOT and cannot stop a technical
 * one, who can still open DevTools via the browser's own menu (⋮ → More
 * tools → Developer tools) or a detached/remote debugger. There's no real
 * way to block that from page script; this is a deterrent, not a security
 * boundary.
 */
export function useDisableInspection(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const blockContextMenu = (e: MouseEvent) => e.preventDefault();

    const blockDevToolsKeys = (e: KeyboardEvent) => {
      // e.code (physical key) rather than e.key — on Mac, Option is a
      // dead-key modifier for accented characters, so e.key for
      // Option+I/J/C can come through as a diacritic mark instead of
      // "i"/"j"/"c" and silently defeat a check based on e.key.
      const code = e.code;
      // Windows/Linux Chrome: Ctrl+Shift+I/J/C. Mac Chrome: Cmd+Option+I/J/C.
      const combo = (e.ctrlKey || e.metaKey) && (e.shiftKey || e.altKey) && ['KeyI', 'KeyJ', 'KeyC'].includes(code);
      const viewSource = (e.ctrlKey || e.metaKey) && code === 'KeyU';
      if (code === 'F12' || combo || viewSource) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    document.addEventListener('contextmenu', blockContextMenu);
    document.addEventListener('keydown', blockDevToolsKeys, true);
    return () => {
      document.removeEventListener('contextmenu', blockContextMenu);
      document.removeEventListener('keydown', blockDevToolsKeys, true);
    };
  }, [enabled]);
}
