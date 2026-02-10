/**
 * Batch Processing Engine
 *
 * Generic, high-throughput batch processor with:
 * - Dynamic batch sizing based on total volume
 * - Two-level concurrency control (inter-batch + intra-batch)
 * - Semaphore-based concurrency limiting
 * - Circuit breaker for external resource protection
 * - Retry with exponential backoff + jitter (transient errors only)
 * - Adaptive throttling (auto-reduce on errors, auto-recover on success)
 * - Non-blocking progress reporting
 *
 * Design principles:
 * - Item-type agnostic: works with any T
 * - No business logic assumptions
 * - Predictable, testable behavior
 * - Minimal oscillation via AIMD (Additive Increase, Multiplicative Decrease)
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface BatchEngineConfig {
  /** Minimum batch size (default: 5) */
  minBatchSize?: number;
  /** Maximum batch size (default: 100) */
  maxBatchSize?: number;
  /** Maximum concurrent batches (default: 2) */
  maxConcurrentBatches?: number;
  /** Maximum concurrent items within a single batch (default: 5) */
  maxConcurrencyPerBatch?: number;
  /** Global concurrency ceiling across all batches (default: 10) */
  globalMaxConcurrency?: number;
  /** Circuit breaker: consecutive failures to open circuit (default: 10) */
  circuitBreakerThreshold?: number;
  /** Circuit breaker: ms to wait before half-open probe (default: 30000) */
  circuitBreakerResetMs?: number;
  /** Max retry attempts for transient errors (default: 3) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 1000) */
  retryBaseDelayMs?: number;
  /** Max delay cap for retries in ms (default: 30000) */
  retryMaxDelayMs?: number;
  /** Error rate threshold (0-1) to trigger throttle-down (default: 0.3) */
  throttleErrorThreshold?: number;
  /** Success streak (items) before throttle-up (default: 20) */
  throttleRecoveryStreak?: number;
  /** Delay between batches in ms (default: 50) */
  interBatchDelayMs?: number;
}

export interface ProcessItemResult<R = unknown> {
  success: boolean;
  result?: R;
  error?: Error;
  retries: number;
}

export interface BatchProgress {
  /** Total items to process */
  total: number;
  /** Items completed (success + error + skipped) */
  processed: number;
  /** Successfully processed items */
  success: number;
  /** Failed items (after all retries) */
  errors: number;
  /** Items skipped by shouldProcess predicate */
  skipped: number;
  /** Currently active concurrent items */
  activeWorkers: number;
  /** Current effective concurrency limit */
  currentConcurrency: number;
  /** Current batch number */
  currentBatch: number;
  /** Total batch count */
  totalBatches: number;
  /** Current batch size */
  currentBatchSize: number;
  /** Circuit breaker state */
  circuitState: "closed" | "open" | "half-open";
  /** Items per second (rolling average) */
  throughput: number;
  /** Processing start time */
  startTime: number;
  /** Last error message */
  lastError: string;
  /** Whether processing is active */
  isRunning: boolean;
}

export type TransientErrorClassifier = (error: Error) => boolean;

export type ProgressCallback = (progress: BatchProgress) => void;

// ─── Semaphore ───────────────────────────────────────────────────────────────

class Semaphore {
  private _current = 0;
  private _queue: Array<() => void> = [];

  constructor(private _max: number) {}

  get current(): number {
    return this._current;
  }

  get max(): number {
    return this._max;
  }

  set max(value: number) {
    const newMax = Math.max(1, value);
    const diff = newMax - this._max;
    this._max = newMax;
    // If increased, release waiting tasks
    if (diff > 0) {
      for (let i = 0; i < diff && this._queue.length > 0; i++) {
        this._current++;
        this._queue.shift()!();
      }
    }
  }

  async acquire(): Promise<void> {
    if (this._current < this._max) {
      this._current++;
      return;
    }
    return new Promise<void>((resolve) => {
      this._queue.push(resolve);
    });
  }

