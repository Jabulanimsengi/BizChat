import type { ApiErrorBody } from '@bizchat/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';
export const API_ORIGIN = API_URL.replace(/\/api\/v1\/?$/, '');
export const WIDGET_SCRIPT_URL =
  process.env.NEXT_PUBLIC_WIDGET_URL ?? 'https://cdn.bizchat.example/widget.js';

export const UNAUTHORIZED_EVENT = 'bizchat:unauthorized';

const REQUEST_TIMEOUT_MS = 30_000;
const AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/password/', '/auth/email/verify'];

if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_API_URL) {
  // Surfaced loudly because the default points at localhost and would break live traffic.
  console.error(
    'NEXT_PUBLIC_API_URL is not configured; the dashboard is falling back to http://localhost:4000.',
  );
}

export class ApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...init?.headers },
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') {
      throw new ApiError(0, 'TIMEOUT', 'The request took too long. Please try again.');
    }
    throw new ApiError(
      0,
      'NETWORK_ERROR',
      'The server could not be reached. Check your connection.',
    );
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined;
    const code = body?.error.code ?? `HTTP_${response.status}`;
    if (response.status === 401 && !AUTH_PATHS.some((prefix) => path.startsWith(prefix))) {
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT));
    }
    throw new ApiError(
      response.status,
      code,
      body?.error.message ?? 'The request could not be completed',
      body?.error.requestId,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
