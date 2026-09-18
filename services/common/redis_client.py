import os
import time
import logging
from django.core.cache import cache

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 86400  # 24 hours session lifetime
HEARTBEAT_TIMEOUT_SECONDS = 45  # Consider user offline if no heartbeat within 45s

# The "active users" index below is a single shared blob updated by every
# heartbeat (potentially hundreds of viewers at once). A plain read-modify-
# write on it is NOT atomic — two heartbeats landing concurrently can each
# read the same snapshot, and whichever writes back last silently discards
# the other's update, losing heartbeats under real concurrent load. cache.add()
# is a genuine atomic "set-if-not-exists" on both the LocMemCache (dev) and
# RedisCache (prod) backends, so it works as a real mutex either way.
_ACTIVE_INDEX_LOCK_KEY = "active_users_set:lock"
_ACTIVE_INDEX_LOCK_TIMEOUT = 2  # seconds — well above how long a blob update takes
_ACTIVE_INDEX_LOCK_MAX_WAIT = 0.5  # seconds to spin-wait for the lock before giving up

class SessionManager:
    """
    Session Manager handling single active device enforcement and live user tracking.
    Uses Django cache abstraction (backed by Redis in prod, memory cache in dev).
    """

    @staticmethod
    def _update_active_index(mutate):
        """Read-modify-write the shared active-users blob under a mutex so
        concurrent heartbeats can't silently overwrite each other's updates.
        `mutate` receives the current dict and mutates it in place."""
        acquired = False
        waited = 0.0
        while waited < _ACTIVE_INDEX_LOCK_MAX_WAIT:
            if cache.add(_ACTIVE_INDEX_LOCK_KEY, "1", timeout=_ACTIVE_INDEX_LOCK_TIMEOUT):
                acquired = True
                break
            time.sleep(0.01)
            waited += 0.01
        try:
            active_index = cache.get("active_users_set") or {}
            mutate(active_index)
            cache.set("active_users_set", active_index, timeout=SESSION_TTL_SECONDS)
        finally:
            if acquired:
                cache.delete(_ACTIVE_INDEX_LOCK_KEY)

    @staticmethod
    def set_active_session(user_id: str, email: str, session_id: str):
        """Sets the current active session ID for a user, overriding previous sessions."""
        key = f"active_session:{user_id}"
        session_data = {
            "session_id": session_id,
            "email": email,
            "last_heartbeat": time.time(),
            "created_at": time.time()
        }
        cache.set(key, session_data, timeout=SESSION_TTL_SECONDS)

        # Track in active users index
        def _mutate(active_index):
            active_index[user_id] = {
                "email": email,
                "session_id": session_id,
                "last_heartbeat": time.time()
            }
        SessionManager._update_active_index(_mutate)

    @staticmethod
    def is_session_valid(user_id: str, session_id: str) -> bool:
        """Validates if the provided session_id matches the active session in cache."""
        key = f"active_session:{user_id}"
        data = cache.get(key)
        if not data:
            return False
        return data.get("session_id") == session_id

    @staticmethod
    def check_session_status(user_id: str, session_id: str) -> str:
        """
        Returns the session status:
        - 'valid'     : Session ID matches the active session in cache.
        - 'not_found' : No active session found (server restart / expired TTL).
        - 'evicted'   : A *different* session ID is active (logged in from another device).
        """
        key = f"active_session:{user_id}"
        data = cache.get(key)
        if not data:
            return 'not_found'
        if data.get("session_id") == session_id:
            return 'valid'
        return 'evicted'

    @staticmethod
    def update_heartbeat(user_id: str, session_id: str):
        """Updates heartbeat timestamp for active session."""
        key = f"active_session:{user_id}"
        data = cache.get(key)
        if data and data.get("session_id") == session_id:
            now = time.time()
            data["last_heartbeat"] = now
            cache.set(key, data, timeout=SESSION_TTL_SECONDS)

            # Update index
            def _mutate(active_index):
                if user_id in active_index:
                    active_index[user_id]["last_heartbeat"] = now
            SessionManager._update_active_index(_mutate)
            return True
        return False

    @staticmethod
    def invalidate_session(user_id: str):
        """Invalidates a user session explicitly (Logout)."""
        key = f"active_session:{user_id}"
        cache.delete(key)

        def _mutate(active_index):
            active_index.pop(user_id, None)
        SessionManager._update_active_index(_mutate)

    @staticmethod
    def get_live_metrics():
        """Returns the current online user count and active user roster based on recent heartbeats."""
        now = time.time()
        active_index = cache.get("active_users_set") or {}

        live_users = []
        expired_ids = []

        for user_id, info in active_index.items():
            last_hb = info.get("last_heartbeat", 0)
            if now - last_hb <= HEARTBEAT_TIMEOUT_SECONDS:
                live_users.append({
                    "user_id": user_id,
                    "email": info.get("email"),
                    "last_active_seconds_ago": int(now - last_hb)
                })
            else:
                expired_ids.append(user_id)

        # Cleanup expired from index
        if expired_ids:
            def _mutate(active_index):
                for uid in expired_ids:
                    active_index.pop(uid, None)
            SessionManager._update_active_index(_mutate)

        return {
            "online_count": len(live_users),
            "active_users": live_users,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
