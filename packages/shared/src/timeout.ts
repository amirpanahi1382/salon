export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function withTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number,
  message = 'Operation timed out',
): Promise<T> {
  if (timeoutMs <= 0) {
    return operation;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(message)), timeoutMs);
  });

  return Promise.race([operation, timeout]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}
