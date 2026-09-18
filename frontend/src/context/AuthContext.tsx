import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient, registerSessionEvictedListener, registerAuthExpiredListener } from '../services/apiClient';

export interface User {
  id: string;
  email: string;
  is_active: boolean;
  is_admin: boolean;
  is_super_admin: boolean;
  created_at: string;
  last_login_at?: string;
}

interface AuthContextType {
  token: string | null;
  user: User | null;
  isLoggedIn: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  isSessionEvicted: boolean;
  isSessionExpired: boolean;
  login: (email: string, passcode: string) => Promise<User>;
  logout: () => Promise<void>;
  dismissSessionEvictedModal: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('auth_token'));
  const [user, setUser] = useState<User | null>(() => {
    const savedUser = localStorage.getItem('auth_user');
    return savedUser ? JSON.parse(savedUser) : null;
  });
  // 'evicted' = logged in from another device (someone else has the account
  // now). 'expired' = the access token expired AND the silent refresh-token
  // exchange also failed, so there's genuinely nothing left to renew.
  // Both end the session the same way, just with different modal wording.
  const [sessionEndReason, setSessionEndReason] = useState<'evicted' | 'expired' | null>(null);

  useEffect(() => {
    registerSessionEvictedListener(() => endSession('evicted'));
    registerAuthExpiredListener(() => endSession('expired'));
  }, []);

  const endSession = (reason: 'evicted' | 'expired') => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
    setSessionEndReason(reason);
  };

  useEffect(() => {
    if (!token) return;

    const sendHeartbeat = async () => {
      try {
        await apiClient.post('/auth/heartbeat/');
      } catch (err) {
        // Interceptor will catch 401 SESSION_EVICTED
      }
    };

    sendHeartbeat();
    const interval = setInterval(sendHeartbeat, 15000);
    return () => clearInterval(interval);
  }, [token]);

  const login = async (email: string, passcode: string): Promise<User> => {
    setSessionEndReason(null);
    const response = await apiClient.post('/auth/login/', { email, passcode });
    const { token: newToken, refresh_token: newRefreshToken, user: newUser } = response.data.data;

    localStorage.setItem('auth_token', newToken);
    localStorage.setItem('refresh_token', newRefreshToken);
    localStorage.setItem('auth_user', JSON.stringify(newUser));

    setToken(newToken);
    setUser(newUser);
    return newUser;
  };

  const logout = async () => {
    try {
      if (token) {
        await apiClient.post('/auth/logout/');
      }
    } catch (e) {
      // Ignore errors on logout
    } finally {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('auth_user');
      setToken(null);
      setUser(null);
    }
  };

  const dismissSessionEvictedModal = () => {
    setSessionEndReason(null);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isLoggedIn: !!token && !!user,
        isAdmin: !!user?.is_admin || !!user?.is_super_admin,
        isSuperAdmin: !!user?.is_super_admin,
        isSessionEvicted: sessionEndReason === 'evicted',
        isSessionExpired: sessionEndReason === 'expired',
        login,
        logout,
        dismissSessionEvictedModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
