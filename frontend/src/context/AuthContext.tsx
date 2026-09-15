import React, { createContext, useContext, useState, useEffect } from 'react';
import { apiClient, registerSessionEvictedListener } from '../services/apiClient';

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
  const [isSessionEvicted, setIsSessionEvicted] = useState<boolean>(false);

  useEffect(() => {
    registerSessionEvictedListener(() => {
      handleEviction();
    });
  }, []);

  const handleEviction = () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setToken(null);
    setUser(null);
    setIsSessionEvicted(true);
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
    setIsSessionEvicted(false);
    const response = await apiClient.post('/auth/login/', { email, passcode });
    const { token: newToken, user: newUser } = response.data.data;

    localStorage.setItem('auth_token', newToken);
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
      localStorage.removeItem('auth_user');
      setToken(null);
      setUser(null);
    }
  };

  const dismissSessionEvictedModal = () => {
    setIsSessionEvicted(false);
  };

  return (
    <AuthContext.Provider
      value={{
        token,
        user,
        isLoggedIn: !!token && !!user,
        isAdmin: !!user?.is_admin || !!user?.is_super_admin,
        isSuperAdmin: !!user?.is_super_admin,
        isSessionEvicted,
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
