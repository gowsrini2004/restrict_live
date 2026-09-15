import axios, { AxiosError } from 'axios';

// Dynamically resolve API host from the current browser hostname.
// This means when a phone connects via 192.168.1.3:5173, API calls also
// go to 192.168.1.3:8000 / :8001 instead of 'localhost' (unreachable from phones).
const host = window.location.hostname; // e.g. 'localhost' or '192.168.1.3'
const API_BASE_URL        = import.meta.env.VITE_API_BASE_URL        || `http://${host}:8000/api/v1`;
const STREAM_API_BASE_URL = import.meta.env.VITE_STREAM_API_BASE_URL || `http://${host}:8001/api/v1`;

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
let onSessionEvictedCallback: (() => void) | null = null;

export const registerSessionEvictedListener = (callback: () => void) => {
  onSessionEvictedCallback = callback;
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
const attachAuthToken = (config: any) => {
  const token = localStorage.getItem('auth_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
};

apiClient.interceptors.request.use(attachAuthToken);
streamApiClient.interceptors.request.use(attachAuthToken);

// Interceptor to handle session eviction 401
const handleResponseError = (error: AxiosError<ApiErrorResponse>) => {
  if (error.response && error.response.status === 401) {
    const errorData = error.response.data;
    if (errorData?.error?.code === 'SESSION_EVICTED') {
      if (onSessionEvictedCallback) {
        onSessionEvictedCallback();
      }
    }
  }
  return Promise.reject(error);
};

apiClient.interceptors.response.use((res) => res, handleResponseError);
streamApiClient.interceptors.response.use((res) => res, handleResponseError);

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