  release(): void {
    if (this._queue.length > 0) {
      // Hand off to next waiter (don't decrement, just pass the slot)
      this._queue.shift()!();
    } else {
      this._current--;
    }
  }
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

type CircuitState = "closed" | "open" | "half-open";

class CircuitBreaker {
  private state: CircuitState = "closed";
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private halfOpenAttempts = 0;

  constructor(
    private threshold: number,
    private resetMs: number
  ) {}

  get currentState(): CircuitState {
    if (this.state === "open") {
      // Check if enough time passed to try half-open
      if (Date.now() - this.lastFailureTime >= this.resetMs) {
        this.state = "half-open";
        this.halfOpenAttempts = 0;
      }
    }
    return this.state;
  }

  canExecute(): boolean {
    const current = this.currentState;
    if (current === "closed") return true;
    if (current === "half-open") {
      // Allow limited probes in half-open
      return this.halfOpenAttempts < 3;
    }
    return false; // open
  }

  recordSuccess(): void {
    if (this.state === "half-open") {
      this.halfOpenAttempts++;
      // After 3 successful probes, close the circuit
      if (this.halfOpenAttempts >= 3) {
        this.state = "closed";
        this.consecutiveFailures = 0;
      }
    } else {
      this.consecutiveFailures = 0;
    }
  }

  recordFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === "half-open") {
      // Any failure in half-open immediately re-opens
      this.state = "open";
      return;
    }

    if (this.consecutiveFailures >= this.threshold) {
      this.state = "open";
    }
  }

  reset(): void {
    this.state = "closed";
    this.consecutiveFailures = 0;
    this.halfOpenAttempts = 0;
  }
}

// ─── Adaptive Throttle (AIMD) ────────────────────────────────────────────────

class AdaptiveThrottle {
  private windowResults: boolean[] = [];
  private consecutiveSuccess = 0;
  private readonly windowSize = 50;

  constructor(
    private errorThreshold: number,
    private recoveryStreak: number,
    private semaphore: Semaphore,
    private minConcurrency: number,
    private maxConcurrency: number
  ) {}

  get currentConcurrency(): number {
    return this.semaphore.max;
  }

  record(success: boolean): void {
    this.windowResults.push(success);
    if (this.windowResults.length > this.windowSize) {
      this.windowResults.shift();
    }

    if (success) {
      this.consecutiveSuccess++;
      this.maybeIncrease();
    } else {
      this.consecutiveSuccess = 0;
      this.maybeDecrease();
    }
  }

  private getErrorRate(): number {
    if (this.windowResults.length < 5) return 0; // Not enough data
    const failures = this.windowResults.filter((r) => !r).length;
    return failures / this.windowResults.length;
  }

  private maybeDecrease(): void {
    const errorRate = this.getErrorRate();
    if (errorRate >= this.errorThreshold) {
      // Multiplicative Decrease: halve concurrency
      const newMax = Math.max(
        this.minConcurrency,
        Math.floor(this.semaphore.max * 0.5)
      );
      if (newMax !== this.semaphore.max) {
        this.semaphore.max = newMax;
      }
    }
  }

  private maybeIncrease(): void {
    if (this.consecutiveSuccess >= this.recoveryStreak) {
      // Additive Increase: +1 concurrency
      const newMax = Math.min(this.maxConcurrency, this.semaphore.max + 1);
      if (newMax !== this.semaphore.max) {
        this.semaphore.max = newMax;
      }
      this.consecutiveSuccess = 0; // Reset streak
    }
  }

  reset(): void {
    this.windowResults = [];
    this.consecutiveSuccess = 0;
  }
}

// ─── Throughput Tracker ──────────────────────────────────────────────────────

class ThroughputTracker {
  private timestamps: number[] = [];
  private readonly windowMs = 10_000; // 10s rolling window

  record(): void {
    this.timestamps.push(Date.now());
    this.cleanup();
  }

  getItemsPerSecond(): number {
    this.cleanup();
    if (this.timestamps.length < 2) return 0;
    const windowStart = this.timestamps[0];
    const elapsed = (Date.now() - windowStart) / 1000;
    return elapsed > 0 ? this.timestamps.length / elapsed : 0;
  }

