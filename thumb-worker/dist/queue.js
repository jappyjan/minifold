import PQueue from "p-queue";
export class ThumbQueue {
    q;
    constructor(opts) {
        this.q = new PQueue({ concurrency: opts.concurrency });
    }
    add(task) {
        return this.q.add(task);
    }
}
