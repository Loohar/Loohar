export const DEFAULT_API_TIMEOUT_MS = 15000;
export const API_HEALTH_TIMEOUT_MS = 4000;
export const STARTUP_RETRY_DELAYS_MS = Object.freeze([200, 500]);

function requestAbortError(signal) {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error("Request aborted.");
  error.name = "AbortError";
  return error;
}

function waitForRetry(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(requestAbortError(signal));
  const duration = Math.max(0, Number(delayMs) || 0);
  if (!duration) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, duration);
    function abort() {
      globalThis.clearTimeout(timer);
      reject(requestAbortError(signal));
    }
    signal?.addEventListener("abort", abort, { once: true });
  });
}

export async function retryTransientRequest(request, options = {}) {
  const attempts = Math.max(1, Math.floor(Number(options.attempts) || 3));
  const delaysMs = options.delaysMs || STARTUP_RETRY_DELAYS_MS;
  const shouldRetry = options.shouldRetry || (() => true);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw requestAbortError(options.signal);
    try {
      return await request(attempt);
    } catch (error) {
      const willRetry = attempt < attempts && !options.signal?.aborted && shouldRetry(error, { attempt, attempts });
      if (!willRetry) throw error;
      options.onRetry?.(error, { attempt, attempts, nextAttempt: attempt + 1 });
      await waitForRetry(delaysMs[attempt - 1], options.signal);
    }
  }

  throw new Error("Request retry policy ended unexpectedly.");
}

export function createRequestTimeoutError(timeoutMs) {
  const error = new Error("Unable to connect to the Loohar server.");
  error.name = "TimeoutError";
  error.code = "API_REQUEST_TIMEOUT";
  error.timeoutMs = timeoutMs;
  return error;
}

export async function fetchWithTimeout(input, options = {}, timeoutMs = DEFAULT_API_TIMEOUT_MS) {
  const duration = Number(timeoutMs);
  if (!Number.isFinite(duration) || duration <= 0) return fetch(input, options);

  const controller = new globalThis.AbortController();
  const upstreamSignal = options.signal;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) abortFromUpstream();
  else upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });

  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, duration);

  try {
    return await fetch(input, { ...options, signal: controller.signal });
  } catch (error) {
    if (timedOut) throw createRequestTimeoutError(duration);
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}