  private cleanup(): void {
    const cutoff = Date.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] < cutoff) {
      this.timestamps.shift();
    }
  }

  reset(): void {
    this.timestamps = [];
  }
}

// ─── Dynamic Batch Sizing ────────────────────────────────────────────────────

function computeBatchSize(
  totalItems: number,
  minBatch: number,
  maxBatch: number
): number {
  /**
   * Strategy:
   * - < 20 items: batch = totalItems (single batch)
   * - 20-100: batch = 10 (small batches for steady progress)
   * - 100-500: batch = 25
   * - 500-2000: batch = 50
   * - 2000+: batch = 100 (maximize throughput)
   *
   * Rationale: Smaller batches give better progress granularity and
   * allow the adaptive throttle to react faster. Larger batches reduce
   * per-batch overhead (query, coordination). The sweet spot depends
   * on per-item processing time — for AI calls (~1-5s each), batches
   * of 25-50 offer good balance.
   */
  let size: number;

  if (totalItems <= 20) {
    size = totalItems;
  } else if (totalItems <= 100) {
    size = 10;
  } else if (totalItems <= 500) {
    size = 25;
  } else if (totalItems <= 2000) {
    size = 50;
  } else {
    size = 100;
  }

  return Math.max(minBatch, Math.min(maxBatch, size));
}

// ─── Retry Logic ─────────────────────────────────────────────────────────────

function computeRetryDelay(
  attempt: number,
  baseMs: number,
  maxMs: number
): number {
  // Exponential backoff: base * 2^attempt
  const exponential = baseMs * Math.pow(2, attempt);
  // Full jitter: random between 0 and computed delay
  const jitter = Math.random() * Math.min(exponential, maxMs);
  return Math.min(jitter, maxMs);
}

/** Default classifier: network errors, rate limits, 5xx are transient */
export const defaultTransientClassifier: TransientErrorClassifier = (
  error: Error
): boolean => {
  const msg = error.message.toLowerCase();

  // Rate limits
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("too many requests")) {
    return true;
  }

  // Server errors (5xx)
  if (/\b5\d{2}\b/.test(msg)) return true;

  // Network errors
  if (
    msg.includes("econnreset") ||
    msg.includes("econnrefused") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("fetch failed") ||
    msg.includes("network") ||
    msg.includes("timeout")
  ) {
    return true;
  }

  return false;
};

// ─── Batch Engine ────────────────────────────────────────────────────────────

export class BatchEngine<T, R = unknown> {
  private config: Required<BatchEngineConfig>;
  private globalSemaphore: Semaphore;
  private circuitBreaker: CircuitBreaker;
  private throttle: AdaptiveThrottle;
  private throughputTracker: ThroughputTracker;
  private abortController: AbortController | null = null;

  private progress: BatchProgress = {
    total: 0,
    processed: 0,
    success: 0,
    errors: 0,
    skipped: 0,
    activeWorkers: 0,
    currentConcurrency: 0,
    currentBatch: 0,
    totalBatches: 0,
    currentBatchSize: 0,
    circuitState: "closed",
    throughput: 0,
    startTime: 0,
    lastError: "",
    isRunning: false,
  };

  private isTransientError: TransientErrorClassifier;
  private onProgress?: ProgressCallback;

