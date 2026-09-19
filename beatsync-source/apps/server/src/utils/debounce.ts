/**
 * Returns a debounced version of `fn` that delays execution by `delayMs`.
 * Each call resets the timer. The returned function also exposes a `cancel()`
 * method to clear any pending invocation.
 */
export function debounce<T extends () => void>(fn: T, delayMs: number): T & { cancel: () => void } {
  let timer: NodeJS.Timeout | undefined;

  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, delayMs);
  };

  debounced.cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  return debounced as T & { cancel: () => void };
}
