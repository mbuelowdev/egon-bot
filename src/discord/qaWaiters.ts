const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1000;

type Waiter = {
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const waiters = new Map<string, Waiter>();

export class ThreadWaitCancelledError extends Error {
  constructor(message = "Pipeline stopped") {
    super(message);
    this.name = "ThreadWaitCancelledError";
  }
}

export function waitForThreadAnswer(
  threadId: string,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const existing = waiters.get(threadId);
  if (existing) {
    clearTimeout(existing.timeout);
    existing.reject(new Error("Superseded by a newer question in this thread"));
    waiters.delete(threadId);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(threadId);
      reject(new Error("Timed out waiting for a Discord mention-answer"));
    }, timeoutMs);
    waiters.set(threadId, { resolve, reject, timeout });
  });
}

export function deliverThreadAnswer(threadId: string, answer: string): boolean {
  const waiter = waiters.get(threadId);
  if (!waiter) {
    return false;
  }
  clearTimeout(waiter.timeout);
  waiters.delete(threadId);
  waiter.resolve(answer);
  return true;
}

export function cancelAllThreadWaiters(reason = "Pipeline stopped"): void {
  const pending = [...waiters.values()];
  waiters.clear();
  for (const waiter of pending) {
    clearTimeout(waiter.timeout);
    waiter.reject(new ThreadWaitCancelledError(reason));
  }
}

export const ASK_DISCORD_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