  constructor(
    config: BatchEngineConfig = {},
    isTransientError?: TransientErrorClassifier,
    onProgress?: ProgressCallback
  ) {
    this.config = {
      minBatchSize: config.minBatchSize ?? 5,
      maxBatchSize: config.maxBatchSize ?? 100,
      maxConcurrentBatches: config.maxConcurrentBatches ?? 2,
      maxConcurrencyPerBatch: config.maxConcurrencyPerBatch ?? 5,
      globalMaxConcurrency: config.globalMaxConcurrency ?? 10,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 10,
      circuitBreakerResetMs: config.circuitBreakerResetMs ?? 30000,
      maxRetries: config.maxRetries ?? 3,
      retryBaseDelayMs: config.retryBaseDelayMs ?? 1000,
      retryMaxDelayMs: config.retryMaxDelayMs ?? 30000,
      throttleErrorThreshold: config.throttleErrorThreshold ?? 0.3,
      throttleRecoveryStreak: config.throttleRecoveryStreak ?? 20,
      interBatchDelayMs: config.interBatchDelayMs ?? 50,
    };

    this.globalSemaphore = new Semaphore(this.config.globalMaxConcurrency);
    this.circuitBreaker = new CircuitBreaker(
      this.config.circuitBreakerThreshold,
      this.config.circuitBreakerResetMs
    );
    this.throttle = new AdaptiveThrottle(
      this.config.throttleErrorThreshold,
      this.config.throttleRecoveryStreak,
      this.globalSemaphore,
      1,
      this.config.globalMaxConcurrency
    );
    this.throughputTracker = new ThroughputTracker();
    this.isTransientError = isTransientError ?? defaultTransientClassifier;
    this.onProgress = onProgress;
  }

  /** Get current progress snapshot (non-blocking) */
  getProgress(): Readonly<BatchProgress> {
    return { ...this.progress };
  }

  /** Check if engine is currently running */
  get isRunning(): boolean {
    return this.progress.isRunning;
  }

  /** Request graceful stop */
  stop(): void {
    if (this.abortController) {
      this.abortController.abort();
    }
  }

  /**
   * Process all items.
   *
   * @param items - Array of items to process
   * @param processItem - Async function to process a single item
   * @param shouldProcess - Optional predicate to skip items (e.g., cache check).
   *                        If returns false, item is counted as "skipped".
   * @returns Array of results in the same order as input items
   */
  async process(
    items: T[],
    processItem: (item: T, signal: AbortSignal) => Promise<R>,
    shouldProcess?: (item: T) => Promise<boolean> | boolean
  ): Promise<ProcessItemResult<R>[]> {
    if (this.progress.isRunning) {
      throw new Error("BatchEngine is already running");
    }

    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    // Reset state
    this.circuitBreaker.reset();
    this.throttle.reset();
    this.throughputTracker.reset();
    this.globalSemaphore.max = this.config.globalMaxConcurrency;

    const total = items.length;
    const batchSize = computeBatchSize(
      total,
      this.config.minBatchSize,
      this.config.maxBatchSize
    );
    const totalBatches = Math.ceil(total / batchSize);

    this.progress = {
      total,
      processed: 0,
      success: 0,
      errors: 0,
      skipped: 0,
      activeWorkers: 0,
      currentConcurrency: this.globalSemaphore.max,
      currentBatch: 0,
      totalBatches,
      currentBatchSize: batchSize,
      circuitState: "closed",
      throughput: 0,
      startTime: Date.now(),
      lastError: "",
      isRunning: true,
    };

    this.emitProgress();

    // Pre-allocate results array (maintains input order)
    const results: ProcessItemResult<R>[] = new Array(total);

    // Split items into batches
    const batches: { items: T[]; startIndex: number }[] = [];
    for (let i = 0; i < total; i += batchSize) {
      batches.push({
        items: items.slice(i, i + batchSize),
        startIndex: i,
      });
    }

    // Process batches with limited inter-batch concurrency
    const batchSemaphore = new Semaphore(this.config.maxConcurrentBatches);

    try {
      // Launch all batches, controlled by batchSemaphore
      const batchPromises = batches.map(async (batch, batchIndex) => {
        if (signal.aborted) return;

        await batchSemaphore.acquire();
        if (signal.aborted) {
          batchSemaphore.release();
          return;
        }

        try {
          this.progress.currentBatch = batchIndex + 1;
          this.emitProgress();

          await this.processBatch(
            batch.items,
            batch.startIndex,
            results,
            processItem,
            shouldProcess,
            signal
          );

          // Inter-batch delay to prevent burst pressure
          if (!signal.aborted && this.config.interBatchDelayMs > 0) {
            await delay(this.config.interBatchDelayMs);
          }
        } finally {
          batchSemaphore.release();
        }
      });

      await Promise.allSettled(batchPromises);
    } finally {
      this.progress.isRunning = false;
      this.abortController = null;
      this.emitProgress();
    }

    return results;
  }

