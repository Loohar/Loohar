export const DEFAULT_API_TIMEOUT_MS = 15000;
export const API_HEALTH_TIMEOUT_MS = 6000;

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
