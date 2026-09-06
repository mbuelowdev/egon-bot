export type CancellableRun = {
  supports: (operation: "cancel") => boolean;
  cancel: () => Promise<void>;
};

let activeRun: CancellableRun | undefined;
let cancelRequested = false;

export function clearAgentCancel(): void {
  cancelRequested = false;
}

export function isAgentCancelRequested(): boolean {
  return cancelRequested;
}

export function setActiveAgentRun(run: CancellableRun | undefined): void {
  activeRun = run;
}

export async function cancelActiveAgentRun(): Promise<void> {
  cancelRequested = true;
  const run = activeRun;
  if (!run || !run.supports("cancel")) {
    return;
  }
  try {
    await run.cancel();
  } catch (error) {
    console.error("failed to cancel cursor run", error);
  }
}