  /** Process a single batch: items run concurrently within, limited by globalSemaphore */
  private async processBatch(
    items: T[],
    startIndex: number,
    results: ProcessItemResult<R>[],
    processItem: (item: T, signal: AbortSignal) => Promise<R>,
    shouldProcess: ((item: T) => Promise<boolean> | boolean) | undefined,
    signal: AbortSignal
  ): Promise<void> {
    // Per-batch concurrency is enforced via the global semaphore
    // (which already limits total active workers across all batches).
    // We also use a per-batch semaphore for finer control.
    const batchSemaphore = new Semaphore(this.config.maxConcurrencyPerBatch);

    const itemPromises = items.map(async (item, localIndex) => {
      const globalIndex = startIndex + localIndex;

      if (signal.aborted) {
        results[globalIndex] = { success: false, error: new Error("Aborted"), retries: 0 };
        return;
      }

      // Check if item should be processed
      if (shouldProcess) {
        try {
          const should = await shouldProcess(item);
          if (!should) {
            results[globalIndex] = { success: true, retries: 0 };
            this.progress.skipped++;
            this.progress.processed++;
            this.emitProgress();
            return;
          }
        } catch {
          // If predicate throws, process the item anyway
        }
      }

      // Acquire both semaphores (global first, then batch-local)
      await this.globalSemaphore.acquire();
      await batchSemaphore.acquire();

      this.progress.activeWorkers++;
      this.progress.currentConcurrency = this.throttle.currentConcurrency;
      this.emitProgress();

      try {
        const result = await this.processItemWithRetry(item, processItem, signal);
        results[globalIndex] = result;

        if (result.success) {
          this.progress.success++;
          this.circuitBreaker.recordSuccess();
          this.throttle.record(true);
        } else {
          this.progress.errors++;
          if (result.error) {
            this.progress.lastError = result.error.message;
          }
          this.circuitBreaker.recordFailure();
          this.throttle.record(false);
        }

        this.progress.processed++;
        this.throughputTracker.record();
        this.progress.throughput = Math.round(
          this.throughputTracker.getItemsPerSecond() * 100
        ) / 100;
        this.progress.circuitState = this.circuitBreaker.currentState;
        this.progress.currentConcurrency = this.throttle.currentConcurrency;
        this.emitProgress();
      } finally {
        this.progress.activeWorkers--;
        batchSemaphore.release();
        this.globalSemaphore.release();
      }
    });

    await Promise.allSettled(itemPromises);
  }

  /** Process a single item with retry logic */
  private async processItemWithRetry(
    item: T,
    processItem: (item: T, signal: AbortSignal) => Promise<R>,
    signal: AbortSignal
  ): Promise<ProcessItemResult<R>> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      if (signal.aborted) {
        return { success: false, error: new Error("Aborted"), retries: attempt };
      }

      // Circuit breaker gate
      if (!this.circuitBreaker.canExecute()) {
        // Wait for reset period then retry
        await delay(this.config.circuitBreakerResetMs / 3);
        if (!this.circuitBreaker.canExecute()) {
          return {
            success: false,
            error: new Error("Circuit breaker open — external resource unavailable"),
            retries: attempt,
          };
        }
      }

      try {
        const result = await processItem(item, signal);
        return { success: true, result, retries: attempt };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Only retry transient errors
        if (!this.isTransientError(lastError)) {
          return { success: false, error: lastError, retries: attempt };
        }

        // Don't retry if this was the last attempt
        if (attempt < this.config.maxRetries) {
          const delayMs = computeRetryDelay(
            attempt,
            this.config.retryBaseDelayMs,
            this.config.retryMaxDelayMs
          );
          await delay(delayMs);
        }
      }
    }

    return {
      success: false,
      error: lastError ?? new Error("Max retries exceeded"),
      retries: this.config.maxRetries,
    };
  }

  private emitProgress(): void {
    if (this.onProgress) {
      try {
        this.onProgress({ ...this.progress });
      } catch {
        // Progress callback should never break processing
      }
    }
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
