import os
import time
import logging
from django.core.cache import cache

logger = logging.getLogger(__name__)

SESSION_TTL_SECONDS = 86400  # 24 hours session lifetime
HEARTBEAT_TIMEOUT_SECONDS = 45  # Consider user offline if no heartbeat within 45s

class SessionManager:
    """
    Session Manager handling single active device enforcement and live user tracking.
    Uses Django cache abstraction (backed by Redis in prod, memory cache in dev).
    """

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
        active_index = cache.get("active_users_set") or {}
        active_index[user_id] = {
            "email": email,
            "session_id": session_id,
            "last_heartbeat": time.time()
        }
        cache.set("active_users_set", active_index, timeout=SESSION_TTL_SECONDS)

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
            active_index = cache.get("active_users_set") or {}
            if user_id in active_index:
                active_index[user_id]["last_heartbeat"] = now
                cache.set("active_users_set", active_index, timeout=SESSION_TTL_SECONDS)
            return True
        return False

    @staticmethod
    def invalidate_session(user_id: str):
        """Invalidates a user session explicitly (Logout)."""
        key = f"active_session:{user_id}"
        cache.delete(key)
        
        active_index = cache.get("active_users_set") or {}
        if user_id in active_index:
            del active_index[user_id]
            cache.set("active_users_set", active_index, timeout=SESSION_TTL_SECONDS)

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
            for uid in expired_ids:
                del active_index[uid]
            cache.set("active_users_set", active_index, timeout=SESSION_TTL_SECONDS)

        return {
            "online_count": len(live_users),
            "active_users": live_users,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
