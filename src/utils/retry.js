// moneyq-social-engine/src/utils/retry.js
// Exponential backoff retry wrapper with jitter

/**
 * Retry an async function with exponential backoff and jitter.
 *
 * @param {() => Promise<T>} fn - Async function to retry
 * @param {object} [options]
 * @param {number} [options.maxRetries=3] - Maximum number of retry attempts
 * @param {number} [options.baseDelayMs=2000] - Base delay in milliseconds
 * @param {number} [options.maxDelayMs=30000] - Maximum delay cap
 * @param {(err: Error, attempt: number) => void} [options.onRetry] - Retry callback
 * @returns {Promise<T>} - Resolved value from fn
 */
export async function withRetry(fn, options = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 2000,
    maxDelayMs = 30000,
    onRetry = (err, attempt) => console.log(`  Retry ${attempt}/${maxRetries}: ${err.message}`),
  } = options;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        // Exponential backoff: baseDelay * 2^(attempt-1), capped at maxDelayMs
        const exponentialDelay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        // Jitter: +/- 20% of the computed delay
        const jitter = exponentialDelay * 0.2 * (Math.random() * 2 - 1);
        const delay = Math.round(exponentialDelay + jitter);

        onRetry(err, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

export default withRetry;
