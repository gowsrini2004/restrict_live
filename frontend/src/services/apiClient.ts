import axios, { AxiosError } from 'axios';
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios';

// Base API URLs: default to relative path '/api/v1' so Vite proxy routes
// frontend, local Wi-Fi, and ngrok URLs cleanly without cross-origin port issues.
const API_BASE_URL        = import.meta.env.VITE_API_BASE_URL        || '/api/v1';
const STREAM_API_BASE_URL = import.meta.env.VITE_STREAM_API_BASE_URL || '/api/v1';

export interface ApiErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details: Record<string, string[]>;
  };
  timestamp: string;
}

// Callback registered by AuthContext when a session eviction 401 is received
// (logged in from another device — access is genuinely gone, no retry possible).
let onSessionEvictedCallback: (() => void) | null = null;
// Callback registered by AuthContext when the access token expired AND the
// silent refresh attempt also failed (refresh token itself expired/invalid,
// or the account got disabled meanwhile) — only then do we force a real
// logout back to the login screen.
let onAuthExpiredCallback: (() => void) | null = null;

export const registerSessionEvictedListener = (callback: () => void) => {
  onSessionEvictedCallback = callback;
};

export const registerAuthExpiredListener = (callback: () => void) => {
  onAuthExpiredCallback = callback;
};

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const streamApiClient = axios.create({
  baseURL: STREAM_API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor to attach Auth token
const attachAuthToken = (config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
};

apiClient.interceptors.request.use(attachAuthToken);
streamApiClient.interceptors.request.use(attachAuthToken);

// A short-lived access token expiring mid-session shouldn't dump the viewer
// back to the login screen — silently exchange the refresh token for a new
// access token instead, then transparently retry whatever request failed.
// Concurrent 401s (several requests in flight when the token expires) must
// only trigger ONE refresh call, not one per request, so the in-flight
// promise is shared across all of them.
let refreshPromise: Promise<string | null> | null = null;

const performRefresh = (): Promise<string | null> => {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const storedRefreshToken = localStorage.getItem('refresh_token');
      if (!storedRefreshToken) return null;
      try {
        const res = await axios.post(`${API_BASE_URL}/auth/refresh/`, { refresh_token: storedRefreshToken });
        const { token, refresh_token: newRefreshToken } = res.data.data;
        localStorage.setItem('auth_token', token);
        if (newRefreshToken) localStorage.setItem('refresh_token', newRefreshToken);
        return token as string;
      } catch {
        return null;
      }
    })().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
};

const forceLogoutState = () => {
  localStorage.removeItem('auth_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('auth_user');
};

// Interceptor to handle session eviction / expired-token retry-with-refresh
const createResponseErrorHandler = (client: AxiosInstance) => async (error: AxiosError<ApiErrorResponse>) => {
  const originalRequest = error.config as (InternalAxiosRequestConfig & { _retriedAfterRefresh?: boolean }) | undefined;

  if (error.response && error.response.status === 401) {
    const code = error.response.data?.error?.code;

    if (code === 'SESSION_EVICTED') {
      forceLogoutState();
      if (onSessionEvictedCallback) onSessionEvictedCallback();
      return Promise.reject(error);
    }

    // INVALID_TOKEN covers both "expired" and "malformed/wrong type" — only
    // worth a refresh attempt once per request, and never for the refresh
    // or login calls themselves (that would loop).
    const isAuthEndpoint = typeof originalRequest?.url === 'string' && /\/auth\/(refresh|login)\/?$/.test(originalRequest.url);
    if (code === 'INVALID_TOKEN' && originalRequest && !originalRequest._retriedAfterRefresh && !isAuthEndpoint) {
      originalRequest._retriedAfterRefresh = true;
      const newAccessToken = await performRefresh();
      if (newAccessToken) {
        originalRequest.headers = originalRequest.headers || ({} as any);
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return client(originalRequest);
      }
      // Refresh failed too (refresh token expired/invalid, or account
      // disabled) — nothing left to do but send the viewer back to login.
      forceLogoutState();
      if (onAuthExpiredCallback) onAuthExpiredCallback();
    }
  }
  return Promise.reject(error);
};

apiClient.interceptors.response.use((res) => res, createResponseErrorHandler(apiClient));
streamApiClient.interceptors.response.use((res) => res, createResponseErrorHandler(streamApiClient));

export const parseErrorMessage = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const apiError = error.response?.data as ApiErrorResponse;
    if (apiError?.error?.message) {
      return apiError.error.message;
    }
    if (error.message) {
      return error.message;
    }
  }
  return 'An unexpected error occurred. Please check your network connection.';
};
