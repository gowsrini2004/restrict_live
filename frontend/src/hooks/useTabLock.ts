import { useState, useEffect, useRef } from 'react';

const TAB_LOCK_KEY = 'live_stream_active_tab_id';
const CHANNEL_NAME = 'live_stream_tab_channel';

export const useTabLock = () => {
  const [tabId] = useState<string>(() => 'tab_' + Math.random().toString(36).substring(2, 10));
  const [isTabLocked, setIsTabLocked] = useState<boolean>(false);
  const isLockedRef = useRef<boolean>(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // Keep ref in sync with state for use inside event handlers
  const setLocked = (val: boolean) => {
    isLockedRef.current = val;
    setIsTabLocked(val);
  };

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channelRef.current = channel;
    let pongReceived = false;

    const claimTabLock = () => {
      sessionStorage.setItem(TAB_LOCK_KEY, tabId);
      localStorage.setItem(TAB_LOCK_KEY, tabId);
      channel.postMessage({ type: 'TAB_CLAIMED', tabId });
      setLocked(false);
    };

    // Broadcast PING to check if another tab is ACTUALLY alive right now
    channel.postMessage({ type: 'PING_ACTIVE_TAB', tabId });

    // Give existing tabs 200ms to respond with PONG
    const pingTimeout = setTimeout(() => {
      if (!pongReceived) {
        // No other live tab exists, claim lock cleanly
        claimTabLock();
      }
    }, 200);

    channel.onmessage = (event) => {
      const data = event.data;
      if (!data) return;

      // Another tab is asking if anyone is alive — respond only if WE currently hold the lock
      if (data.type === 'PING_ACTIVE_TAB' && data.tabId !== tabId) {
        const myLock = sessionStorage.getItem(TAB_LOCK_KEY);
        // Only respond if this tab's id is the one holding the lock AND we are not locked ourselves
        if (myLock === tabId && !isLockedRef.current) {
          channel.postMessage({ type: 'PONG_TAB_ALIVE', tabId });
        }
      }

      // We received a PONG from an active living tab
      if (data.type === 'PONG_TAB_ALIVE' && data.tabId !== tabId) {
        pongReceived = true;
        setLocked(true);
      }

      // Another tab claimed lock — we must yield
      if (data.type === 'TAB_CLAIMED' && data.tabId !== tabId) {
        setLocked(true);
      }

      // Another tab released the lock — we can now claim it
      if (data.type === 'TAB_RELEASED' && data.tabId !== tabId) {
        // Small delay to avoid race between multiple tabs
        setTimeout(() => {
          if (!isLockedRef.current) return; // We were already unlocked
          // Re-ping to confirm nobody else claiming
          claimTabLock();
        }, 100);
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === TAB_LOCK_KEY) {
        if (!e.newValue) {
          // Lock was released — we can claim it
          claimTabLock();
        } else if (e.newValue !== tabId) {
          setLocked(true);
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);

    // Release lock when closing tab
    const handleUnload = () => {
      const currentLock = sessionStorage.getItem(TAB_LOCK_KEY);
      if (currentLock === tabId) {
        sessionStorage.removeItem(TAB_LOCK_KEY);
        localStorage.removeItem(TAB_LOCK_KEY);
        channel.postMessage({ type: 'TAB_RELEASED', tabId });
      }
    };

    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearTimeout(pingTimeout);
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('beforeunload', handleUnload);
      channel.close();
      channelRef.current = null;
    };
    // Only run once on mount — tabId is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId]);

  const forceClaimLock = () => {
    sessionStorage.setItem(TAB_LOCK_KEY, tabId);
    localStorage.setItem(TAB_LOCK_KEY, tabId);
    const channel = channelRef.current || new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ type: 'TAB_CLAIMED', tabId });
    if (!channelRef.current) channel.close();
    setLocked(false);
  };

  return { isTabLocked, forceClaimLock };
};
