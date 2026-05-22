/**
 * Minimal HTTP helpers built on top of the global `fetch`.
 *
 * - `fetchWithTimeout` wraps fetch with an AbortController so callers cannot
 *   hang forever on unresponsive endpoints (12s default).
 * - `fetchWithRetry` adds retry-with-backoff on top of fetchWithTimeout for
 *   transient failures (429, 5xx, network errors).
 * - `HttpError` carries the HTTP status, the URL, and a small body snippet
 *   so callers can produce useful diagnostics without leaking large bodies
 *   into logs.
 * - `assertOk` / `safeJson` are tiny helpers that the routing/geocoding
 *   clients share.
 */

export const DEFAULT_TIMEOUT_MS = 12_000;
const ERROR_BODY_SNIPPET_LIMIT = 200;
const DEFAULT_MAX_RETRIES = 2;
const RETRY_BACKOFF_BASE_MS = 200;
const RETRY_BACKOFF_CAP_MS = 2000;
const RETRY_BACKOFF_JITTER_MS = 200;

export interface FetchWithTimeoutInit extends RequestInit {
  timeoutMs?: number;
}

export interface FetchWithRetryInit extends FetchWithTimeoutInit {
  maxRetries?: number;
  retryOn?: (status: number) => boolean;
}

function defaultRetryOn(status: number): boolean {
  return status === 429 || status >= 500;
}

export class HttpError extends Error {
  public readonly status: number;
  public readonly url: string;
  public readonly bodySnippet?: string;
  public readonly isRetryable: boolean;

  constructor(message: string, status: number, url: string, bodySnippet?: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    if (bodySnippet !== undefined) {
      this.bodySnippet = bodySnippet;
    }
    // 0 represents a timeout/abort or a network-level failure — treat as
    // retryable so transient connectivity blips don't surface as hard errors.
    this.isRetryable = status === 0 || status === 429 || status >= 500;
  }
}

export async function fetchWithTimeout(
  url: string,
  init: FetchWithTimeoutInit = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  // Forward an externally provided abort signal so callers can cancel too.
  let cleanupExternal: (() => void) | undefined;
  if (callerSignal) {
    if (callerSignal.aborted) {
      clearTimeout(timeout);
      controller.abort();
    } else {
      const onAbort = (): void => controller.abort();
      callerSignal.addEventListener('abort', onAbort, { once: true });
      cleanupExternal = (): void => callerSignal.removeEventListener('abort', onAbort);
    }
  }

  try {
    return await fetch(url, { ...rest, signal: controller.signal });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpError(
        `Request timed out after ${timeoutMs}ms`,
        0,
        url,
      );
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (cleanupExternal) cleanupExternal();
  }
}

function computeBackoffMs(attempt: number): number {
  const exponential = RETRY_BACKOFF_BASE_MS * Math.pow(2, attempt);
  const jitter = Math.random() * RETRY_BACKOFF_JITTER_MS;
  return Math.min(RETRY_BACKOFF_CAP_MS, exponential + jitter);
}

function delay(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Fetch with timeout + retry-with-backoff. The same AbortSignal is forwarded
 * to every attempt so callers can still cancel mid-retry. Network errors
 * (TypeError thrown by fetch) and HTTP responses where `retryOn(status)` is
 * true are retried up to `maxRetries` times.
 */
export async function fetchWithRetry(
  url: string,
  init: FetchWithRetryInit = {},
): Promise<Response> {
  const {
    maxRetries = DEFAULT_MAX_RETRIES,
    retryOn = defaultRetryOn,
    signal: callerSignal,
    ...timeoutInit
  } = init;

  let attempt = 0;
  // We track the last error/response so we can throw a meaningful failure
  // after exhausting retries.
  let lastError: unknown;

  while (attempt <= maxRetries) {
    try {
      const response = await fetchWithTimeout(url, {
        ...timeoutInit,
        ...(callerSignal ? { signal: callerSignal } : {}),
      });
      if (response.ok || !retryOn(response.status)) {
        return response;
      }
      // Retryable status — drain the body so the connection can be reused
      // and then back off before the next attempt.
      try {
        await response.text();
      } catch {
        // ignore — body draining is best-effort
      }
      if (attempt === maxRetries) {
        // Surface the failure through the normal assertOk path by returning
        // the last (failed) response; callers will use assertOk() to convert
        // it to an HttpError with the body snippet.
        return response;
      }
    } catch (err) {
      lastError = err;
      const isNetworkError = err instanceof TypeError;
      const isRetryableHttp = err instanceof HttpError && err.isRetryable;
      if (!isNetworkError && !isRetryableHttp) {
        throw err;
      }
      if (attempt === maxRetries) {
        throw err;
      }
    }

    await delay(computeBackoffMs(attempt), callerSignal ?? null);
    attempt += 1;
  }

  // Unreachable in practice — the loop returns or throws — but TS needs it.
  if (lastError) throw lastError;
  throw new HttpError('Exhausted retries', 0, url);
}

export async function assertOk(res: Response): Promise<Response> {
  if (res.ok) return res;

  let snippet: string | undefined;
  try {
    const text = await res.text();
    snippet = text.slice(0, ERROR_BODY_SNIPPET_LIMIT);
  } catch {
    snippet = undefined;
  }

  throw new HttpError(
    `HTTP ${res.status} ${res.statusText || ''}`.trim(),
    res.status,
    res.url,
    snippet,
  );
}

export async function safeJson<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T;
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    throw new HttpError(
      `Failed to parse JSON response: ${cause}`,
      res.status,
      res.url,
    );
  }
}
