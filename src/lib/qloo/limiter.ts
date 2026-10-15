/**
 * Keeps live Qloo traffic inside the hackathon key's limits while letting a
 * plan ask for several things at once. The key allows 5 requests per second;
 * firing 8 together answered 429, 4 together were fine. So: at most 4 in
 * flight, and at most 5 started in any rolling second.
 *
 * One limiter is shared by every live client in the process, so two
 * sessions built at the same moment queue behind each other instead of
 * tripping the limit together.
 */
export interface LimiterOptions {
  maxInFlight?: number;
  perSecond?: number;
  /** Test hooks. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export const QLOO_MAX_IN_FLIGHT = 4;
export const QLOO_PER_SECOND = 5;

const WINDOW_MS = 1_000;

export class RateLimiter {
  private readonly maxInFlight: number;
  private readonly perSecond: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private inFlight = 0;
  private readonly starts: number[] = [];
  private readonly waiting: (() => void)[] = [];

  constructor(opts: LimiterOptions = {}) {
    this.maxInFlight = opts.maxInFlight ?? QLOO_MAX_IN_FLIGHT;
    this.perSecond = opts.perSecond ?? QLOO_PER_SECOND;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  }

  /** Run `task` once a slot is free and the rolling second has room. */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private async acquire(): Promise<void> {
    while (this.inFlight >= this.maxInFlight) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.inFlight += 1;
    for (;;) {
      const now = this.now();
      while (this.starts.length > 0 && now - this.starts[0]! >= WINDOW_MS) this.starts.shift();
      if (this.starts.length < this.perSecond) {
        this.starts.push(now);
        return;
      }
      await this.sleep(WINDOW_MS - (now - this.starts[0]!));
    }
  }

  private release(): void {
    this.inFlight -= 1;
    this.waiting.shift()?.();
  }
}

let shared: RateLimiter | null = null;

/** The process-wide limiter every live Qloo client uses by default. */
export function sharedQlooLimiter(): RateLimiter {
  shared ??= new RateLimiter();
  return shared;
}
