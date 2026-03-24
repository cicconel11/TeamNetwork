export const PASS1_MODEL_TIMEOUT_MS = 15_000;
export const PASS2_MODEL_TIMEOUT_MS = 15_000;
export const TOOL_EXECUTION_TIMEOUT_MS = 5_000;

export class StageTimeoutError extends Error {
  readonly stage: string;
  readonly timeoutMs: number;

  constructor(stage: string, timeoutMs: number) {
    super(`${stage} timed out after ${timeoutMs}ms`);
    this.name = "StageTimeoutError";
    this.stage = stage;
    this.timeoutMs = timeoutMs;
  }
}

export function isStageTimeoutError(error: unknown): error is StageTimeoutError {
  return (
    error instanceof StageTimeoutError ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "StageTimeoutError" &&
      "stage" in error &&
      typeof error.stage === "string" &&
      "timeoutMs" in error &&
      typeof error.timeoutMs === "number")
  );
}

export function createStageAbortSignal(params: {
  stage: string;
  timeoutMs: number;
  parentSignal?: AbortSignal;
}): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const { stage, timeoutMs, parentSignal } = params;
  const controller = new AbortController();

  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason);
    }
  };

  if (parentSignal) {
    if (parentSignal.aborted) {
      abortFromParent();
    } else {
      parentSignal.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  const timeoutId = setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort(new StageTimeoutError(stage, timeoutMs));
    }
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
      if (parentSignal) {
        parentSignal.removeEventListener("abort", abortFromParent);
      }
    },
  };
}

export async function withStageTimeout<T>(
  stage: string,
  timeoutMs: number,
  operation: () => Promise<T>
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new StageTimeoutError(stage, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}
