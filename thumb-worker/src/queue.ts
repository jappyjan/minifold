import PQueue from "p-queue";

type Options = { concurrency: number };

export class ThumbQueue {
  private readonly q: PQueue;

  constructor(opts: Options) {
    this.q = new PQueue({ concurrency: opts.concurrency });
  }

  add<T>(task: () => Promise<T>): Promise<T> {
    return this.q.add(task) as Promise<T>;
  }
}
