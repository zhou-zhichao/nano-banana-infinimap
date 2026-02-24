export type ReviewDecision = "ACCEPT" | "REJECT";

export type ReviewQueueItem<T> = {
  id: string;
  payload: T;
  enqueuedAt: number;
};

export type ReviewQueueState<T> = {
  active: ReviewQueueItem<T> | null;
  pending: ReviewQueueItem<T>[];
  cancelled: boolean;
};

type ReviewQueueOptions<T> = {
  onChange?: (state: ReviewQueueState<T>) => void;
};

type InternalEntry<T> = ReviewQueueItem<T> & {
  resolve: (decision: ReviewDecision) => void;
  reject: (error: Error) => void;
  settled: boolean;
};

export class ReviewQueue<T> {
  private readonly onChange: ((state: ReviewQueueState<T>) => void) | undefined;
  private readonly pending: InternalEntry<T>[] = [];
  private active: InternalEntry<T> | null = null;
  private cancelledError: Error | null = null;
  private counter = 0;

  constructor(options: ReviewQueueOptions<T> = {}) {
    this.onChange = options.onChange;
  }

  enqueue(payload: T): Promise<ReviewDecision> {
    if (this.cancelledError) {
      return Promise.reject(this.cancelledError);
    }

    return new Promise<ReviewDecision>((resolve, reject) => {
      this.counter += 1;
      const entry: InternalEntry<T> = {
        id: `review-${Date.now()}-${this.counter}`,
        payload,
        enqueuedAt: Date.now(),
        resolve,
        reject,
        settled: false,
      };
      this.pending.push(entry);
      this.promote();
      this.emit();
    });
  }

  resolveActive(decision: ReviewDecision): boolean {
    if (!this.active) return false;
    const current = this.active;
    this.active = null;
    if (!current.settled) {
      current.settled = true;
      current.resolve(decision);
    }
    this.promote();
    this.emit();
    return true;
  }

  cancelAll(reason = "Review queue cancelled"): void {
    if (this.cancelledError) return;
    this.cancelledError = new Error(reason);

    if (this.active && !this.active.settled) {
      this.active.settled = true;
      this.active.reject(this.cancelledError);
    }
    this.active = null;

    while (this.pending.length > 0) {
      const queued = this.pending.shift();
      if (!queued || queued.settled) continue;
      queued.settled = true;
      queued.reject(this.cancelledError);
    }
    this.emit();
  }

  getState(): ReviewQueueState<T> {
    return {
      active: this.toPublicItem(this.active),
      pending: this.pending.map((entry) => this.toPublicItem(entry)).filter((item): item is ReviewQueueItem<T> => item !== null),
      cancelled: this.cancelledError != null,
    };
  }

  private promote(): void {
    if (this.active || this.cancelledError) return;
    const next = this.pending.shift();
    if (!next) return;
    this.active = next;
  }

  private emit(): void {
    this.onChange?.(this.getState());
  }

  private toPublicItem(entry: InternalEntry<T> | null): ReviewQueueItem<T> | null {
    if (!entry) return null;
    return {
      id: entry.id,
      payload: entry.payload,
      enqueuedAt: entry.enqueuedAt,
    };
  }
}
