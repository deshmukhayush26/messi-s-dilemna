// src/api/client.ts
/**
 * Production-ready centralized API client for CCG Case Platform.
 * Configurable via VITE_API_URL; handles token injection, multipart boundaries,
 * timeout aborts, structured error classifications, and request tracing.
 */

export type ApiErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'FORBIDDEN'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'TIMEOUT_ERROR'
  | 'SERVER_ERROR';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly requestId?: string;
  readonly details?: any;

  constructor(message: string, status: number, code: ApiErrorCode, requestId?: string, details?: any) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

export interface RequestOptions extends RequestInit {
  timeoutMs?: number;
  skipAuth?: boolean;
}

export const getApiBaseUrl = (): string => {
  const envUrl =
    (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_API_URL) ||
    (typeof globalThis !== 'undefined' && (globalThis as any).process?.env?.VITE_API_URL);
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    // Strip trailing slashes and any trailing /api suffix
    // so base is the host origin without a trailing /api (e.g. 'https://ccg-case-backend.onrender.com')
    return envUrl.trim().replace(/\/+$/, '').replace(/\/api$/, '');
  }
  // When empty, relative URLs /api/... route through Vite dev proxy or Vercel rewrites
  return '';
};

class ApiClient {
  private getAuthToken(): string | null {
    try {
      return localStorage.getItem('ccg_auth_token');
    } catch {
      return null;
    }
  }

  getUrl(endpoint: string): string {
    return this.buildUrl(endpoint);
  }

  buildUrl(endpoint: string): string {
    const base = getApiBaseUrl();
    // Normalize endpoint to start with /
    let clean = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
    // Strip duplicate /api/api if present
    clean = clean.replace(/^\/api\/api(\/|$)/, '/api$1');
    // Ensure single /api prefix
    const finalPath = clean.startsWith('/api') ? clean : `/api${clean}`;
    return `${base}${finalPath}`;
  }

  private async request<T = any>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const url = this.buildUrl(endpoint);
    const timeoutMs = options.timeoutMs ?? 60000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> || {}),
    };

    if (!options.skipAuth && !headers['Authorization']) {
      const token = this.getAuthToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    }

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
        signal: controller.signal,
      });

      const requestId = response.headers.get('x-request-id') || undefined;

      // Handle HTTP errors
      if (!response.ok) {
        let errorData: any = null;
        let errorMessage = `HTTP ${response.status} ${response.statusText}`;

        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
          } else {
            const text = await response.text();
            if (text && text.length < 200) {
              errorMessage = text;
            }
          }
        } catch {
          // Response body empty or invalid
        }

        let code: ApiErrorCode = 'SERVER_ERROR';
        if (response.status === 401) {
          code = 'AUTH_ERROR';
          errorMessage = errorData?.error || 'Authentication session expired or invalid. Please log in again.';
        } else if (response.status === 403) {
          code = 'FORBIDDEN';
          errorMessage = errorData?.error || 'Access denied: You do not have permission for this action.';
        } else if (response.status === 404) {
          code = 'NOT_FOUND';
          errorMessage = errorData?.error || 'Requested resource was not found.';
        } else if (response.status === 400 || response.status === 422) {
          code = 'VALIDATION_ERROR';
          errorMessage = errorData?.error || 'Invalid request parameters.';
        } else if (response.status >= 500) {
          code = 'SERVER_ERROR';
          errorMessage = errorData?.error || 'Server error encountered. Please retry or contact the organizers.';
        }

        throw new ApiClientError(
          errorMessage,
          response.status,
          code,
          requestId || errorData?.requestId,
          errorData
        );
      }

      // Check for empty body (e.g. 204 No Content)
      if (response.status === 204) {
        return {} as T;
      }

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        return (await response.json()) as T;
      }

      return (await response.text()) as unknown as T;
    } catch (err: any) {
      if (err instanceof ApiClientError) {
        throw err;
      }

      if (err.name === 'AbortError') {
        throw new ApiClientError(
          `Request to ${endpoint} timed out after ${timeoutMs / 1000}s. Please check your network connection.`,
          0,
          'TIMEOUT_ERROR'
        );
      }

      // Network / DNS / Connection Refused error
      const isFailedFetch = err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError');
      const safeMessage = isFailedFetch
        ? `Unable to reach API server. Please check your network connection and verify the backend service is running.`
        : err.message || 'An unknown network error occurred';

      throw new ApiClientError(safeMessage, 0, 'NETWORK_ERROR');
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async get<T = any>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'GET' });
  }

  async post<T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {}),
    };
    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async patch<T = any>(endpoint: string, body?: any, options?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options?.headers as Record<string, string> || {}),
    };
    return this.request<T>(endpoint, {
      ...options,
      method: 'PATCH',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async delete<T = any>(endpoint: string, options?: RequestOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' });
  }

  /**
   * Multipart file upload.
   * Note: Does NOT manually set Content-Type header so the browser sets
   * the correct multipart/form-data boundary automatically.
   */
  async upload<T = any>(endpoint: string, formData: FormData, options?: RequestOptions): Promise<T> {
    const headers: Record<string, string> = {
      ...(options?.headers as Record<string, string> || {}),
    };
    // Ensure Content-Type is NOT set so browser creates multipart boundary
    delete headers['Content-Type'];

    return this.request<T>(endpoint, {
      ...options,
      method: 'POST',
      headers,
      body: formData,
    });
  }
}

export const apiClient = new ApiClient();
