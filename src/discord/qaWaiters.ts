const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1000;

type Waiter = {
  resolve: (answer: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const waiters = new Map<number, Waiter>();

export class QuestionWaitCancelledError extends Error {
  constructor(message = "Pipeline stopped") {
    super(message);
    this.name = "QuestionWaitCancelledError";
  }
}

export function waitForQuestionAnswer(
  featureId: number,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<string> {
  const existing = waiters.get(featureId);
  if (existing) {
    clearTimeout(existing.timeout);
    existing.reject(new Error("Superseded by a newer question"));
    waiters.delete(featureId);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      waiters.delete(featureId);
      reject(new Error("Timed out waiting for a Discord answer"));
    }, timeoutMs);
    waiters.set(featureId, { resolve, reject, timeout });
  });
}

export function deliverQuestionAnswer(featureId: number, answer: string): boolean {
  const waiter = waiters.get(featureId);
  if (!waiter) {
    return false;
  }
  clearTimeout(waiter.timeout);
  waiters.delete(featureId);
  waiter.resolve(answer);
  return true;
}

export function cancelAllQuestionWaiters(reason = "Pipeline stopped"): void {
  const pending = [...waiters.values()];
  waiters.clear();
  for (const waiter of pending) {
    clearTimeout(waiter.timeout);
    waiter.reject(new QuestionWaitCancelledError(reason));
  }
}

export const ASK_DISCORD_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
