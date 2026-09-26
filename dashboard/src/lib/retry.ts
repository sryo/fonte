const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function retryUntil<T>(
  fn: () => Promise<T>,
  { attempts, delayMs, sleep = wait }: { attempts: number; delayMs: number; sleep?: (ms: number) => Promise<void> }
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts) throw err;
      await sleep(delayMs);
    }
  }
}
