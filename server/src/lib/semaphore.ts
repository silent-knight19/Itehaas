// S5: simple semaphore for execItehaas concurrency limiting (max 3)
export class Semaphore {
  private max: number;
  private count = 0;
  private queue: Array<() => void> = [];

  constructor(max: number) {
    this.max = max;
  }

  async acquire(): Promise<void> {
    if (this.count < this.max) {
      this.count++;
      return;
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.count++;
  }

  release(): void {
    this.count = Math.max(0, this.count - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  // For testing
  getCount(): number {
    return this.count;
  }
  getQueueLength(): number {
    return this.queue.length;
  }
}

export const vcsSemaphore = new Semaphore(3);
